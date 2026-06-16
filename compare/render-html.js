// Render each HTML slide (as the converter sees it: noscale + print) to a PNG.
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const file = process.argv[2];
const outDir = process.argv[3];
const url = 'file://' + path.resolve(file).replace(/\\/g, '/');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await p.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await p.evaluate(() => document.fonts.ready);
  await p.evaluate(() => document.querySelectorAll('deck-stage').forEach((d) => d.setAttribute('noscale', '')));
  await p.emulateMediaType('print');
  await new Promise((r) => setTimeout(r, 500));

  const handles = await p.$$('deck-stage > section');
  console.log('sections:', handles.length);
  for (let i = 0; i < handles.length; i++) {
    const n = String(i + 1).padStart(2, '0');
    await handles[i].screenshot({ path: path.join(outDir, `html_${n}.png`) });
  }
  await b.close();
  console.log('html slides ->', outDir);
})();
