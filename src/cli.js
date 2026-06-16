#!/usr/bin/env node
'use strict';

/**
 * CLI: convert finished HTML decks into editable PPTX.
 *
 *   html2pptx <input.html|folder> [output.pptx] [options]
 *
 *   --selector, -s   CSS selector for each slide   (default ".slide")
 *   --out, -o        output path / output folder (batch)
 *   --help, -h       show usage
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { convertHtmlToPptx } = require('./convert');

function printHelp() {
  console.log(`
html2pptx — convert finished HTML decks into EDITABLE PowerPoint (.pptx)

Usage:
  html2pptx <input.html>            [output.pptx]  [options]
  html2pptx <folder-of-html>        [output-dir]   [options]   (batch mode)

Options:
  -s, --selector <css>   CSS selector for each slide   (default: ".slide")
  -o, --out <path>       output .pptx (single) or output directory (batch)
  --no-lock-breaks       don't freeze line breaks; let PowerPoint re-flow text
  -h, --help             show this help

Examples:
  html2pptx deck.html
  html2pptx deck.html slides.pptx
  html2pptx deck.html -s "section.slide"
  html2pptx ./decks ./out -s ".page"

Fidelity tips (editable conversion is not pixel-perfect — that is normal):
  • Line breaks are FROZEN by default: the exact on-screen wrap points are baked
    in so PowerPoint shows the same line breaks (each visual line = a paragraph).
    Pass --no-lock-breaks to let PowerPoint re-flow text instead.
  • Author slides at a FIXED pixel size (e.g. 1920x1080). vw/vh/% units make the
    16:9 auto-scaling wobble.
  • To embed Google Fonts, the source <link> needs  crossorigin="anonymous"  or
    text falls back to Arial and line breaks shift.
  • For Korean text use  word-break: keep-all  and leave a little slack in text
    boxes so replacement copy doesn't overflow.
  • Need pixel-perfect & non-editable? Use a PDF export instead — out of scope here.
`);
}

function parseArgs(argv) {
  const args = { _: [], selector: '.slide', out: null, help: false, lockBreaks: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') args.help = true;
    else if (a === '-s' || a === '--selector') args.selector = argv[++i];
    else if (a === '-o' || a === '--out') args.out = argv[++i];
    else if (a === '--no-lock-breaks') args.lockBreaks = false;
    else args._.push(a);
  }
  return args;
}

/** Replace/append .pptx extension on an html filename. */
function defaultOutFor(htmlPath) {
  return htmlPath.replace(/\.html?$/i, '') + '.pptx';
}

async function convertOne(htmlPath, outPath, selector, browser, lockBreaks) {
  const buf = await convertHtmlToPptx(htmlPath, {
    slideSelector: selector,
    lockLineBreaks: lockBreaks,
    browser,
    log: (m) => console.log(m),
  });
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, buf);
  const kb = (buf.length / 1024).toFixed(1);
  console.log(`  ✓ saved ${outPath}  (${kb} KB)\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args._.length === 0) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const input = args._[0];
  // Second positional is output (path or dir) unless -o was given.
  const outArg = args.out || args._[1] || null;

  if (!fs.existsSync(input)) {
    console.error(`✗ Input not found: ${input}`);
    process.exit(1);
  }

  const isDir = fs.statSync(input).isDirectory();
  let browser;
  let hadError = false;
  try {
    if (isDir) {
      // ---- Batch mode ----
      const files = fs
        .readdirSync(input)
        .filter((f) => /\.html?$/i.test(f))
        .sort();
      if (files.length === 0) {
        console.error(`✗ No .html files found in folder: ${input}`);
        process.exit(1);
      }
      const outDir = outArg || input;
      fs.mkdirSync(outDir, { recursive: true });
      console.log(`Batch: ${files.length} file(s) → ${outDir}\n`);

      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const htmlPath = path.join(input, f);
        const outPath = path.join(outDir, defaultOutFor(f).split(/[\\/]/).pop());
        console.log(`[${i + 1}/${files.length}] ${f}`);
        try {
          await convertOne(htmlPath, outPath, args.selector, browser, args.lockBreaks);
        } catch (err) {
          hadError = true;
          console.error(`  ✗ ${err.message}\n`);
        }
      }
    } else {
      // ---- Single file ----
      const outPath = outArg || defaultOutFor(input);
      console.log(`Converting: ${input}`);
      await convertOne(input, outPath, args.selector, undefined, args.lockBreaks);
    }
  } catch (err) {
    hadError = true;
    console.error(`✗ ${err.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  if (hadError) process.exit(1);
  console.log('Done.');
}

main().catch((err) => {
  console.error(`✗ Unexpected error: ${err.stack || err.message}`);
  process.exit(1);
});
