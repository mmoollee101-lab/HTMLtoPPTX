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

/**
 * Force every text box in a .pptx to wrap="none" so PowerPoint never re-wraps a
 * line (we've already baked the on-screen breaks). This prevents a wider
 * fallback font from splitting a word like "유정희" into "유정 / 희".
 *
 * @param {Buffer} buf  the .pptx file bytes
 * @returns {Promise<Buffer>} a new .pptx with wrapping disabled
 */
async function forceNoWrap(buf) {
  const zip = await JSZip.loadAsync(buf);
  const slideFiles = Object.keys(zip.files).filter((n) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(n)
  );
  for (const name of slideFiles) {
    let xml = await zip.file(name).async('string');
    // bodyPr with wrap="square" -> "none"; bodyPr missing wrap -> add wrap="none".
    xml = xml
      .replace(/(<a:bodyPr\b[^>]*?)\swrap="square"/g, '$1 wrap="none"')
      .replace(/<a:bodyPr\b(?![^>]*\bwrap=)/g, '<a:bodyPr wrap="none"');
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

    await page.addScriptTag({ path: bundlePath });

    log('  → converting (embedding fonts, vectorizing SVG)…');
    const base64 = await page.evaluate(async (sel) => {
      const els = Array.from(document.querySelectorAll(sel));
      const blob = await domToPptx.exportToPptx(els, {
        skipDownload: true,
        autoEmbedFonts: true,
        svgAsVector: true,
        layout: 'LAYOUT_16x9',
      });
      // Blob -> base64 data URL -> raw base64 string for transport to Node.
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }, slideSelector);

    if (!base64) {
      throw new Error('Conversion returned empty output.');
    }
    let buf = Buffer.from(base64, 'base64');
    if (lockLineBreaks) {
      // Disable text-box wrapping so PowerPoint keeps the baked line breaks and
      // never splits a word when substituting a wider fallback font.
      buf = await forceNoWrap(buf);
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
