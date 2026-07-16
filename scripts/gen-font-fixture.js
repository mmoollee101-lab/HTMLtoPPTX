'use strict';

/**
 * Dev-only: (re)generate the self-contained font-embedding test fixture
 * `test/fixtures/datauri-woff2.html`.
 *
 * It subsets a Regular and a Bold source font down to a handful of glyphs, wraps
 * each as a `data:font/woff2` URI, and emits a one-slide HTML deck that uses both
 * weights. The result is what the R1 regression case in test/font-embed.test.js
 * converts — a woff2 font inlined as a data: URI, exactly the shape that once
 * came out with the font tagged but not embedded.
 *
 * This is NOT run by the test suite; the generated fixture is committed. Re-run
 * only when the fixture needs to change.
 *
 *   node scripts/gen-font-fixture.js <regular.(woff2|woff|ttf|otf)> <bold.(...)> [out.html]
 *
 * The subset is a Pretendard subset (OFL-1.1) — see test/fixtures/NOTICE.md.
 */

const fs = require('fs');
const path = require('path');
const fonteditor = require('fonteditor-core');
const pako = require('pako');

// Glyphs the fixture asserts coverage for: Latin "ABC" + Korean "가나다".
const CODEPOINTS = [0x41, 0x42, 0x43, 0xac00, 0xb098, 0xb2e4]; // A B C 가 나 다
const FAMILY = 'PretendardSubset';

function sniff(buf) {
  const s = buf.slice(0, 4).toString('latin1');
  return s === 'wOF2' ? 'woff2' : s === 'wOFF' ? 'woff' : s === 'OTTO' ? 'otf' : 'ttf';
}

async function subsetToWoff2(srcPath) {
  const buf = fs.readFileSync(srcPath);
  const type = sniff(buf);
  if (type === 'woff2') await fonteditor.woff2.init();
  const font = fonteditor.Font.create(buf, {
    type,
    subset: CODEPOINTS,
    hinting: false,
    inflate: type === 'woff' ? pako.inflate : undefined,
  });
  await fonteditor.woff2.init();
  const out = font.write({ type: 'woff2', toBuffer: true });
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

async function main() {
  const [reg, bold, out] = process.argv.slice(2);
  if (!reg || !bold) {
    console.error('usage: node scripts/gen-font-fixture.js <regular font> <bold font> [out.html]');
    process.exit(1);
  }
  const outPath = out || path.join(__dirname, '..', 'test', 'fixtures', 'datauri-woff2.html');

  const regB64 = (await subsetToWoff2(reg)).toString('base64');
  const boldB64 = (await subsetToWoff2(bold)).toString('base64');
  console.log(`regular subset: ${((regB64.length * 3) / 4 / 1024).toFixed(1)} KB`);
  console.log(`bold subset:    ${((boldB64.length * 3) / 4 / 1024).toFixed(1)} KB`);

  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>font-embed fixture</title>
<style>
  /* A Regular + a Bold @font-face, each an inlined data:font/woff2 — the exact
     shape self-contained decks emit and that the converter must embed. */
  @font-face {
    font-family: "${FAMILY}";
    font-weight: 400;
    font-style: normal;
    src: url("data:font/woff2;base64,${regB64}") format("woff2");
  }
  @font-face {
    font-family: "${FAMILY}";
    font-weight: 700;
    font-style: normal;
    src: url("data:font/woff2;base64,${boldB64}") format("woff2");
  }
  html, body { margin: 0; }
  .slide {
    width: 1280px; height: 720px; box-sizing: border-box; padding: 80px;
    font-family: "${FAMILY}", sans-serif; background: #fff; color: #111;
  }
  .title { font-weight: 700; font-size: 64px; }   /* uses the Bold face */
  .body  { font-weight: 400; font-size: 40px; }   /* uses the Regular face */
</style>
</head>
<body>
  <section class="slide">
    <div class="title">가나다 ABC</div>
    <div class="body">가나다 ABC</div>
  </section>
</body>
</html>
`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  console.log(`wrote ${outPath} (${(html.length / 1024).toFixed(1)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
