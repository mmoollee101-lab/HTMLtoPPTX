---
template: design
version: 1.2
feature: electron-portable
project: html-to-pptx
projectVersion: 1.0.0
author: mmoollee101-lab
date: 2026-06-17
status: Draft
planDoc: ../01-plan/features/electron-portable.plan.md
---

# electron-portable Design Document

> **Summary**: Wrap the existing Node + Puppeteer engine in a thin Electron shell — frameless
> window, IPC instead of HTTP, bundled Chromium — and package a portable Windows `.exe`.
>
> **Project**: html-to-pptx · **Version**: 1.0.0 · **Author**: mmoollee101-lab
> **Date**: 2026-06-17 · **Status**: Draft
> **Planning Doc**: [electron-portable.plan.md](../01-plan/features/electron-portable.plan.md)

---

## 1. Overview

### 1.1 Design Goals

- Reuse `src/convert.js` **unchanged**; Electron only adds a shell + IPC.
- One frameless window that matches `design_handoff_html_to_pptx/` (title bar = drag bar).
- Pass the **real file path** to the engine (so relative assets resolve — better than web mode).
- Bundle Puppeteer's Chromium so the packaged `.exe` runs with **no Node and no browser** installed.
- Keep `npm run web` (server) and the CLI working unchanged.

### 1.2 Design Principles

- **Engine is the single source of truth** — CLI, web server, and Electron all call the same
  `convert.js`. No conversion logic in the shell.
- **Least privilege renderer** — `contextIsolation: true`, `nodeIntegration: false`; the renderer
  only sees a curated `window.api` over IPC.
- **One code path, two transports** — the renderer prefers `window.api` (Electron IPC) and falls
  back to `fetch('/api/*')` (web). Minimal change to `public/index.html`.

---

## 2. Architecture

### 2.1 Process Model

```
┌──────────────────────────────────────── Electron app ────────────────────────────────────────┐
│                                                                                                │
│  Renderer (chromium)                 preload (contextBridge)            Main (node)             │
│  ┌────────────────────┐  window.api  ┌────────────────────┐  ipcRenderer ┌────────────────────┐│
│  │ public/index.html  │ ───────────▶ │ exposes:           │ ───invoke──▶ │ ipcMain handlers   ││
│  │ (UI, state machine)│              │  detect/convert    │              │  → convert.js       ││
│  │                    │ ◀─────────── │  open/reveal       │ ◀──result─── │  detectSlides()     ││
│  │                    │   result     │  chooseFile        │              │  convertHtmlToPptx()││
│  │                    │              │  pathForFile       │              │  shell.openPath     ││
│  │                    │              │  win.min/max/close │              │  BrowserWindow ctrl ││
│  └────────────────────┘              └────────────────────┘              └─────────┬──────────┘│
│                                                                                    │           │
│                                                              PUPPETEER_EXECUTABLE_PATH          │
│                                                                                    ▼           │
│                                                                       bundled Chromium (resources)
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow (convert)

```
drop/choose file → real path → api.detect(path) → {slideCount} shown ("N slides detected")
   → Convert → api.convert({path, selector, name}) → main runs convert.js with bundled Chromium
   → writes .pptx to Downloads → {fileName, path, bytes, slideCount} → complete state
   → Open / Show in folder → shell.openPath / shell.showItemInFolder(path)
```

### 2.3 Dependencies

| Component | Depends on | Purpose |
|-----------|-----------|---------|
| `electron/main.js` | `electron`, `src/convert.js`, `node:path/fs/os` | window + IPC + engine calls |
| `electron/preload.js` | `electron` (contextBridge, ipcRenderer, webUtils) | safe `window.api` bridge |
| `public/index.html` | `window.api` \| `fetch` | UI; transport‑agnostic |
| engine (`convert.js`) | `puppeteer` (env `PUPPETEER_EXECUTABLE_PATH` in packaged) | render + dom-to-pptx |
| packaging | `electron-builder` | portable `.exe`, asarUnpack, extraResources |

---

## 3. Module / File Structure

```
electron/
  main.js          app lifecycle; createWindow(); ipcMain handlers; resolveChromium()
  preload.js       contextBridge → window.api
scripts/
  resolve-chromium.js   prebuild: puppeteer.executablePath() → stage chrome-win64 → build/chromium
