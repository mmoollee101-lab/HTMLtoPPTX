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

        // dom-to-pptx exports absolutely-positioned TEXT boxes reliably (like a
        // page number) but ignores background-only boxes, so render the marker as
        // a glyph: ● for a filled dot, ○ for an outlined ring.
        const round = (parseFloat(cs.borderRadius) || 0) > 0 || cs.borderRadius.includes('%');
        const glyph = hasBg ? (round ? '●' : '■') : round ? '○' : '□';
        const fill = hasBg ? bg : cs.borderTopColor;
        if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
        const dot = document.createElement('span');
        dot.textContent = glyph;
        // size the glyph (~0.78em visual) to roughly match the marker box
        const fontPx = Math.max(w, h) / 0.78;
        dot.style.cssText =
          `position:absolute;pointer-events:none;white-space:nowrap;` +
          `left:${cs.left};top:${cs.top};` +
          `width:${cs.width};height:${cs.height};` +
          `font-size:${fontPx}px;line-height:${h}px;color:${fill};` +
          (cs.transform !== 'none' ? `transform:${cs.transform};` : '');
        el.insertBefore(dot, el.firstChild);
        markers++;
      }
    }
  }
  return { gaps, markers };
}

/**
 * Find embeddable web fonts (Node side, so cross-origin CSS isn't blocked).
 *
 * dom-to-pptx's autoEmbedFonts reads @font-face via the page's cssRules, which
 * throws for cross-origin CDN stylesheets — so CDN fonts (Pretendard, etc.) end
 * up NOT embedded, and PowerPoint substitutes a wider fallback that shifts the
 * layout (e.g. a name and its title run into each other). Here we fetch each
 * stylesheet ourselves, pull the @font-face URLs, and prefer woff/ttf/otf (NOT
 * woff2 — the embedder can't decode it) so they can be embedded.
 *
 * @returns {Promise<Array<{name:string,url:string}>>} fonts for options.fonts
 */
async function resolveEmbeddableFonts(page, pageBaseUrl) {
  const sources = await page.evaluate(() => ({
    links: Array.from(document.querySelectorAll('link[rel~="stylesheet"]')).map((l) => l.href),
    inline: Array.from(document.querySelectorAll('style')).map((s) => s.textContent),
  }));

  const faceRe = /@font-face\s*\{([^}]*)\}/gi;
  const byFamily = new Map(); // family -> { url, dist }

  const consider = (css, baseUrl) => {
    let m;
    while ((m = faceRe.exec(css))) {
      const body = m[1];
      const famM = body.match(/font-family\s*:\s*([^;]+)/i);
      if (!famM) continue;
      const family = famM[1].trim().replace(/^['"]|['"]$/g, '');
      const weight = parseInt((body.match(/font-weight\s*:\s*(\d+)/i) || [])[1], 10) || 400;

      // url(...) format('woff'|'truetype'|'opentype') — skip woff2.
      const urls = [...body.matchAll(/url\(\s*['"]?([^'")]+?)['"]?\s*\)\s*format\(\s*['"]?([\w-]+)/gi)];
      let pick = urls.find((u) => /^(woff|truetype|opentype)$/i.test(u[2]));
      if (!pick) {
        const bare = body.match(/url\(\s*['"]?([^'")]+?\.(?:woff|ttf|otf))(?:[?#][^'")]*)?['"]?\s*\)/i);
        if (bare) pick = [bare[0], bare[1]];
      }
      if (!pick) continue;

      let abs;
      try { abs = new URL(pick[1], baseUrl).href; } catch (_) { continue; }

      const slot = byFamily.get(family) || { reg: null, bold: null };
      // Keep the weight closest to 400 for regular and closest to 700 for bold,
      // so bold/heavy text (e.g. a 900 title) embeds a real bold face instead of
      // being faux-bolded from Regular.
      const regDist = Math.abs(weight - 400);
      const boldDist = Math.abs(weight - 700);
      if (!slot.reg || regDist < slot.reg.dist) slot.reg = { url: abs, dist: regDist };
      if (weight >= 600 && (!slot.bold || boldDist < slot.bold.dist))
        slot.bold = { url: abs, dist: boldDist };
      byFamily.set(family, slot);
    }
  };

  for (const css of sources.inline) consider(css, pageBaseUrl);
  for (const href of sources.links) {
    try {
      const r = await fetch(href);
      if (r.ok) consider(await r.text(), href);
    } catch (_) {
      /* unreachable stylesheet — skip */
    }
  }
  return [...byFamily]
    .filter(([, v]) => v.reg)
    .map(([name, v]) => ({ name, url: v.reg.url, boldUrl: v.bold && v.bold.url }));
}

/** Fetch a web font and convert it to EOT (fntdata) for PowerPoint embedding. */
async function fontUrlToEot(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('font fetch failed: ' + url);
  const ab = await res.arrayBuffer();
  const ext = url.split('.').pop().split(/[?#]/)[0].toLowerCase();
  const type = ext === 'woff' ? 'woff' : ext === 'otf' ? 'otf' : 'ttf';
  const font = fonteditor.Font.create(Buffer.from(ab), {
    type,
    hinting: true,
    inflate: type === 'woff' ? pako.inflate : undefined,
  });
  const eot = font.write({ type: 'eot', toBuffer: true });
  return Buffer.isBuffer(eot) ? eot : Buffer.from(eot);
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

    // Resolve web fonts to embeddable (woff/ttf/otf) URLs so PowerPoint renders
    // the real font instead of a wider fallback that shifts the layout.
    let fonts = [];
    if (opts.embedFonts !== false) {
      try {
        fonts = await resolveEmbeddableFonts(page, fileUrl);
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

module.exports = { convertHtmlToPptx, resolveBundlePath };
