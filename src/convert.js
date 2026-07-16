'use strict';

/**
 * Core HTML -> editable PPTX conversion engine.
 *
 * Strategy (verified):
 *   - Render the HTML in real headless Chromium (puppeteer) so dom-to-pptx can
 *     read getComputedStyle / Canvas just like a browser would.
 *   - Inject the dom-to-pptx UMD bundle (exposes global `domToPptx`).
 *   - Run domToPptx.exportToPptx() on the slide elements -> editable text boxes,
 *     embedded fonts and vector SVG, returned as a Blob -> base64 -> Node Buffer.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const JSZip = require('jszip');
const fonteditor = require('fonteditor-core');
const pako = require('pako');

/**
 * fonteditor-core can decode woff2, but only after its (async) wasm module is
 * initialized. Init lazily and once — subsequent calls reuse the same promise.
 */
let _woff2Ready = null;
function ensureWoff2() {
  return _woff2Ready || (_woff2Ready = fonteditor.woff2.init());
}

/** Sniff a font container from its 4-byte signature. */
function sniffFontType(buf) {
  const sig = buf.slice(0, 4).toString('latin1');
  if (sig === 'wOF2') return 'woff2';
  if (sig === 'wOFF') return 'woff';
  if (sig === 'OTTO') return 'otf';
  return 'ttf'; // 0x00010000 / 'true' / 'ttcf'
}

/**
 * Decode any web-font container to a raw TrueType (glyf) Buffer.
 * woff2 is the important case: the browser resolves it fine, but neither
 * PowerPoint (needs EOT) nor dom-to-pptx's in-page embedder can read it —
 * so decks that ship Pretendard/Noto as woff2 data: URIs ended up with the
 * font tagged but NOT embedded, and PowerPoint substituted a wider fallback
 * (i.e. "the fonts are all broken"). Decoding to TTF here fixes that.
 */
function fontBufferToTtf(buf) {
  const type = sniffFontType(buf);
  if (type === 'ttf') return buf;
  const font = fonteditor.Font.create(buf, {
    type,
    hinting: true,
    inflate: type === 'woff' ? pako.inflate : undefined,
  });
  const ttf = font.write({ type: 'ttf', toBuffer: true });
  return Buffer.isBuffer(ttf) ? ttf : Buffer.from(ttf);
}

/** Convert any font Buffer to EOT (fntdata) for PowerPoint embedding. */
function fontBufferToEot(buf) {
  const type = sniffFontType(buf);
  const font = fonteditor.Font.create(buf, {
    type,
    hinting: true,
    inflate: type === 'woff' ? pako.inflate : undefined,
  });
  const eot = font.write({ type: 'eot', toBuffer: true });
  return Buffer.isBuffer(eot) ? eot : Buffer.from(eot);
}

/**
 * Fetch font bytes from a resolved src URL. Handles data:/http(s):/file: via
 * Node's fetch, and blob: (which only lives inside the page) by fetching it in
 * the page and shipping the bytes back as base64.
 */
async function fetchFontBuffer(page, url) {
  if (url.startsWith('blob:')) {
    const b64 = await page.evaluate(async (u) => {
      const r = await fetch(u);
      const bytes = new Uint8Array(await r.arrayBuffer());
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s);
    }, url);
    return Buffer.from(b64, 'base64');
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error('font fetch failed: ' + url.slice(0, 48));
  return Buffer.from(await r.arrayBuffer());
}

/**
 * Bump any paragraph whose fixed line spacing (a:spcPts) is smaller than its
 * largest run — dom-to-pptx mis-computes line-height:1 on mixed-size inline text
 * (e.g. a big "±0.1" with a small "mm"), producing a line box shorter than the
 * glyphs, so PowerPoint squeezes/clips the big number and the layout looks off.
 * Raising spcPts to the max font size restores the intended single-line height.
 */
function fixLineSpacing(xml) {
  return xml.replace(/<a:p>[\s\S]*?<\/a:p>/g, (para) => {
    const sizes = [...para.matchAll(/\bsz="(\d+)"/g)].map((m) => +m[1]);
    if (!sizes.length) return para;
    const maxSz = Math.max(...sizes);
    return para.replace(
      /(<a:spcPts val=")(\d+)("\s*\/>)/g,
      (full, a, val, c) => (+val < maxSz ? `${a}${maxSz}${c}` : full)
    );
  });
}

/**
 * Post-process the slide XML inside a .pptx:
 *  - (when noWrap) force every text box to wrap="none" so PowerPoint keeps the
 *    baked line breaks and never splits a word (e.g. "유정희" -> "유정 / 희").
 *  - always fix too-small line spacing (see fixLineSpacing).
 *
 * @param {Buffer} buf  the .pptx file bytes
 * @param {{noWrap:boolean}} opts
 * @returns {Promise<Buffer>}
 */

