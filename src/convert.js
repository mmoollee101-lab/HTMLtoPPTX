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
 * @param {(msg:string)=>void} [opts.log]         Progress logger.
 * @returns {Promise<Buffer>} The .pptx file contents.
 */
async function convertHtmlToPptx(htmlPath, opts = {}) {
  const slideSelector = opts.slideSelector || '.slide';
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
    return Buffer.from(base64, 'base64');
  } finally {
    await page.close().catch(() => {});
    if (ownBrowser) {
      await browser.close().catch(() => {});
    }
  }
}

module.exports = { convertHtmlToPptx, resolveBundlePath };
