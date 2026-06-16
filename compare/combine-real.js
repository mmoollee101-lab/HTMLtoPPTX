// Pair the user's REAL PowerPoint screenshots (compare/ppt-real) with the HTML
// renders (compare/html) into stacked per-slide comparison images.
//
//   node compare/combine-real.js
//
// Real screenshots can be any image format; they're matched to HTML slides in
// numeric filename order (so "슬라이드1.PNG".."슬라이드10.PNG" or "1.jpg".. work).
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const dir = __dirname;
const realDir = process.argv[2] || path.join(dir, 'ppt-real');
const htmlDir = path.join(dir, 'html');
const outDir = path.join(dir, 'cmp-real');
fs.mkdirSync(outDir, { recursive: true });

const isImg = (f) => /\.(png|jpe?g|webp)$/i.test(f);
const firstNum = (s) => { const m = s.match(/\d+/); return m ? +m[0] : Number.MAX_SAFE_INTEGER; };
const natSort = (a, b) => firstNum(a) - firstNum(b) || a.localeCompare(b);

const real = fs.readdirSync(realDir).filter(isImg).sort(natSort);
const html = fs.readdirSync(htmlDir).filter(isImg).sort(natSort);
const toDataUri = (p) => {
  const ext = path.extname(p).slice(1).toLowerCase().replace('jpg', 'jpeg');
  return `data:image/${ext};base64,` + fs.readFileSync(p).toString('base64');
};

(async () => {
  if (!real.length) { console.log('compare/ppt-real 에 이미지가 없습니다.'); return; }
  console.log(`real=${real.length}, html=${html.length}`);
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 1480, deviceScaleFactor: 1 });

  const n = Math.min(real.length, html.length);
  for (let i = 0; i < n; i++) {
    const nn = String(i + 1).padStart(2, '0');
    const page = `<!doctype html><html><head><meta charset=utf-8><style>
      body{margin:0;background:#444;font-family:'Malgun Gothic',sans-serif}
      .wrap{width:1280px}.row{position:relative}
      .row img{display:block;width:1280px;border-bottom:2px solid #444}
      .tag{position:absolute;top:10px;left:10px;background:rgba(0,0,0,.7);color:#fff;
        font-size:22px;font-weight:700;padding:4px 14px;border-radius:6px}
      .tag.b{background:rgba(192,57,43,.85)}
    </style></head><body><div class=wrap>
      <div class=row><img src="${toDataUri(path.join(htmlDir, html[i]))}"><span class=tag>HTML (원본)</span></div>
      <div class=row><img src="${toDataUri(path.join(realDir, real[i]))}"><span class="tag b">PPT (실제 캡처)</span></div>
    </div></body></html>`;
    await p.setContent(page, { waitUntil: 'load' });
    await (await p.$('.wrap')).screenshot({ path: path.join(outDir, `cmp_${nn}.png`) });
  }
  await b.close();
  console.log('comparison images ->', outDir);
})();
