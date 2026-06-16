#!/usr/bin/env node
'use strict';

/**
 * Minimal web app for HTML -> editable PPTX.
 *
 *   node src/server.js        # then open http://localhost:3000
 *
 * The browser reads the chosen .html file as text and POSTs it (plus the slide
 * selector) to /api/convert. The server writes it to a temp file, runs the same
 * conversion engine the CLI uses, and streams back the .pptx for download.
 *
 * No external web framework — Node's built-in http only.
 * Note: relative asset paths in uploaded HTML won't resolve; use self-contained
 * HTML (absolute URLs or data: URIs) for the web app.
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');
const { convertHtmlToPptx } = require('./convert');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// One shared browser for all requests (launched lazily).
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

async function handleConvert(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    return sendJson(res, 400, { error: 'Invalid request body: ' + e.message });
  }

  const html = payload.html;
  const selector = (payload.selector || '.slide').trim() || '.slide';
  const name = (payload.name || 'deck').replace(/\.html?$/i, '').replace(/[^\w.-]+/g, '_');

  if (!html || typeof html !== 'string') {
    return sendJson(res, 400, { error: 'No HTML content received.' });
  }

  // Write to a temp file so puppeteer can load it as a real page (file://).
  const tmp = path.join(os.tmpdir(), `h2p-${process.pid}-${Date.now()}.html`);
  try {
    fs.writeFileSync(tmp, html, 'utf8');
    const browser = await getBrowser();
    const buf = await convertHtmlToPptx(tmp, {
      slideSelector: selector,
      browser,
      log: (m) => console.log(m.trim()),
    });
    res.writeHead(200, {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${name}.pptx"`,
      'Content-Length': buf.length,
    });
    res.end(buf);
    console.log(`✓ converted "${name}" (${(buf.length / 1024).toFixed(1)} KB)`);
  } catch (err) {
    console.error('✗', err.message);
    sendJson(res, 422, { error: err.message });
  } finally {
    fs.unlink(tmp, () => {});
  }
}

function serveStatic(req, res) {
  const file = req.url === '/' ? 'index.html' : req.url.replace(/^\//, '');
  const full = path.join(PUBLIC_DIR, path.normalize(file));
  if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full)) {
    res.writeHead(404);
    return res.end('Not found');
  }
  const type = full.endsWith('.html')
    ? 'text/html; charset=utf-8'
    : full.endsWith('.css')
    ? 'text/css'
    : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(full).pipe(res);
}

function createServer() {
  return http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/convert') {
      return handleConvert(req, res);
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

module.exports = { createServer, start };

// Run as a plain web server when invoked directly.
if (require.main === module) {
  start().then(({ port }) => {
    console.log(`\n  HTML → editable PPTX web app`);
    console.log(`  ▶ http://localhost:${port}\n`);
  });
}
