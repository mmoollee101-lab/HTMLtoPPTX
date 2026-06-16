// Render a .pptx to per-slide PNGs using PPTXjs (browser renderer) in puppeteer.
// Works around corporate DRM that wraps PowerPoint's own image/PDF export.
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const pptxPath = process.argv[2];
const outDir = process.argv[3];
fs.mkdirSync(outDir, { recursive: true });
const pptxBytes = fs.readFileSync(pptxPath);

const cdn = 'https://cdn.jsdelivr.net/gh/meshesha/PPTXjs@v1.21.1';
const PAGE = `<!doctype html><html><head><meta charset=utf-8>
  <link rel="stylesheet" href="${cdn}/css/pptxjs.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Noto+Sans+KR:wght@400;500;700&display=swap">
  <script src="https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/jszip@2.6.1/dist/jszip.min.js"></script>
  <script src="${cdn}/js/filereader.js"></script>
  <script src="${cdn}/js/pptxjs.js"></script>
  <script src="${cdn}/js/divs2slides.js"></script>
  <style>body{margin:0;background:#fff}</style></head>
  <body><div id="r"></div></body></html>`;

// Same-origin server: serves the page AND the pptx (avoids CORS).
const server = http.createServer((req, res) => {
  if (req.url === '/deck.pptx') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    res.end(pptxBytes);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  }
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1320, height: 820, deviceScaleFactor: 1 });
  await p.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0', timeout: 60000 });

  await p.evaluate(() => {
    // eslint-disable-next-line no-undef
    $('#r').pptxToHtml({ pptxFileUrl: '/deck.pptx', slideMode: false, keyBoardShortCut: false });
  });

  // Wait until slides appear.
  await p.waitForFunction(() => document.querySelectorAll('.slide').length > 0, { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500)); // settle images/fonts

  const slides = await p.$$('.slide');
  console.log('pptxjs slides:', slides.length);
  for (let i = 0; i < slides.length; i++) {
    const n = String(i + 1).padStart(2, '0');
    await slides[i].screenshot({ path: path.join(outDir, `pptx_${n}.png`) });
  }
  await b.close();
  server.close();
  console.log('pptx renders ->', outDir);
})().catch((e) => { console.error('ERR', e.message); server.close(); process.exit(1); });
