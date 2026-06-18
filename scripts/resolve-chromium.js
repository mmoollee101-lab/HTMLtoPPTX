#!/usr/bin/env node
'use strict';

/**
 * Prebuild step (runs as `predist`): stage Puppeteer's downloaded Chromium into
 * build/chromium/ so electron-builder can ship it via extraResources. Puppeteer's
 * cache layout is nested + revision-stamped, so we resolve the real exe and copy
 * its parent `chrome-win64` folder to a stable, build-number-free location.
 *
 * At runtime the packaged app finds it at  process.resourcesPath/chromium/chrome.exe
 * (electron/main.js → resolveChromium()).
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const exe = puppeteer.executablePath(); // .../chrome/win64-<build>/chrome-win64/chrome.exe
if (!exe || !fs.existsSync(exe)) {
  console.error('✗ Puppeteer Chromium not found at:', exe);
  console.error('  Run `npm install` (or `npx puppeteer browsers install chrome`) first.');
  process.exit(1);
}

const srcDir = path.dirname(exe);                       // .../chrome-win64
const destDir = path.join(__dirname, '..', 'build', 'chromium');

fs.rmSync(destDir, { recursive: true, force: true });
fs.mkdirSync(destDir, { recursive: true });
fs.cpSync(srcDir, destDir, { recursive: true });

const staged = path.join(destDir, 'chrome.exe');
if (!fs.existsSync(staged)) {
  console.error('✗ Staging failed — chrome.exe missing at', staged);
  process.exit(1);
}
console.log('✓ Staged Chromium →', path.relative(process.cwd(), destDir));
console.log('  from', srcDir);
