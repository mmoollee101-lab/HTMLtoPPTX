'use strict';

/**
 * Electron main process — the desktop shell around the conversion engine.
 *
 * Reuses src/convert.js unchanged (via the additive opts.executablePath) and
 * exposes detect/convert/open/reveal + window controls over IPC. The renderer is
 * the same public/index.html the web app uses, loaded with ?shell=electron so it
 * renders the full frameless card (title bar = drag region).
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { OUTPUT_DIR, safeBaseName, uniquePath, isAllowedPath } = require('../src/util');

// A portable exe double-clicked twice must not run two converters.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let CHROME; // resolved bundled Chromium path (packaged) or undefined (dev)
  let mainWindow = null;

  /**
   * Find the bundled Chromium inside the packaged app. The puppeteer cache layout
   * is nested + revision-stamped, so glob/walk for chrome.exe rather than assume a
   * flat path. In dev, return undefined → puppeteer resolves its own cache.
   */
  function resolveChromium() {
    if (!app.isPackaged) return undefined;
    const root = path.join(process.resourcesPath, 'chromium');
    const direct = [
      path.join(root, 'chrome.exe'),
      path.join(root, 'chrome-win64', 'chrome.exe'),
    ].find((p) => fs.existsSync(p));
    if (direct) return direct;
    const found = walkFind(root, 'chrome.exe', 4);
    if (found) return found;
    throw new Error('Bundled Chromium (chrome.exe) not found under ' + root);
  }

  /** Shallow bounded recursive search for a filename under dir. */
  function walkFind(dir, name, depth) {
    if (depth < 0 || !fs.existsSync(dir)) return null;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return null;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && e.name === name) return full;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        const hit = walkFind(path.join(dir, e.name), name, depth - 1);
        if (hit) return hit;
      }
    }
    return null;
  }

  function createWindow() {
    const win = new BrowserWindow({
      width: 720,
      height: 520,
      useContentSize: true,
      frame: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      backgroundColor: '#ffffff',
      icon: path.join(__dirname, '..', 'public', 'icons', 'app.ico'),
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.once('ready-to-show', () => win.show());
    // Never navigate away from the local UI; open external links in the OS browser.
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.loadFile(path.join(__dirname, '..', 'public', 'index.html'), {
      query: { shell: 'electron' },
    });
    return win;
  }

  app.whenReady().then(() => {
    try {
      CHROME = resolveChromium();
    } catch (err) {
      dialog.showErrorBox('HTML to PPTX', err.message + '\n\nThe app may not convert files.');
    }

    const { detectSlides, convertHtmlToPptx } = require('../src/convert');
    mainWindow = createWindow();

    app.on('second-instance', () => {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    });

    const rejectShape = (err) =>
      Promise.reject({ message: err.message, code: err.code, candidates: err.candidates });

    ipcMain.handle('h2p:choose-file', async () => {
      const r = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
      });
      if (r.canceled || !r.filePaths[0]) return null;
      const p = r.filePaths[0];
      return { path: p, name: path.basename(p), size: fs.statSync(p).size };
    });

    ipcMain.handle('h2p:detect', (_e, { path: p, selector }) =>
      detectSlides(p, { slideSelector: selector || undefined, executablePath: CHROME }).catch(rejectShape)
    );

    ipcMain.handle('h2p:convert', async (_e, { path: p, selector, name }) => {
      let meta = {};
      let buf;
      try {
        buf = await convertHtmlToPptx(p, {
          slideSelector: selector || undefined,
          executablePath: CHROME,
          onMeta: (m) => (meta = m),
        });
      } catch (err) {
        return rejectShape(err);
      }
      const out = uniquePath(path.join(OUTPUT_DIR, safeBaseName(name) + '.pptx'));
      fs.writeFileSync(out, buf);
      return {
        fileName: path.basename(out),
        path: out,
        bytes: buf.length,
        slideCount: meta.slideCount || null,
        selector: meta.selector || null,
      };
    });

    ipcMain.handle('h2p:open', (_e, { path: p }) =>
      isAllowedPath(p)
        ? shell.openPath(p).then(() => ({ ok: true }))
        : Promise.reject({ message: 'File not found or not allowed.' })
    );

    ipcMain.handle('h2p:reveal', (_e, { path: p }) => {
      if (isAllowedPath(p)) shell.showItemInFolder(p);
      return { ok: true };
    });

    // Cancelled-but-finished conversion: discard the orphan output (path-guarded).
    ipcMain.handle('h2p:discard', (_e, { path: p }) => {
      if (isAllowedPath(p)) { try { fs.unlinkSync(p); } catch (_) {} }
      return { ok: true };
    });

    ipcMain.handle('win:minimize', () => mainWindow && mainWindow.minimize());
    ipcMain.handle('win:close', () => mainWindow && mainWindow.close());

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });

  app.on('window-all-closed', () => app.quit());
}