src/
  convert.js       +1 additive option: opts.executablePath (else current behavior)
  util.js          NEW — safeBaseName, uniquePath, isAllowedPath, OUTPUT_DIR (shared)
  cli.js           UNCHANGED
  server.js        kept for `npm run web`; imports the extracted helpers from util.js
public/
  index.html       renderer; add ~30‑line transport shim + explicit mode detection + Electron files
  icons/app.ico    app icon (already generated)
build/chromium/        staged Chromium (gitignored; produced by resolve-chromium.js)
package.json       "main": "electron/main.js"; build config; scripts (predist/app/dist)
```

> `src/app.js` (Puppeteer `--app` launcher) is kept until Electron parity is verified, then removed.
> Note: `npm run app` **changes meaning** (was: server + Chromium `--app`; now: `electron .`) — a
> breaking change for anyone relying on the old script. Documented in README.

---

## 4. IPC Contract (replaces "API Spec")

All channels are **`invoke/handle`** (promise‑based, request/response). Namespaced `h2p:*`.
Errors reject with `{ message, code?, candidates? }` (same shape the UI already handles).

| Channel | Request | Response | Notes |
|---------|---------|----------|-------|
| `h2p:choose-file` | — | `{ path, name, size } \| null` | native open dialog, `.html`/`.htm` filter |
| `h2p:detect` | `{ path, selector? }` | `{ slideCount, selector, aspect, slideW, slideH }` | rejects `NO_SLIDES` w/ `candidates` |
| `h2p:convert` | `{ path, selector?, name? }` | `{ fileName, path, bytes, slideCount, selector }` | writes `.pptx` to Downloads (dedup) |
| `h2p:open` | `{ path }` | `{ ok: true }` | `shell.openPath`; path‑guarded to output dir |
| `h2p:reveal` | `{ path }` | `{ ok: true }` | `shell.showItemInFolder` |
| `win:minimize` | — | — | `BrowserWindow.minimize()` |
| `win:close` | — | — | `BrowserWindow.close()` |

> No `win:maximize` — the window is fixed‑size (`resizable:false, maximizable:false`); see §5.2 and
> the Plan FR‑02 update.
>
> **Cancel semantics (S4).** The web UI's "Cancel" uses `fetch` + `AbortController`, which aborts the
> HTTP request. IPC `invoke/handle` has **no abort**, so over Electron "Cancel" only **resets the UI**;
> the in‑flight conversion finishes in the background and its output `.pptx` is written then **deleted**
> by main (it tracks the last convert and unlinks if the renderer signaled cancel). A `h2p:cancel`
> channel is *optional* (could close the engine's puppeteer page); for v1 the reset‑and‑discard
> behavior is acceptable and documented. The renderer's transport shim makes `controller.abort()` a
> no‑op in Electron.

> **Path‑based**, not html‑text based: in Electron we have the real file path, so the engine
> loads `file://` directly (no temp file, relative assets resolve). `webUtils.getPathForFile`
> (preload, **requires Electron ≥ 32**; legacy `File.path` was removed) turns a dropped `File` into
> its path.

### 4.1 preload.js (sketch)

```js
const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('api', {
  chooseFile: () => ipcRenderer.invoke('h2p:choose-file'),
  detect:  (req) => ipcRenderer.invoke('h2p:detect', req),
  convert: (req) => ipcRenderer.invoke('h2p:convert', req),
  open:    (path) => ipcRenderer.invoke('h2p:open', { path }),
  reveal:  (path) => ipcRenderer.invoke('h2p:reveal', { path }),
  pathForFile: (file) => webUtils.getPathForFile(file), // dropped File → real path
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    close:    () => ipcRenderer.invoke('win:close'),
  },
});
```

### 4.2 main.js (sketch)

