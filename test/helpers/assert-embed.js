'use strict';

const assert = require('node:assert');
const JSZip = require('jszip');
const fonteditor = require('fonteditor-core');

/**
 * Assert that a converted .pptx actually embeds a usable font face.
 *
 * Guards the two regressions from the woff2/data-URI fix:
 *   - font tagged but NOT embedded  → `ppt/fonts` empty / no embeddedFontLst
 *   - font embedded as a tiny unicode-range SUBSET → no CJK glyphs / below size floor
 *
 * @param {Buffer} pptx
 * @param {object} exp
 * @param {string}   exp.family      expected typeface in <p:embeddedFontLst>
 * @param {number[]} exp.mustCover   codepoints every embedded face's cmap must contain
 * @param {number}   [exp.minBytes=0] per-face fntdata size floor (subset guard)
 * @param {boolean}  [exp.bold=true] require a <p:bold> face in addition to <p:regular>
 * @returns {Promise<{faces:number}>}
 */
async function assertEmbed(pptx, exp) {
  const { family, mustCover, minBytes = 0, bold = true } = exp;
  const zip = await JSZip.loadAsync(pptx);

  const fontFiles = Object.keys(zip.files).filter((n) => /^ppt\/fonts\/.+\.fntdata$/.test(n));
  assert.ok(fontFiles.length > 0, `no embedded fonts (ppt/fonts empty) — expected "${family}"`);

  const pres = await zip.file('ppt/presentation.xml').async('string');
  const lst = (pres.match(/<p:embeddedFontLst>[\s\S]*?<\/p:embeddedFontLst>/) || [])[0];
  assert.ok(lst, 'no <p:embeddedFontLst> in presentation.xml');

  // The <p:embeddedFont> block for the expected family, with Regular (+ Bold).
  const esc = family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = (lst.match(new RegExp(`<p:embeddedFont>\\s*<p:font typeface="${esc}"/>[\\s\\S]*?</p:embeddedFont>`)) || [])[0];
  assert.ok(block, `family "${family}" not found in embeddedFontLst`);
  assert.ok(/<p:regular\b/.test(block), `no <p:regular> face for "${family}"`);
  if (bold) assert.ok(/<p:bold\b/.test(block), `no <p:bold> face for "${family}" (faux-bold regression?)`);

  // Every embedded EOT must decode and cover the required glyphs, and clear the
  // size floor (a 31 KB subset — the trap — would fail here).
  for (const name of fontFiles) {
    const buf = Buffer.from(await zip.file(name).async('nodebuffer'));
    assert.ok(
      buf.length >= minBytes,
      `${name} is ${buf.length}B (< ${minBytes}B floor) — looks like a subset, not the full face`
    );
    let font;
    try {
      font = fonteditor.Font.create(buf, { type: 'eot' });
    } catch (e) {
      assert.fail(`${name} did not decode as EOT: ${e.message}`);
    }
    const cmap = font.data.cmap || {};
    for (const cp of mustCover) {
      assert.ok(
        cmap[cp] !== undefined,
        `${name} ("${family}") cmap is missing U+${cp.toString(16).toUpperCase().padStart(4, '0')} — no glyph coverage`
      );
    }
  }

  return { faces: fontFiles.length };
}

module.exports = { assertEmbed };
