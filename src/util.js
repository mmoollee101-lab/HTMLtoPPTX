'use strict';

/**
 * Small helpers shared by the web server (src/server.js) and the Electron main
 * process (electron/main.js): the output directory, filename safety/dedup, and
 * the path guard for OS open/reveal. Kept transport-agnostic (no http, no electron).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/** Where converted .pptx files are written (system Downloads, else temp). */
const OUTPUT_DIR = (() => {
  const downloads = path.join(os.homedir(), 'Downloads');
  return fs.existsSync(downloads) ? downloads : os.tmpdir();
})();

/**
 * deck.html → "deck". Strip the extension and remove only characters that are
 * illegal in Windows filenames (and control chars) — keeping Unicode letters
 * (Korean, etc.), spaces, parentheses and the like, so "직무소개(실무)_발표용.html"
 * stays "직무소개(실무)_발표용" instead of collapsing to "___".
 */
function safeBaseName(name) {
  const base = (name || 'deck').replace(/\.html?$/i, '');
  const cleaned = base
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '') // illegal on Windows / control chars
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, ''); // no trailing dot/space (Windows)
  return cleaned || 'deck';
}

/** Avoid clobbering an existing file: deck.pptx → deck (1).pptx → deck (2).pptx */
function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p);
  const ext = path.extname(p);
  const base = path.basename(p, ext);
  for (let i = 1; i < 1000; i++) {
    const candidate = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return p;
}

/** Only allow opening/revealing files we actually wrote, inside OUTPUT_DIR. */
function isAllowedPath(p) {
  if (!p || typeof p !== 'string') return false;
  const resolved = path.resolve(p);
  const root = path.resolve(OUTPUT_DIR);
  return (resolved === root || resolved.startsWith(root + path.sep)) && fs.existsSync(resolved);
}

module.exports = { OUTPUT_DIR, safeBaseName, uniquePath, isAllowedPath };