```js
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { safeBaseName, uniquePath, isAllowedPath, OUTPUT_DIR } = require('../src/util');
// resolveChromium(): see §8.1 — returns the bundled chrome.exe path (packaged) or undefined (dev).

// Single instance: a portable exe double-clicked twice must not run two converters.
if (!app.requestSingleInstanceLock()) { app.quit(); return; }

let CHROME; // resolved once; passed as opts.executablePath to every engine call

function createWindow() {
  const win = new BrowserWindow({
    width: 720, height: 520, useContentSize: true,
    frame: false, resizable: false, maximizable: false, fullscreenable: false,
    backgroundColor: '#ffffff', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'),
                      contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  // Never navigate away from the local UI.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadFile(path.join(__dirname, '..', 'public', 'index.html'),
               { query: { shell: 'electron' } });
  return win;
}

app.whenReady().then(() => {
  CHROME = resolveChromium(); // throws a clear error if the bundled Chromium is missing
  const { detectSlides, convertHtmlToPptx } = require('../src/convert');
  const win = createWindow();
  app.on('second-instance', () => { if (win.isMinimized()) win.restore(); win.focus(); });

  const rejectShape = (err) =>
    Promise.reject({ message: err.message, code: err.code, candidates: err.candidates });

  ipcMain.handle('h2p:choose-file', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'], filters: [{ name: 'HTML', extensions: ['html', 'htm'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const p = r.filePaths[0];
    return { path: p, name: path.basename(p), size: fs.statSync(p).size };
  });

  ipcMain.handle('h2p:detect', (_e, { path: p, selector }) =>
    detectSlides(p, { slideSelector: selector || undefined, executablePath: CHROME }).catch(rejectShape));

  ipcMain.handle('h2p:convert', async (_e, { path: p, selector, name }) => {
    let meta = {};
    const buf = await convertHtmlToPptx(p, { slideSelector: selector || undefined,
      executablePath: CHROME, onMeta: (m) => (meta = m) }).catch(rejectShape);
    const out = uniquePath(path.join(OUTPUT_DIR, safeBaseName(name) + '.pptx'));
    fs.writeFileSync(out, buf);
    return { fileName: path.basename(out), path: out, bytes: buf.length,
             slideCount: meta.slideCount || null, selector: meta.selector || null };
  });

  ipcMain.handle('h2p:open',   (_e, { path: p }) =>
    isAllowedPath(p) ? shell.openPath(p).then(() => ({ ok: true })) : Promise.reject({ message: 'Not allowed' }));
  ipcMain.handle('h2p:reveal', (_e, { path: p }) => { if (isAllowedPath(p)) shell.showItemInFolder(p); return { ok: true }; });
  ipcMain.handle('win:minimize', () => win.minimize());
  ipcMain.handle('win:close',    () => win.close());
});

app.on('window-all-closed', () => app.quit());
```

> `safeBaseName`, `uniquePath`, `isAllowedPath`, `OUTPUT_DIR` are **extracted to `src/util.js`** and
> imported by both `src/server.js` and `electron/main.js` (DRY). `osOpen` stays in `server.js` only
> (Electron uses `shell.*` instead). `executablePath` is a **new additive option** on the engine
> (see §8.1.5); CLI/web pass nothing → unchanged behavior.

---

## 5. Window & UI Design

### 5.1 Frameless window