async function postProcessSlides(buf, { noWrap }) {
  const zip = await JSZip.loadAsync(buf);
  const slideFiles = Object.keys(zip.files).filter((n) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(n)
  );
  for (const name of slideFiles) {
    let xml = await zip.file(name).async('string');
    if (noWrap) {
      // bodyPr with wrap="square" -> "none"; bodyPr missing wrap -> add wrap="none".
      xml = xml
        .replace(/(<a:bodyPr\b[^>]*?)\swrap="square"/g, '$1 wrap="none"')
        .replace(/<a:bodyPr\b(?![^>]*\bwrap=)/g, '<a:bodyPr wrap="none"');
    }
    xml = fixLineSpacing(xml);
    zip.file(name, xml);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * Runs INSIDE the browser page (serialized by puppeteer — must be self-contained).
 *
 * Two passes per slide:
 *   1) Bake breaks — for each deepest block that owns a line box, measure where
 *      the browser wraps (via Range rects) and insert a real <br> at each wrap.
 *   2) Freeze wrap — set `white-space: nowrap` on those owners so dom-to-pptx
 *      exports the text boxes with wrap disabled. Together this means PowerPoint
 *      shows the on-screen line breaks and never re-wraps a word (e.g. it won't
 *      split "유정희" into "유정 / 희" just because a fallback font is wider).
 *
 * @returns {number} how many <br> were inserted.
 */
function bakeLineBreaksInPage(slideSelector) {
  const slides = Array.from(document.querySelectorAll(slideSelector));
  let inserted = 0;

  function isInlineDisp(d) {
    return d.startsWith('inline') || d === 'contents';
  }
  // The deepest block-level element whose content is entirely inline (text,
  // spans, <br>) — i.e. it owns exactly one set of line boxes.
  function isLineOwner(el) {
    const d = getComputedStyle(el).display;
    if (d === 'none' || isInlineDisp(d)) return false; // must be block-ish
    if (!(el.textContent && el.textContent.trim())) return false;
    for (const c of el.children) {
      if (c.tagName === 'BR') continue;
      if (!isInlineDisp(getComputedStyle(c).display)) return false; // has a block child
    }
    return true;
  }

  function bake(owner) {
    const walker = document.createTreeWalker(
      owner,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
    );
    const range = document.createRange();
    const cuts = []; // {node, offset} where a new visual line begins
    let prev = null; // previous char rect {top, bottom, h}
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 1) {
        if (node.tagName === 'BR') prev = null; // existing hard break resets
        continue;
      }
      const len = node.textContent.length;
      for (let i = 0; i < len; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rects = range.getClientRects();
        if (!rects.length) continue;
        const r = rects[rects.length - 1];
        const cur = { top: r.top, bottom: r.bottom, h: r.height };
        if (prev) {
          // New line = the two chars barely overlap vertically AND the current
          // one sits lower. This ignores same-line size changes (big name +
          // small suffix share a baseline and overlap), catching only real wraps.
          const overlap = Math.min(prev.bottom, cur.bottom) - Math.max(prev.top, cur.top);
          const minH = Math.min(prev.h, cur.h) || 1;
          if (overlap < 0.3 * minH && cur.top >= prev.top - 1) {
            cuts.push({ node, offset: i });
          }
        }
        prev = cur;
      }
    }

    for (let k = cuts.length - 1; k >= 0; k--) {
      const { node: n, offset } = cuts[k];
      const br = document.createElement('br');
      if (offset === 0) n.parentNode.insertBefore(br, n);
      else {
        const after = n.splitText(offset);
        after.parentNode.insertBefore(br, after);
      }
      inserted++;
    }
  }

  for (const slide of slides) {
    const owners = Array.from(slide.querySelectorAll('*')).filter(isLineOwner);
    for (const owner of owners) {
      const ws = getComputedStyle(owner).whiteSpace;
      if (ws === 'pre' || ws === 'pre-wrap' || ws === 'nowrap') continue; // exact / no auto-wrap already
      bake(owner);
    }
  }
  // The actual wrap-disable happens after export (forceNoWrap on the .pptx),
  // which reliably covers every text box regardless of dom-to-pptx's path.
  return inserted;
}

/**
 * Runs INSIDE the page. Two general fidelity fixes applied before export:
 *
 *  1) Inline horizontal margins -> spaces. dom-to-pptx concatenates adjacent
 *     inline runs with no gap, so a `<span style="margin-left:6px">mm</span>`
 *     ends up touching the previous run ("±0.1mm" instead of "±0.1 mm"). We turn
 *     the margin into an equivalent number of space characters.
 *
 *  2) Decorative ::before/::after -> real elements. A pseudo with empty text but
 *     a background/border (e.g. a bullet drawn as a 9px border-radius:50% circle)
 *     is invisible to dom-to-pptx (no text). We materialize it as a real filled
 *     span at the same position/size so it gets exported as a shape.
 *
 * @returns {{gaps:number, markers:number}}
 */
