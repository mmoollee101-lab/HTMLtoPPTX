#!/usr/bin/env node
'use strict';

/**
 * Standalone desktop-style launcher.
 *
 *   node src/app.js   (or: npm run app)
 *
 * Starts the local server, then opens the UI in a chromeless "app window"
 * (Chromium --app mode) so it feels like a standalone program, not a browser
 * tab with an address bar. Closing the window shuts everything down.
 *
 * The window is launched & lifecycle-managed by puppeteer (so it stays attached
 * instead of handing off to an existing browser and exiting early), using the
 * Chromium bundled with puppeteer — always present since it's a dependency and
 * guaranteed compatible (driving a system Edge/Chrome via CDP is flaky).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');
const { start } = require('./server');

(async () => {
  const { server, port } = await start(0); // 0 = pick a free port
  // ?app=1 tells the page to render edge-to-edge (the OS draws the window frame),
  // so we don't get a faux title bar / desktop backdrop inside a real window.
  const url = `http://localhost:${port}/?app=1`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'h2p-app-'));

  console.log('  HTML → editable PPTX  (standalone)');
  console.log(`  server: ${url}`);
  console.log('  Close the window to quit.\n');

  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: profile,
    defaultViewport: null,
    ignoreDefaultArgs: ['--enable-automation'], // hide the automation banner
    args: [
      `--app=${url}`,
      // Snug fit for the edge-to-edge 720px layout (brand 262 + work panes).
      '--window-size=744,556',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  let done = false;
  function shutdown() {
    if (done) return;
    done = true;
    try { server.close(); } catch (_) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
    process.exit(0);
  }

  // Closing the app window disconnects the browser -> shut everything down.
  browser.on('disconnected', shutdown);
  process.on('SIGINT', async () => {
    try { await browser.close(); } catch (_) {}
    shutdown();
  });
})().catch((err) => {
  console.error('✗ Failed to launch app:', err.message);
  process.exit(1);
});