- `frame: false`, `resizable: false`, `maximizable: false` — fixed 720‑wide card per the handoff.
- The window **is** the card: no desktop backdrop, square or slightly rounded corners. (Windows
  doesn't round frameless content; keep 0 radius or accept OS rounding.)
- Loaded with `?shell=electron`; the renderer uses this (not the old `?app=1` edge‑to‑edge mode)
  to render the **full design including the faux title bar** as the drag region.

**Renderer mode detection (replaces the fragile `index.html:8` check).** Today the page does
`if (location.search.indexOf('app') > -1) … shell-app` (edge‑to‑edge, hides the title bar). That
substring check is brittle (it happens to miss `shell=electron` only by luck). Replace with explicit
parsing:

```js
const mode = new URLSearchParams(location.search).get('shell'); // 'electron' | null
// legacy server '--app' window passed ?app=1; map it to the edge-to-edge look:
const edgeToEdge = mode === 'app' || new URLSearchParams(location.search).has('app');
if (edgeToEdge) document.documentElement.classList.add('shell-app');
// Electron (mode==='electron'): keep the FULL design incl. title bar (no shell-app class).
```

Three modes are now unambiguous: **web** (no param, floating card), **legacy `?app`** (edge‑to‑edge,
used only by the soon‑to‑be‑removed `src/app.js`), **Electron `?shell=electron`** (full card as the
window, title bar = drag/controls).

### 5.2 Title bar = drag bar + controls

- `.titlebar { -webkit-app-region: drag; }`; interactive children get `no-drag`.
- The three mac dots become **functional + cross‑platform**: 🔴 red → `win.close()`, 🟡 yellow →
  `win.minimize()`, 🟢 green → decorative/disabled (window is fixed‑size). Hover reveals a faint
  glyph (×, –). This keeps the handoff visual while giving real controls.
- **Maximize is intentionally dropped** for this fixed‑size utility (`resizable:false`). This is a
  deliberate change from Plan FR‑02 ("minimize / maximize / close") — **Plan FR‑02 is updated** to
  "minimize / close (fixed‑size window, no maximize)". Recorded in both docs' Version History.
- Rationale over Windows‑style right buttons: preserves the design exactly; acceptable for a
  small fixed utility. (Revisit if user testing wants right‑side controls.)

### 5.3 Renderer transport shim (≈30 lines, added to `public/index.html`)

```js
const inElectron = !!window.api;
async function rpc(name, payload) {
  if (inElectron) return window.api[name](payload);             // IPC
  const res = await fetch('/api/' + name, { method:'POST',      // web fallback
    headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error||'failed'), { data });
  return data;
}
```

- **File choose**: Electron → `window.api.chooseFile()` (native dialog, real path); web → existing
  `<input type=file>` + FileReader text.
- **Drag‑drop**: Electron → `window.api.pathForFile(file)` to get the path; web → read text.
- **detect/convert**: Electron sends `{ path, ... }`; web sends `{ html, ... }`. The shim hides it.
- **open/reveal**: Electron → `window.api.open/reveal(path)`; web → `fetch('/api/open')`.

> Net change to the renderer is additive and guarded by `inElectron`; web mode is untouched.

### 5.4 Screen states

Unchanged — the five states (empty/file/converting/complete/error) and the simulated progress bar
stay exactly as built. Only the data source (IPC vs fetch) and file handling differ.

---

## 6. Error Handling

| Case | Surfaced as | Handling |
|------|-------------|----------|
| No slides matched | `code: NO_SLIDES` + `candidates` | error state shows "No slides detected" + candidate ids/classes (already implemented) |
| Chromium missing in packaged app | engine launch error | `resolveChromium()` validates; show a clear "Chromium runtime missing — reinstall" message |
| Convert engine throw | reject `{ message }` | error state shows the message; "Try again" / "Edit settings" |
| Open/reveal on a stale path | guard fails → reject | toast/no‑op; path was guaranteed at write time |
| Dialog canceled | `null` | stay on current state |

Renderer keeps the existing `showError(err)` which reads `err.data?.code/candidates`; IPC rejects
with the same shape so **no UI change** is needed.

---

## 7. Security Considerations

- [x] `contextIsolation: true`, `nodeIntegration: false`, **`sandbox: true`** — confirmed compatible
  because the preload uses only `contextBridge` / `ipcRenderer` / `webUtils` (all available to
  sandboxed preloads) and requires no other Node modules. **Electron ≥ 32** required for `webUtils`.
- [x] Renderer gets only the curated `window.api`; no `require`, no `fs` in the page.
- [x] `open`/`reveal` **path‑guarded** to `OUTPUT_DIR` (`isAllowedPath`, reject anything else) — reuse
  server guard via `src/util.js`.
- [x] No remote content loaded; `loadFile` only. `will-navigate` → `preventDefault`; window‑open →
  `setWindowOpenHandler` denies and routes to `shell.openExternal` (see §4.2).
- [x] IPC inputs validated (path is string + exists; selector trimmed).
- [ ] Code signing — **out of scope** (document the unsigned‑binary AV caveat in README).

---

## 8. Packaging Design (electron-builder)

> **Revised after design review (C1, S1, S2).** Two earlier assumptions were wrong: the Chromium
> exe path is **nested and build‑numbered**, and `asarUnpack` must include the engine deps that are
> loaded as real files (`dom-to-pptx` via `addScriptTag({path})`).

### 8.1 Chromium bundling strategy

Problem: Puppeteer downloads Chromium to a cache dir with a **nested, revision‑stamped** layout
(`<cache>/chrome/win64-<build>/chrome-win64/chrome.exe`); it must ship inside the portable exe and
be discoverable at runtime regardless of the build number.

**Concrete approach:**

1. **Pin** the download into the repo: install with `PUPPETEER_CACHE_DIR=<repo>/.puppeteer` so
   Chromium lands at `.puppeteer/chrome/win64-<build>/chrome-win64/`. (Add `.puppeteer/` to
   `.gitignore`; it's a build input, regenerated by `npm ci`.)
2. **Prebuild resolve** (`scripts/resolve-chromium.js`, run by the `dist` script before builder):
   `const p = require('puppeteer').executablePath()` → the exact `chrome.exe`. Write its **parent
   `chrome-win64` dir** to a known staging path and have `extraResources.from` point at it. (Don't
   hard‑code the build number.)
3. `extraResources` copies that `chrome-win64` folder → `resources/chromium/` in the build.
4. **Runtime `resolveChromium()` globs** for the exe instead of assuming a flat path (the folder
   may still contain a `chrome-win64` level depending on how `from` is set):

   ```js
   function resolveChromium() {
     if (!app.isPackaged) return; // dev: puppeteer.executablePath() finds the pinned cache
     const root = path.join(process.resourcesPath, 'chromium');
     // tolerate either resources/chromium/chrome.exe or .../chrome-win64/chrome.exe
     const candidates = [
       path.join(root, 'chrome.exe'),
       path.join(root, 'chrome-win64', 'chrome.exe'),
     ];
     const exe = candidates.find(fs.existsSync) || walkFind(root, 'chrome.exe');
     if (exe) return exe;                    // returned, passed as opts.executablePath
     throw new Error('Bundled Chromium not found under ' + root);
   }
   ```

5. **Do not rely on the env var alone.** `src/convert.js` launches puppeteer with **no
   `executablePath`** (convert.js:458, and inside `detectSlides`). Make a **minimal additive engine
   change**: both `convertHtmlToPptx` and `detectSlides` accept `opts.executablePath` and pass it to
   `puppeteer.launch({ executablePath })`. `main.js` passes the `resolveChromium()` result through
   every IPC engine call. This is backward‑compatible (CLI/web omit it → current behavior) and
   removes the dependence on `PUPPETEER_EXECUTABLE_PATH` precedence. (Env var may also be set as a
   belt‑and‑suspenders fallback.)

### 8.2 asar unpacking (S1, S2)

`addScriptTag({ path: bundlePath })` (convert.js:575, where `bundlePath = resolveBundlePath()` →
the `dom-to-pptx` UMD `.bundle.js`) needs a **real on‑disk file**; Puppeteer cannot read a script
tag from a virtual asar path. So `dom-to-pptx` **must** be unpacked. `fonteditor-core` (used for
bold‑weight embedding) is also unpacked to be safe. Pure‑JS deps (`jszip`, `pako`) work inside asar
but are cheap to unpack alongside.

### 8.3 package.json additions (sketch)

```jsonc
{
  "main": "electron/main.js",
  "scripts": {
    "app": "electron .",
    "web": "node src/server.js",
    "predist": "node scripts/resolve-chromium.js",   // stages chrome-win64 → build resource
    "dist": "electron-builder --win portable"
  },
  "build": {
    "appId": "com.htmltopptx.app",
    "productName": "HTML to PPTX",
    // keep electron-builder's default node_modules inclusion; only ADD/EXCLUDE:
    "files": ["electron/**", "src/**", "public/**", "node_modules/**", "!**/*.pptx", "!**/*.map"],
    "extraResources": [{ "from": "build/chromium", "to": "chromium" }],
    "asarUnpack": [
      "node_modules/puppeteer/**",
      "node_modules/puppeteer-core/**",
      "node_modules/dom-to-pptx/**",     // .bundle.js must be a real file (addScriptTag)
      "node_modules/fonteditor-core/**"
    ],
    "win": { "target": "portable", "icon": "public/icons/app.ico" },
    "portable": { "artifactName": "HTML-to-PPTX-${version}-portable.exe" }
  },
  "devDependencies": { "electron": "^33", "electron-builder": "^25" }
}
```

> **Verify in Do:** after `npm run dist`, inspect the unpacked `resources/app.asar.unpacked/` to
> confirm `dom-to-pptx/.../*.bundle.js` and the chromium exe exist; this is the single most likely
> late‑stage failure, so it's the **first** packaged smoke check.

### 8.4 Size & startup

- Expect ~250–300 MB unpacked (Chromium). Portable exe self‑extracts to `%TEMP%` on launch;
  `process.resourcesPath` and the `require('../src/convert')` (from `electron/main.js`) resolve from
  that extracted location — both ship in `files`, so the relative require survives packaging.
- `show:false` until `ready-to-show` avoids a white flash; first convert spawns Chromium (~1–2s).
- **Single instance:** `app.requestSingleInstanceLock()`; on `second-instance`, focus the existing
  window instead of opening a duplicate (avoids two instances writing to Downloads).

---

## 9. Test Plan

### 9.1 Scope

| Type | Target | Method |
|------|--------|--------|
| Smoke (dev) | `npm run app` opens window, converts sample | manual |
| Smoke (packaged) | `dist/*.exe` on a clean profile, no Node | manual / VM |
| Regression | CLI `npm run sample`, web `npm run web` still work | manual |
| Visual | window vs handoff (frameless, tokens) | puppeteer/screenshot or eyeball |

### 9.2 Key Cases

- [ ] Choose `samples/sample.html` via dialog → "3 slides detected" → convert → opens editable pptx.
- [ ] Drag‑drop a deck with **relative** image paths → resolves (proves real‑path advantage).
- [ ] Wrong selector → error state with candidate ids/classes.
- [ ] Title bar: drag moves window; red closes; yellow minimizes.
- [ ] Open / Show in folder launch the file / Explorer.
- [ ] Packaged exe: Chromium resolves (`PUPPETEER_EXECUTABLE_PATH` set); no console errors.
- [ ] CLI + web modes unchanged.

---

## 10. Implementation Order (for `/pdca do`)

1. [ ] Add `electron`, `electron-builder` devDeps; `package.json` `main` + scripts (`app`/`predist`/`dist`).
2. [ ] Extract `safeBaseName/uniquePath/isAllowedPath/OUTPUT_DIR` → `src/util.js`; repoint `server.js`.
3. [ ] Add additive `opts.executablePath` to `convertHtmlToPptx` **and** `detectSlides` (pass to `puppeteer.launch`); verify CLI/web unaffected.
4. [ ] `electron/main.js` + `preload.js`; frameless window loads `?shell=electron`; single‑instance lock; `will-navigate`/window‑open guards.
5. [ ] IPC handlers (`choose-file/detect/convert/open/reveal`, `win:minimize/close`) wired to engine with `executablePath: CHROME`.
6. [ ] Renderer: explicit mode detection (replace `index.html:8`); transport shim; Electron file choose (dialog) + drag‑drop `pathForFile`; dots → min/close + drag region. Web fallback intact.
7. [ ] Chromium bundling: `PUPPETEER_CACHE_DIR` pin, `scripts/resolve-chromium.js` (predist), `extraResources`, glob‑based `resolveChromium()`.
8. [ ] `electron-builder` config incl. **asarUnpack of `dom-to-pptx` + `fonteditor-core`**; `npm run dist`; **first check**: unpacked `.bundle.js` + chrome.exe exist; run packaged exe; convert sample.
9. [ ] Regression CLI/web; drag a deck with **relative assets** (proves real‑path); screenshot vs handoff; update README (download/run, `npm run app` change, AV caveat, roadmap tick).

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-06-17 | Initial design draft | mmoollee101-lab |
| 0.2 | 2026-06-17 | Design‑review fixes: glob‑based Chromium resolve + prebuild stage (C1); additive `opts.executablePath` engine option instead of env‑only (C1); `sandbox:true` firmed + Electron ≥32 pin (C2); asarUnpack `dom-to-pptx`+`fonteditor-core` for `addScriptTag` real file (S1); `files`/node_modules confirmed (S2); maximize dropped → Plan FR‑02 updated (S3); cancel‑over‑IPC semantics documented (S4); real helper names `safeBaseName`/`isAllowedPath` + `src/util.js` extraction (S5); explicit renderer mode detection de‑colliding `?app`/`?shell=electron`; single‑instance lock + navigation guards added | mmoollee101-lab |