function enhanceFidelityInPage(slideSelector) {
  const slides = Array.from(document.querySelectorAll(slideSelector));
  let gaps = 0;
  let markers = 0;
  const isInline = (d) => d.startsWith('inline');

  for (const slide of slides) {
    const all = Array.from(slide.querySelectorAll('*'));

    // 1) inline horizontal margins -> spaces
    for (const el of all) {
      const cs = getComputedStyle(el);
      if (!isInline(cs.display)) continue;
      const fs = parseFloat(cs.fontSize) || 16;
      const spaceW = 0.25 * fs || 4;
      const spaces = (px) => ' '.repeat(Math.min(3, Math.max(1, Math.round(px / spaceW))));
      const ml = parseFloat(cs.marginLeft) || 0;
      const mr = parseFloat(cs.marginRight) || 0;
      const prev = el.previousSibling;
      const next = el.nextSibling;
      if (ml >= 2 && prev && (prev.textContent || '').trim() && !/\s$/.test(prev.textContent || '')) {
        el.parentNode.insertBefore(document.createTextNode(spaces(ml)), el);
        gaps++;
      }
      if (mr >= 2 && next && (next.textContent || '').trim() && !/^\s/.test(next.textContent || '')) {
        el.parentNode.insertBefore(document.createTextNode(spaces(mr)), next);
        gaps++;
      }
    }

    // 2) decorative ::before / ::after drawn shapes -> real filled spans
    for (const el of all) {
      for (const which of ['::before', '::after']) {
        const cs = getComputedStyle(el, which);
        if (!cs || cs.content === 'none') continue;
        if (cs.position !== 'absolute') continue; // drawn markers are positioned
        const text = cs.content.replace(/^["']|["']$/g, '');
        if (text) continue; // pseudo TEXT (icons) already export via dom-to-pptx
        const w = parseFloat(cs.width) || 0;
        const h = parseFloat(cs.height) || 0;
        if (w <= 0 || h <= 0 || w > 80 || h > 80) continue; // only small markers
        if (w / h > 2 || h / w > 2) continue; // square-ish only (skip bars/underlines)
        const bg = cs.backgroundColor;
        const hasBg = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
        const bwid = parseFloat(cs.borderTopWidth) || 0;
        const hasBorder = bwid > 0 && cs.borderTopStyle !== 'none';
        if (!hasBg && !hasBorder) continue;

        // dom-to-pptx drops a background/border-only marker box, so the bullet would
        // vanish; render it as a glyph: ● filled dot, ○ outlined ring, ■/□ square.
        const round = (parseFloat(cs.borderRadius) || 0) > 0 || cs.borderRadius.includes('%');
        const glyph = hasBg ? (round ? '•' : '▪') : round ? '⚬' : '▫';
        const fill = hasBg ? bg : cs.borderTopColor;

        // For a LEADING ::before bullet, merge "glyph + gap" into the item's first
        // text run. dom-to-pptx collapses the item's padding-left and places the text
        // at the element's left edge, so a separately-positioned marker box lands ON
        // TOP of the text. Merging keeps the bullet in the SAME run with an NBSP gap
        // (internal NBSP survives dom-to-pptx's trailing-space trimming) → "○  text".
        const padL = parseFloat(getComputedStyle(el).paddingLeft) || 0;
        const isLeadBullet = which === '::before' && (parseFloat(cs.left) || 0) <= padL + 2;
        let tn = null;
        if (isLeadBullet) {
          const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
          let node;
          while ((node = tw.nextNode())) { if (node.nodeValue && node.nodeValue.trim()) { tn = node; break; } }
        }
        if (tn) {
          // Glyph in its OWN run: neutral marker color + the list item base size
          // (so it does not inherit the emphasized first words it precedes). The gap
          // is a braille blank (U+2800) — a non-whitespace blank, so dom-to-pptx
          // does not trim it the way it trims a trailing space/NBSP between runs.
          const glyphPx = (parseFloat(getComputedStyle(el).fontSize) || 16) * 1.25; // mid-line typographic bullet
          const lead = glyph + '⠀';
          const g = document.createElement('span');
          g.textContent = lead;
          g.style.cssText = `color:${fill};font-weight:400;font-size:${glyphPx}px;`;
          el.insertBefore(g, el.firstChild);
          // Hanging indent: dom-to-pptx splits a <br> into a separate paragraph at
          // marL=0, so continuation lines would sit under the bullet. Prefix each with
          // an invisible spacer the same width as the bullet+gap to align them under
          // the text.
          el.querySelectorAll('br').forEach((br) => {
            const sp = document.createElement('span');
            sp.textContent = lead;
            sp.style.cssText = `color:transparent;font-weight:400;font-size:${glyphPx}px;`;
            br.parentNode.insertBefore(sp, br.nextSibling);
          });
          markers++;
        } else {
          // Non-leading / text-less decoration: a standalone positioned glyph box is fine.
          const fontPx = Math.max(w, h) / 0.78;
          const elRect = el.getBoundingClientRect();
          const slideRect = slide.getBoundingClientRect();
          if (getComputedStyle(slide).position === 'static') slide.style.position = 'relative';
          const dot = document.createElement('span');
          dot.textContent = glyph;
          dot.style.cssText =
            `position:absolute;pointer-events:none;white-space:nowrap;` +
            `left:${elRect.left + (parseFloat(cs.left) || 0) - slideRect.left}px;` +
            `top:${elRect.top + (parseFloat(cs.top) || 0) - slideRect.top}px;` +
            `width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center;` +
            `font-size:${fontPx}px;line-height:1;color:${fill};` +
            (cs.transform !== 'none' ? `transform:${cs.transform};` : '');
          slide.appendChild(dot);
          markers++;
        }
      }
    }
  }
  return { gaps, markers };
}

/**
 * Find embeddable web fonts and return their reg/bold URLs ready for embedding.
 *
 * Two complementary sources, because neither alone is enough:
 *   1) The LIVE CSSOM, but ONLY faces inlined as `data:`/`blob:` (in-page). After
 *      the page's own JS runs, a self-contained deck's @font-face `src` — a bare
 *      placeholder (e.g. a UUID) in the raw CSS — is resolved to a full
 *      `data:font/woff2;base64,…` URI. The Node parse below can't see these, so
 *      the deck's real font was never embedded and PowerPoint substituted a
 *      fallback (bold text then rendered as a mismatched faux-bold).
 *   2) The Node-side parse of inline <style> + <link> stylesheets (CDN etc.),
 *      fetched with a plain UA so a CDN returns the FULL font rather than the
 *      browser's per-script unicode-range subsets (a subset would embed as a
 *      tiny face missing most glyphs — e.g. no Korean).
 *
 * woff2 from source (1) is accepted and decoded to TTF downstream (see
 * fontBufferToTtf) because PowerPoint/dom-to-pptx can't read woff2. Only families
 * actually used by the slide text are returned, so a stylesheet full of unused
 * faces doesn't bloat the deck.
 *
 * @returns {Promise<Array<{name:string,url:string,boldUrl?:string}>>}
 */
async function resolveEmbeddableFonts(page, pageBaseUrl, slideSelector) {
  const { dataFaces, links, inline, usedFamilies } = await page.evaluate((sel) => {
    const norm = (s) => (s || '').trim().replace(/^['"]|['"]$/g, '').toLowerCase();

    // Families actually rendered by slide text (so we skip unused CDN faces).
    const used = new Set();
    const roots = Array.from(document.querySelectorAll(sel));
    for (const root of roots.length ? roots : [document.body]) {
      for (const el of root.querySelectorAll('*')) {
        (getComputedStyle(el).fontFamily || '').split(',').forEach((f) => used.add(norm(f)));
      }
    }

    // From the LIVE CSSOM, collect ONLY fonts inlined as data:/blob: — these are
    // self-contained decks whose src is a placeholder (e.g. a UUID) in the raw
    // CSS but a resolved data: URI once the page's loader runs, so the Node-side
    // parse below can't see them. http(s) faces are left to the Node path, which
    // fetches CDN stylesheets with a plain UA and so gets the FULL font instead of
    // the browser's per-script unicode-range SUBSETS (a subset embeds as a tiny
    // face missing most glyphs). Skip subset (unicode-range) faces for the same
    // reason.
    const dataFaces = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch (_) {
        continue; // cross-origin — handled Node-side via its <link> href
      }
      if (!rules) continue;
      for (const r of rules) {
        if (!r.constructor || r.constructor.name !== 'CSSFontFaceRule') continue;
        if ((r.style.getPropertyValue('unicode-range') || '').trim()) continue; // subset
        const src = r.style.getPropertyValue('src') || '';
        const m = src.match(/url\(\s*['"]?((?:data|blob):[^'")]+)['"]?\s*\)/i);
        if (!m) continue;
        const family = (r.style.getPropertyValue('font-family') || '').trim().replace(/^['"]|['"]$/g, '');
        const weight = parseInt(r.style.getPropertyValue('font-weight'), 10) || 400;
        if (family) dataFaces.push({ family, weight, url: m[1] });
      }
    }

    return {
      dataFaces,
      links: Array.from(document.querySelectorAll('link[rel~="stylesheet"]')).map((l) => l.href),
      inline: Array.from(document.querySelectorAll('style')).map((s) => s.textContent),
      usedFamilies: Array.from(used),
    };
  }, slideSelector);

  const used = new Set(usedFamilies);
  const byFamily = new Map(); // family -> { reg:{url,dist}, bold:{url,dist} }

  const add = (family, url, weight, baseUrl = pageBaseUrl) => {
    let abs;
    try {
      abs = /^(data|blob):/.test(url) ? url : new URL(url, baseUrl).href;
    } catch (_) {
      return;
    }
    const slot = byFamily.get(family) || { reg: null, bold: null };
    // Keep the weight closest to 400 for regular and closest to 700 for bold,
    // so bold/heavy text (e.g. a 900 title) embeds a real bold face instead of
    // being faux-bolded from Regular.
    const regDist = Math.abs(weight - 400);
    const boldDist = Math.abs(weight - 700);
    if (!slot.reg || regDist < slot.reg.dist) slot.reg = { url: abs, dist: regDist };
    if (weight >= 600 && (!slot.bold || boldDist < slot.bold.dist)) slot.bold = { url: abs, dist: boldDist };
    byFamily.set(family, slot);
  };

  // 1) Inlined data:/blob: faces first — authoritative for self-contained decks.
  //    woff2 is fine here; it is decoded to TTF downstream.
  for (const f of dataFaces) add(f.family, f.url, f.weight);

  // 2) Node-side parse of inline <style> + <link> stylesheets (CDN etc.). Prefer a
  //    directly-embeddable container (woff/ttf/otf) and skip woff2 here: a CDN's
  //    woff2 is served as unicode-range subsets, and a bare non-URL token (a
  //    placeholder UUID) has no extension to match — both are correctly ignored,
  //    leaving the full font from either the ttf CDN response or the data: face.
  const faceRe = /@font-face\s*\{([^}]*)\}/gi;
  const consider = (css, baseUrl) => {
    let m;
    while ((m = faceRe.exec(css))) {
      const body = m[1];
      const famM = body.match(/font-family\s*:\s*([^;]+)/i);
      if (!famM) continue;
      const family = famM[1].trim().replace(/^['"]|['"]$/g, '');
      const weight = parseInt((body.match(/font-weight\s*:\s*(\d+)/i) || [])[1], 10) || 400;

      const urls = [...body.matchAll(/url\(\s*['"]?([^'")]+?)['"]?\s*\)\s*format\(\s*['"]?([\w-]+)/gi)];
      let pick = urls.find((u) => /^(woff|truetype|opentype)$/i.test(u[2]));
      if (!pick) {
        const bare = body.match(/url\(\s*['"]?([^'")]+?\.(?:woff|ttf|otf))(?:[?#][^'")]*)?['"]?\s*\)/i);
        if (bare) pick = [bare[0], bare[1]];
      }
      if (pick) add(family, pick[1], weight, baseUrl);
    }
  };
  for (const css of inline) consider(css, pageBaseUrl);
  for (const href of links) {
    try {
      const r = await fetch(href);
      if (r.ok) consider(await r.text(), href);
    } catch (_) {
      /* unreachable stylesheet — skip */
    }
  }

  let entries = [...byFamily].filter(([, v]) => v.reg);
  // Keep only families the slides actually use — but never drop everything
  // (if the used-family scan came up empty, fall back to all resolved faces).
  const filtered = entries.filter(([name]) => used.has(name.toLowerCase()));
  if (filtered.length) entries = filtered;
  return entries.map(([name, v]) => ({ name, url: v.reg.url, boldUrl: v.bold && v.bold.url }));
}

/**
 * Ensure a resolved font URL is a container PowerPoint/dom-to-pptx can embed.
 * woff2 → decode and re-wrap as a `data:font/ttf` URI; everything else is left
 * untouched (http woff/ttf/otf stays a plain URL dom-to-pptx fetches itself).
 */
async function toEmbeddableUrl(page, url) {
  if (!url) return url;
  // Cheap check first: only fetch+decode when it's plausibly woff2.
  const looksWoff2 = /^data:font\/woff2/i.test(url) || /\.woff2(\?|#|$)/i.test(url);
  if (!looksWoff2 && !/^blob:/.test(url)) return url;
  let buf;
  try {
    buf = await fetchFontBuffer(page, url);
  } catch (_) {
    return url; // best-effort — fall back to the original URL
  }
  if (sniffFontType(buf) !== 'woff2') {
    // blob: that wasn't woff2 — still needs to be inlined so Node/PP can read it.
    if (/^blob:/.test(url)) return 'data:font/ttf;base64,' + buf.toString('base64');
    return url;
  }
  await ensureWoff2();
  const ttf = fontBufferToTtf(buf);
  return 'data:font/ttf;base64,' + ttf.toString('base64');
}

/** Fetch a web font (any container) and convert it to EOT for PowerPoint. */
async function fontUrlToEot(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('font fetch failed: ' + url.slice(0, 48));
  const buf = Buffer.from(await res.arrayBuffer());
  if (sniffFontType(buf) === 'woff2') await ensureWoff2();
  return fontBufferToEot(buf);
}

/**
 * dom-to-pptx embeds only a Regular face per family, so bold runs are faux-bolded
 * and look lighter than the real font. Add a real bold face: for each family that
 * actually has bold text, embed its bold weight into the <p:bold> slot.
 *
 * @param {Buffer} buf    the .pptx (already has Regular faces embedded)
 * @param {Array<{name:string,boldUrl?:string}>} fonts
 * @param {(m:string)=>void} log
 */
async function embedBoldWeights(buf, fonts, log) {
  const candidates = fonts.filter((f) => f.boldUrl);
  if (!candidates.length) return buf;

  const zip = await JSZip.loadAsync(buf);
  const presFile = zip.file('ppt/presentation.xml');
  const relsFile = zip.file('ppt/_rels/presentation.xml.rels');
  if (!presFile || !relsFile) return buf;

  // Which families are actually used in bold somewhere? (avoid bloating the file)
  const slideNames = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const usedBold = new Set();
  for (const n of slideNames) {
    const xml = await zip.file(n).async('string');
    // Each run: an rPr (maybe b="1") followed by its <a:latin typeface="...">.
    for (const run of xml.split('<a:rPr').slice(1)) {
      const head = run.slice(0, 400);
      if (!/\bb="1"/.test(head)) continue;
      const tf = head.match(/typeface="([^"]+)"/);
      if (tf) usedBold.add(tf[1]);
    }
  }

  const targets = candidates.filter((f) => usedBold.has(f.name));
  if (!targets.length) return buf;

  let pres = await presFile.async('string');
  let rels = await relsFile.async('string');
  let maxR = Math.max(0, ...[...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => +m[1]));
  let maxFont = Math.max(
    0,
    ...Object.keys(zip.files)
      .map((n) => (n.match(/ppt\/fonts\/(\d+)\.fntdata$/) || [])[1])
      .filter(Boolean)
      .map(Number)
  );

  const added = [];
  for (const f of targets) {
    let eot;
    try {
      eot = await fontUrlToEot(f.boldUrl);
    } catch (_) {
      continue;
    }
    maxFont++;
    maxR++;
    const file = `${maxFont}.fntdata`;
    const rid = `rId${maxR}`;
    zip.file(`ppt/fonts/${file}`, eot);
    rels = rels.replace(
      '</Relationships>',
      `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/${file}"/></Relationships>`
    );
    const esc = f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(<p:font typeface="${esc}"/>\\s*<p:regular[^>]*/>)`);
    if (re.test(pres)) {
      pres = pres.replace(re, `$1<p:bold r:id="${rid}"/>`);
      added.push(f.name);
    }
  }
  zip.file('ppt/presentation.xml', pres);
  zip.file('ppt/_rels/presentation.xml.rels', rels);
  if (added.length && log) log(`  → embedded bold weight for: ${added.join(', ')}`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Resolve the browser bundle that exposes the global `domToPptx`. */
function resolveBundlePath() {
  // require.resolve('dom-to-pptx') -> .../dist/dom-to-pptx.cjs
  const main = require.resolve('dom-to-pptx');
  const bundle = path.join(path.dirname(main), 'dom-to-pptx.bundle.js');
  if (!fs.existsSync(bundle)) {
    throw new Error(`dom-to-pptx browser bundle not found at: ${bundle}`);
  }
  return bundle;
}

/**
 * Convert a single HTML file to an editable .pptx buffer.
 *
 * @param {string} htmlPath           Absolute or relative path to the .html file.
 * @param {object} [opts]
 * @param {string} [opts.slideSelector='.slide']  CSS selector for each slide element.
 * @param {import('puppeteer').Browser} [opts.browser]  Reuse an existing browser.
 * @param {boolean} [opts.lockLineBreaks=true] Bake the browser's exact soft-wrap
 *        positions into the DOM as <br> so PowerPoint can't re-flow them.
 * @param {boolean} [opts.printMedia] Emulate `@media print`. Auto-enabled for
 *        slideshow decks that stack one slide at a time (e.g. <deck-stage>), so
 *        every slide is laid out, full-size and visible, for capture.
 * @param {string} [opts.aspect] Force slide aspect ratio e.g. "16:9" or "4:3".
 *        Default: auto-detect from the source slide's measured size (so 4:3,
 *        portrait, ultrawide decks are not cropped to 16:9).
 * @param {(msg:string)=>void} [opts.log]         Progress logger.
 * @returns {Promise<Buffer>} The .pptx file contents.
 */
async function convertHtmlToPptx(htmlPath, opts = {}) {
  let slideSelector = opts.slideSelector || '.slide';
  const userPickedSelector = !!opts.slideSelector;
  const lockLineBreaks = opts.lockLineBreaks !== false;
  const log = opts.log || (() => {});
  const bundlePath = resolveBundlePath();

  const absHtml = path.resolve(htmlPath);
  if (!fs.existsSync(absHtml)) {
    throw new Error(`Input HTML not found: ${absHtml}`);
  }
  const fileUrl = 'file://' + absHtml.replace(/\\/g, '/');

  // Reuse a caller-provided browser (batch mode) or launch a throwaway one.
  const ownBrowser = !opts.browser;
  const browser =
    opts.browser ||
    (await puppeteer.launch({
      headless: 'new',
      // In the packaged Electron app, point puppeteer at the bundled Chromium
      // (opts.executablePath). Omitted by the CLI/web → puppeteer's own default.
      executablePath: opts.executablePath || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }));

  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

    log(`  → loading ${path.basename(absHtml)}`);
    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 60000 });

    // Wait for web fonts so dom-to-pptx measures the real glyph metrics.
    await page.evaluate(() => document.fonts && document.fonts.ready);

    // Slideshow decks (e.g. the <deck-stage> web component) stack every slide
    // at the same spot and show one at a time — the hidden ones would export as
    // blank white slides. Such decks ship a print layout that lays them all out
    // full-size and visible; detect them, switch to that layout, and capture the
    // real slide unit (the slotted <section>s).
    const deck = await page.evaluate(() => {
      const decks = document.querySelectorAll('deck-stage');
      // `noscale` tells the deck to render at authored size (1:1) for capture.
      decks.forEach((d) => d.setAttribute('noscale', ''));
      return { isDeckStage: decks.length > 0 };
    });
    const usePrint = opts.printMedia !== undefined ? opts.printMedia : deck.isDeckStage;
    if (usePrint) {
      await page.emulateMediaType('print');
      await new Promise((r) => setTimeout(r, 400)); // let layout settle
      log('  → using print layout (all slides laid out full-size)');
    }
    if (deck.isDeckStage && !userPickedSelector) {
      slideSelector = 'deck-stage > section';
      log(`  → detected <deck-stage> deck → selector "${slideSelector}"`);
    }

    // General fidelity fixes (inline-margin gaps, decorative pseudo markers)
    // before measuring/baking so they're reflected in the captured layout.
    if (opts.enhanceFidelity !== false) {
      const fx = await page.evaluate(enhanceFidelityInPage, slideSelector);
      if (fx.gaps || fx.markers) {
        log(`  → fidelity fixes: ${fx.gaps} inline gap(s), ${fx.markers} marker(s)`);
      }
    }

    // Bake the browser's exact line-wrap positions into the DOM as <br>.
    // dom-to-pptx only emits hard breaks for block boundaries / existing <br>;
    // soft wraps are left to PowerPoint, which re-flows them with slightly
    // different metrics. Freezing them here keeps line breaks faithful.
    if (lockLineBreaks) {
      const broken = await page.evaluate(bakeLineBreaksInPage, slideSelector);
      log(`  → locked ${broken} soft line break(s) to match the HTML`);
    }

    // Verify slides exist before injecting the (heavy) converter bundle.
    const count = await page.$$eval(slideSelector, (els) => els.length);
    if (count === 0) {
      // Help the user figure out the right selector.
      const hint = await page.evaluate(() => {
        const ids = new Set();
        const classes = new Set();
        document.querySelectorAll('section,div,article').forEach((el) => {
          if (el.id) ids.add('#' + el.id);
          el.classList.forEach((c) => classes.add('.' + c));
        });
        return {
          ids: Array.from(ids).slice(0, 15),
          classes: Array.from(classes).slice(0, 25),
        };
      });
      const e = new Error(
        `No slides matched selector "${slideSelector}" in ${path.basename(absHtml)}.\n` +
          `  Candidate ids:     ${hint.ids.join(' ') || '(none)'}\n` +
          `  Candidate classes: ${hint.classes.join(' ') || '(none)'}\n` +
          `  Re-run with the right one, e.g.  --selector "section.slide"`
      );
      e.code = 'NO_SLIDES';
      throw e;
    }
    log(`  → found ${count} slide(s) for selector "${slideSelector}"`);

    // Slide size = the SOURCE's own aspect ratio, so 4:3 / portrait / ultrawide
    // decks aren't cropped to 16:9. Width is fixed at 10in; height follows the
    // measured aspect. An explicit opts.aspect ("16:9") overrides auto-detect.
    let aspect;
    if (opts.aspect && /^\s*\d+(\.\d+)?\s*[:x/]\s*\d+(\.\d+)?\s*$/.test(opts.aspect)) {
      const [aw, ah] = opts.aspect.split(/[:x/]/).map(Number);
      aspect = aw / ah;
    } else {
      aspect = await page.$eval(slideSelector, (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? r.width / r.height : 16 / 9;
      });
    }
    const slideW = 10;
    const slideH = +(slideW / aspect).toFixed(4);
    log(`  → slide ${slideW}in × ${slideH}in (${aspect.toFixed(3)}:1${Math.abs(aspect - 16 / 9) < 0.02 ? ' ≈ 16:9' : ''})`);

    // Surface the resolved counts/dimensions to callers (e.g. the desktop UI)
    // without changing the Buffer return value.
    if (typeof opts.onMeta === 'function') {
      opts.onMeta({ slideCount: count, selector: slideSelector, aspect, slideW, slideH });
    }

    // Resolve web fonts to embeddable (woff/ttf/otf) URLs so PowerPoint renders
    // the real font instead of a wider fallback that shifts the layout.
    let fonts = [];
    if (opts.embedFonts !== false) {
      try {
        fonts = await resolveEmbeddableFonts(page, fileUrl, slideSelector);
        // Decode woff2 (and inline blob:) to a data:font/ttf URI so PowerPoint
        // and dom-to-pptx's in-page embedder can actually read the face — both
        // are woff2-blind, which is why woff2-only decks came out with the font
        // tagged but not embedded (PowerPoint then substituted a fallback).
        for (const f of fonts) {
          f.url = await toEmbeddableUrl(page, f.url);
          if (f.boldUrl) f.boldUrl = await toEmbeddableUrl(page, f.boldUrl);
        }
        if (fonts.length) log(`  → embedding font(s): ${fonts.map((f) => f.name).join(', ')}`);
      } catch (_) {
        /* font resolution is best-effort */
      }
    }

    await page.addScriptTag({ path: bundlePath });

    log('  → converting (embedding fonts, vectorizing SVG)…');
    const base64 = await page.evaluate(async (sel, fonts, dims) => {
      const els = Array.from(document.querySelectorAll(sel));
      const blob = await domToPptx.exportToPptx(els, {
        skipDownload: true,
        autoEmbedFonts: true,
        fonts, // explicit woff/ttf/otf URLs resolved Node-side
        svgAsVector: true,
        width: dims.w, // custom slide size matching the source aspect ratio
        height: dims.h,
      });
      // Blob -> base64 data URL -> raw base64 string for transport to Node.
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }, slideSelector, fonts, { w: slideW, h: slideH });

    if (!base64) {
      throw new Error('Conversion returned empty output.');
    }
    let buf = Buffer.from(base64, 'base64');
    // Always fix too-small line spacing; disable wrapping only when we baked the
    // line breaks (so PowerPoint keeps them instead of re-flowing/word-splitting).
    buf = await postProcessSlides(buf, { noWrap: lockLineBreaks });
    if (fonts.length) {
      // dom-to-pptx only embeds a Regular face; add the real bold face so heavy
      // text (e.g. a 900-weight title) doesn't render as faux-bolded Regular.
      try {
        buf = await embedBoldWeights(buf, fonts, log);
      } catch (_) {
        /* bold embedding is best-effort */
      }
    }
    return buf;
  } finally {
    await page.close().catch(() => {});
    if (ownBrowser) {
      await browser.close().catch(() => {});
    }
  }
}

/**
 * Lightweight pre-flight: load the HTML and report how many slides will be
 * captured (and the source aspect ratio), without running the full conversion.
 * Used by the desktop UI to show "N slides detected" and to validate the
 * selector before the user commits to a convert. Mirrors the selector/deck-stage
 * resolution in convertHtmlToPptx but skips font embedding and the heavy bundle.
 *
 * @returns {Promise<{slideCount:number, selector:string, aspect:number, slideW:number, slideH:number}>}
 * @throws  Error with .code='NO_SLIDES' (and candidate id/class hints) if none match.
 */
async function detectSlides(htmlPath, opts = {}) {
  let slideSelector = opts.slideSelector || '.slide';
  const userPickedSelector = !!opts.slideSelector;
  const absHtml = path.resolve(htmlPath);
  if (!fs.existsSync(absHtml)) throw new Error(`Input HTML not found: ${absHtml}`);
  const fileUrl = 'file://' + absHtml.replace(/\\/g, '/');

  const ownBrowser = !opts.browser;
  const browser =
    opts.browser ||
    (await puppeteer.launch({
      headless: 'new',
      // In the packaged Electron app, point puppeteer at the bundled Chromium
      // (opts.executablePath). Omitted by the CLI/web → puppeteer's own default.
      executablePath: opts.executablePath || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }));

  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.evaluate(() => document.fonts && document.fonts.ready);

    const isDeckStage = await page.evaluate(() => {
      const decks = document.querySelectorAll('deck-stage');
      decks.forEach((d) => d.setAttribute('noscale', ''));
      return decks.length > 0;
    });
    const usePrint = opts.printMedia !== undefined ? opts.printMedia : isDeckStage;
    if (usePrint) {
      await page.emulateMediaType('print');
      await new Promise((r) => setTimeout(r, 400));
    }
    if (isDeckStage && !userPickedSelector) slideSelector = 'deck-stage > section';

    const count = await page.$$eval(slideSelector, (els) => els.length);
    if (count === 0) {
      const hint = await page.evaluate(() => {
        const ids = new Set();
        const classes = new Set();
        document.querySelectorAll('section,div,article').forEach((el) => {
          if (el.id) ids.add('#' + el.id);
          el.classList.forEach((c) => classes.add('.' + c));
        });
        return {
          ids: Array.from(ids).slice(0, 15),
          classes: Array.from(classes).slice(0, 25),
        };
      });
      const e = new Error(
        `No slides matched selector "${slideSelector}" in ${path.basename(absHtml)}.`
      );
      e.code = 'NO_SLIDES';
      e.selector = slideSelector;
      e.candidates = hint;
      throw e;
    }

    let aspect;
    if (opts.aspect && /^\s*\d+(\.\d+)?\s*[:x/]\s*\d+(\.\d+)?\s*$/.test(opts.aspect)) {
      const [aw, ah] = opts.aspect.split(/[:x/]/).map(Number);
      aspect = aw / ah;
    } else {
      aspect = await page.$eval(slideSelector, (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? r.width / r.height : 16 / 9;
      });
    }
    const slideW = 10;
    const slideH = +(slideW / aspect).toFixed(4);
    return { slideCount: count, selector: slideSelector, aspect, slideW, slideH };
  } finally {
    await page.close().catch(() => {});
    if (ownBrowser) await browser.close().catch(() => {});
  }
}

module.exports = { convertHtmlToPptx, detectSlides, resolveBundlePath };
