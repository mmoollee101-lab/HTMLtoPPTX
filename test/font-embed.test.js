'use strict';

/**
 * Regression check for font EMBEDDING (not layout). Converts real decks and
 * asserts the output .pptx embeds a usable face — guarding the two failures the
 * woff2/data-URI fix addressed:
 *   R1  a woff2 font inlined as a data: URI must be embedded (was: tagged, not embedded)
 *   R2  a CDN font must embed FULL, not as a tiny unicode-range subset (network-gated)
 *
 * Run:  npm run test:fonts     (needs Puppeteer's Chromium; no PUPPETEER_SKIP_DOWNLOAD)
 */

const test = require('node:test');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { convertHtmlToPptx } = require('../src/convert');
const { assertEmbed } = require('./helpers/assert-embed');

const ROOT = path.join(__dirname, '..');
const quiet = { log() {} };

let browser;
test.before(async () => {
  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
});
test.after(async () => {
  if (browser) await browser.close();
});

// R1 — offline, always runs. A woff2 font inlined as a data: URI.
test('embeds a woff2 font inlined as a data: URI (R1)', async () => {
  const html = path.join(__dirname, 'fixtures', 'datauri-woff2.html');
  const pptx = await convertHtmlToPptx(html, { browser, ...quiet });
  await assertEmbed(pptx, {
    family: 'PretendardSubset',
    mustCover: [0x41, 0xac00], // "A", "가"
    bold: true,
    minBytes: 1000, // the subset is intentionally tiny; just assert it's non-empty
  });
});

// R2 — CDN font (Noto Sans KR). Network-gated: skips loudly if the CDN is
// unreachable, but a real embed failure while online still FAILS.
test('embeds a CDN font FULL, not a subset (R2)', async (t) => {
  // Quick reachability probe for the Google Fonts CSS endpoint.
  let online = true;
  try {
    const r = await fetch('https://fonts.googleapis.com/css2?family=Noto+Sans+KR&display=swap', {
      method: 'HEAD',
    });
    online = r.ok;
  } catch (_) {
    online = false;
  }
  if (!online) {
    t.skip('CDN unreachable — skipping the subset-trap check');
    return;
  }

  const html = path.join(ROOT, 'samples', 'sample.html');
  const pptx = await convertHtmlToPptx(html, { browser, ...quiet });
  await assertEmbed(pptx, {
    family: 'Noto Sans KR',
    mustCover: [0xac00], // "가" — a subset (the trap) had no Korean
    bold: true,
    minBytes: 500_000, // the full face is multi-MB; the 31 KB subset trap fails this
  });
});
