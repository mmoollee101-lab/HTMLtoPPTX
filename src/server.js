#!/usr/bin/env node
'use strict';

/**
 * Local web/desktop backend for HTML -> editable PPTX.
 *
 *   node src/server.js        # then open http://localhost:3000
 *
 * This is a *local* desktop utility: the browser sends the chosen .html as text,
 * the server runs the same conversion engine the CLI uses, writes the .pptx to
 * the user's output folder, and returns JSON metadata (slide count, size, path).
 * "Open" / "Show in folder" then ask the server to launch the OS file handler.
 * Everything stays on the user's machine — nothing is uploaded anywhere.
 *
 * Endpoints:
 *   GET  /                     static UI (public/)
 *   POST /api/detect           { html, selector? } -> { slideCount, selector, aspect }
 *   POST /api/convert          { html, selector?, name? } -> { fileName, bytes, slideCount, path }
 *   POST /api/open             { path } -> opens the file in the OS default app
 *   POST /api/reveal           { path } -> reveals the file in the OS file manager
 *
 * No external web framework — Node's built-in http only.
 * Note: relative asset paths in uploaded HTML won't resolve; use self-contained
 * HTML (absolute URLs or data: URIs) for the web app.
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const puppeteer = require('puppeteer');
const { convertHtmlToPptx, detectSlides } = require('./convert');
const { OUTPUT_DIR, safeBaseName, uniquePath, isAllowedPath } = require('./util');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// One shared browser for all requests (launched lazily, reused across calls).
let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserPromise;
}

function readBody(req, limitBytes = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error('Payload too large (max 25 MB).'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

async function parseJsonBody(req, res) {
  try {
    return JSON.parse(await readBody(req));
  } catch (e) {
    sendJson(res, 400, { error: 'Invalid request body: ' + e.message });
    return null;
  }
}

/** Write uploaded HTML to a temp file so puppeteer can load it as file://. */
function writeTempHtml(html) {
  const tmp = path.join(os.tmpdir(), `h2p-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  return tmp;
}

// ─────────────────────────── handlers ───────────────────────────

async function handleDetect(req, res) {
  const payload = await parseJsonBody(req, res);
  if (!payload) return;
  const html = payload.html;
  const selector = (payload.selector || '').trim() || undefined;
  if (!html || typeof html !== 'string') {
    return sendJson(res, 400, { error: 'No HTML content received.' });
  }
  const tmp = writeTempHtml(html);
  try {
    const browser = await getBrowser();
    const meta = await detectSlides(tmp, { slideSelector: selector, browser });
    sendJson(res, 200, meta);
  } catch (err) {
    sendJson(res, 422, {
      error: err.message,
      code: err.code || null,
      candidates: err.candidates || null,
    });
  } finally {
    fs.unlink(tmp, () => {});
  }
}

async function handleConvert(req, res) {
  const payload = await parseJsonBody(req, res);
  if (!payload) return;
  const html = payload.html;
  const selector = (payload.selector || '').trim() || undefined;
  const name = safeBaseName(payload.name);
  if (!html || typeof html !== 'string') {
    return sendJson(res, 400, { error: 'No HTML content received.' });
  }

  const tmp = writeTempHtml(html);
  let meta = {};
  try {
    const browser = await getBrowser();
    const buf = await convertHtmlToPptx(tmp, {
      slideSelector: selector,
      browser,
      onMeta: (m) => (meta = m),
      log: (m) => console.log(m.trim()),
    });

    const outPath = uniquePath(path.join(OUTPUT_DIR, `${name}.pptx`));
    fs.writeFileSync(outPath, buf);
    console.log(`✓ saved "${path.basename(outPath)}" (${(buf.length / 1024).toFixed(1)} KB) → ${outPath}`);

    sendJson(res, 200, {
      fileName: path.basename(outPath),
      path: outPath,
      bytes: buf.length,
      slideCount: meta.slideCount || null,
      selector: meta.selector || selector || null,
    });
  } catch (err) {
    console.error('✗', err.message);
    sendJson(res, 422, {
      error: err.message,
      code: err.code || null,
      candidates: err.candidates || null,
    });
  } finally {
    fs.unlink(tmp, () => {});
  }
}

function osOpen(target, reveal) {
  const p = path.resolve(target);
  if (process.platform === 'win32') {
    if (reveal) return execFile('explorer.exe', ['/select,', p]);
    return execFile('cmd.exe', ['/c', 'start', '', p]);
  }
  if (process.platform === 'darwin') {
    return execFile('open', reveal ? ['-R', p] : [p]);
  }
  // Linux / other: reveal opens the containing directory.
  return execFile('xdg-open', [reveal ? path.dirname(p) : p]);
}

async function handleOsAction(req, res, reveal) {
  const payload = await parseJsonBody(req, res);
  if (!payload) return;
  if (!isAllowedPath(payload.path)) {
    return sendJson(res, 400, { error: 'File not found or not allowed.' });
  }
  try {
    osOpen(payload.path, reveal);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

// ─────────────────────────── static ───────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  const full = path.join(PUBLIC_DIR, path.normalize(file));
  if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404);
    return res.end('Not found');
  }
  const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(full).pipe(res);
}

function createServer() {
  return http.createServer((req, res) => {
    if (req.method === 'POST') {
      if (req.url === '/api/detect') return handleDetect(req, res);
      if (req.url === '/api/convert') return handleConvert(req, res);
      if (req.url === '/api/open') return handleOsAction(req, res, false);
      if (req.url === '/api/reveal') return handleOsAction(req, res, true);
      res.writeHead(404);
      return res.end('Not found');
    }
    if (req.method === 'GET') return serveStatic(req, res);
    res.writeHead(405);
    res.end('Method not allowed');
  });
}

/** Start listening; resolves with { server, port }. Pass 0 for a free port. */
function start(port = PORT) {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(port, () => resolve({ server, port: server.address().port }));
  });
}

module.exports = { createServer, start, OUTPUT_DIR };

// Run as a plain web server when invoked directly.
if (require.main === module) {
  start().then(({ port }) => {
    console.log(`\n  HTML → editable PPTX web app`);
    console.log(`  ▶ http://localhost:${port}`);
    console.log(`  output → ${OUTPUT_DIR}\n`);
  });
}
