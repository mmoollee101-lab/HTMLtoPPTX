// Stack HTML (top) and PPT (bottom) per slide into one labeled comparison image.
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const dir = __dirname;
const outDir = path.join(dir, 'cmp');
fs.mkdirSync(outDir, { recursive: true });

const toDataUri = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');

(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 1480, deviceScaleFactor: 1 });

  const n = fs.readdirSync(path.join(dir, 'html')).filter((f) => f.endsWith('.png')).length;
  for (let i = 1; i <= n; i++) {
    const nn = String(i).padStart(2, '0');
    const htmlP = path.join(dir, 'html', `html_${nn}.png`);
    const pptP = path.join(dir, 'pptx', `pptx_${nn}.png`);
    if (!fs.existsSync(htmlP) || !fs.existsSync(pptP)) continue;

    const page = `<!doctype html><html><head><meta charset=utf-8><style>
      body{margin:0;background:#444;font-family:'Malgun Gothic',sans-serif}
      .wrap{width:1280px}
      .row{position:relative}
      .row img{display:block;width:1280px;border-bottom:2px solid #444}
      .tag{position:absolute;top:10px;left:10px;background:rgba(0,0,0,.7);color:#fff;
        font-size:22px;font-weight:700;padding:4px 14px;border-radius:6px}
      .tag.b{background:rgba(192,57,43,.85)}
    </style></head><body><div class=wrap>
      <div class=row><img src="${toDataUri(htmlP)}"><span class=tag>HTML (원본)</span></div>
      <div class=row><img src="${toDataUri(pptP)}"><span class="tag b">PPT (변환)</span></div>
    </div></body></html>`;
    await p.setContent(page, { waitUntil: 'load' });
    const wrap = await p.$('.wrap');
    await wrap.screenshot({ path: path.join(outDir, `cmp_${nn}.png`) });
  }
  await b.close();
  console.log('comparison images ->', outDir);
})();
