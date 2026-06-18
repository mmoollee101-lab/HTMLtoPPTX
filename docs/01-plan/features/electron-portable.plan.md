---
template: plan
version: 1.2
feature: electron-portable
project: html-to-pptx
projectVersion: 1.0.0
author: mmoollee101-lab
date: 2026-06-17
status: Draft
---

# electron-portable Planning Document

> **Summary**: Repackage the existing Node + Puppeteer HTML→PPTX tool as a **portable
> Electron desktop app** — a single Windows executable, no Node install required, with a
> frameless window that matches the design handoff exactly.
>
> **Project**: html-to-pptx
> **Version**: 1.0.0
> **Author**: mmoollee101-lab
> **Date**: 2026-06-17
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

Today the app runs via `node src/app.js`, which boots a local HTTP server and opens a
Chromium `--app` window through Puppeteer. This requires **Node.js to be installed** and
leaves a **double window frame** (real OS frame + the design's faux title bar). We want a
**publicly distributable portable program**: download one file, double‑click, it runs — and
it looks like the handoff (single frameless window, the traffic‑light title bar *is* the
title bar).

### 1.2 Background

- The conversion engine (`src/convert.js`) **requires Chromium + Node** (Puppeteer renders
  the HTML, fetches/embeds fonts, runs `dom-to-pptx`). Electron bundles both, so the engine
  is reused **unchanged**; this is why Electron was chosen over Tauri.
- The UI (`public/index.html`) is already built to the handoff and supports an edge‑to‑edge
  "shell" mode (`?app=1`). It needs to become a real frameless window with working controls.

### 1.3 Related Documents

- Design spec: `design_handoff_html_to_pptx/README.md` (window shell, frameless intent)
- Current entry points: `src/app.js`, `src/server.js`, `src/convert.js`, `public/index.html`
- Memory: distribution-direction (Electron via PDCA)

---

## 2. Scope

### 2.1 In Scope

- [ ] Add Electron shell (main + preload + reuse renderer `public/index.html`).
- [ ] **Frameless window** (`frame:false`) matching the handoff; custom title bar becomes the
      drag region; working **minimize / maximize / close** controls.
- [ ] Replace the localhost HTTP calls with **IPC** (`detect`, `convert`, `open`, `reveal`),
      keeping `convert.js`/`detectSlides()` as the shared engine.
- [ ] **Native file open dialog** + OS drag‑drop that yields a **real file path** (so relative
      assets resolve — fixes the web‑mode self‑contained‑only limitation).
- [ ] **Bundle Puppeteer's Chromium** into the package and resolve its path at runtime in both
      dev and packaged (asar) modes.
- [ ] **electron-builder portable target** for Windows (`.exe`), app icon = `app.ico`.
- [ ] Smoke‑run the packaged `.exe` on a clean profile; convert `samples/sample.html`.

### 2.2 Out of Scope

- macOS / Linux packaged builds (structure for it, ship Windows first).
- Auto‑update, code signing / notarization.
- Per‑slide *real* conversion progress (engine is one opaque step; keep simulated bar).
- Rewriting the conversion engine or switching to Electron's own Chromium for rendering.

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | Electron main process opens a single frameless 720‑wide window rendering the existing UI | High | Pending |
| FR-02 | Custom title bar is draggable; **minimize / close** buttons work (fixed‑size window — no maximize) | High | Pending |
| FR-03 | `detect` / `convert` run via IPC using `convert.js` (no HTTP server in the packaged app) | High | Pending |
| FR-04 | "Choose file" opens a native dialog; OS drag‑drop passes the real file path | High | Pending |
| FR-05 | `Open` / `Show in folder` use Electron `shell` APIs (path‑guarded to output dir) | High | Pending |
| FR-06 | Puppeteer Chromium is bundled; engine resolves its executable in packaged mode | High | Pending |
| FR-07 | `npm run dist` produces a portable Windows `.exe` with the app icon | High | Pending |
| FR-08 | Output `.pptx` is saved to Downloads; filename de‑duplicated as today | Medium | Pending |
| FR-09 | `npm run app` (dev) launches the Electron app with devtools available | Medium | Pending |
| FR-10 | Existing CLI (`src/cli.js`) and web (`src/server.js`) modes keep working | Medium | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| Portability | Runs on a clean Windows 10/11 with **no Node installed** | Launch on a fresh user profile / VM |
| Startup | Cold start to interactive < 3s (excluding first Chromium spawn) | Manual timing |
| Size | Portable `.exe` ≤ ~300 MB (Chromium dominates) | Inspect `dist/` artifact |
| Fidelity | Window visually matches the handoff (frameless, tokens) | Screenshot vs `design_handoff_*` |
| Reliability | Sample deck converts identically to the current CLI output | Compare slide count / open in PowerPoint |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] All High‑priority FRs implemented.
- [ ] Packaged `.exe` converts `samples/sample.html` to an editable `.pptx`.
- [ ] Window matches the handoff (frameless, working controls), verified by screenshot.
- [ ] CLI and web modes unaffected (regression check).
- [ ] README updated: portable download/run instructions; roadmap item checked off.

### 4.2 Quality Criteria

- [ ] Gap analysis (`/pdca analyze electron-portable`) match rate ≥ 90%.
- [ ] No console errors in the packaged app during a full convert flow.
- [ ] Chromium path resolves in **both** `npm run app` and the packaged `.exe`.

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Puppeteer Chromium not found in packaged (asar) app | High | High | `asarUnpack` the chromium dir via `extraResources`; set `PUPPETEER_EXECUTABLE_PATH`; add a runtime resolver with a clear error |
| `convert.js` bundling/native deps break under asar (`fonteditor-core`, `pako`, `jszip`) | High | Medium | Unpack `node_modules/puppeteer` + engine deps from asar; verify on packaged build early |
| Frameless window: broken drag region / non‑functional controls on Windows | Medium | Medium | `-webkit-app-region: drag/no-drag`; implement window controls via IPC (`minimize/maximize/close`) |
| Portable `.exe` flagged by antivirus (unsigned) | Medium | Medium | Document it; plan code signing later (out of scope); prefer a zipped folder fallback |
| File size too large to "share easily" | Low | High | Accept (Chromium is required); offer a zip; consider compression in builder |
| Drag‑drop path access differs from `<input type=file>` | Low | Medium | Use Electron `webUtils.getPathForFile` / dialog; keep `?app` shell behavior |

---

## 6. Architecture Considerations

### 6.1 Project Level

This is a **desktop packaging** task, not a web tier. The repo stays plain CommonJS (no
framework). Electron adds a thin shell around the existing engine; no React/Next migration.

### 6.2 Key Architectural Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| Shell framework | Electron / Tauri | **Electron** | Bundles Node + Chromium that the engine already needs; reuse `convert.js` unchanged |
| Renderer ↔ engine | Keep localhost HTTP / **IPC** | **IPC** | No open port, no server lifecycle; cleaner + safer for a packaged app |
| Reuse vs rewrite UI | Reuse `public/index.html` / rebuild | **Reuse** | Already handoff‑faithful; add a small `window.api` shim over IPC |
| Chromium source | Puppeteer's bundled / system | **Puppeteer bundled** | Guaranteed‑compatible; no dependency on user's browser |
| Packager | electron-builder / electron-forge / Forge | **electron-builder** | Simple `portable` Windows target, icon, asarUnpack control |
| Window frame | native / **frameless** | **frameless** | Matches the handoff; custom title bar = drag bar |

### 6.3 Target Structure

```
electron/
  main.js        app lifecycle, BrowserWindow (frameless), IPC handlers
  preload.js     contextBridge → window.api { detect, convert, open, reveal, win:* }
src/
  convert.js     (unchanged) — detectSlides / convertHtmlToPptx
  cli.js         (unchanged)
  server.js      (kept for `npm run web`)
public/
  index.html     renderer — calls window.api when present, else falls back to fetch (web)
build/
  app.ico        from public/icons (already generated)
package.json     "main": "electron/main.js", build config, scripts: app/dist/web
```

The renderer detects Electron (`window.api`) and routes detect/convert/open/reveal through
IPC; in a plain browser it keeps using the existing `/api/*` fetch calls (web mode lives on).

---

## 7. Convention / Prerequisites

### 7.1 Existing Conventions

- [x] Plain CommonJS, Node ≥ 18, no build step, 2‑space indent (matches current `src/`).
- [x] Engine is entry‑point‑agnostic (CLI/web/app all call `convert.js`). Keep that.

### 7.2 To Add

| Item | Current | To Define | Priority |
|------|---------|-----------|:--------:|
| Electron + electron-builder devDeps | missing | add to `devDependencies` | High |
| `package.json` `main` + `build` block | missing | add (portable target, asarUnpack) | High |
| IPC channel names | missing | `h2p:detect/convert/open/reveal`, `win:min/max/close` | High |
| Chromium path env | missing | `PUPPETEER_EXECUTABLE_PATH` resolver | High |

### 7.3 New Dependencies

| Package | Purpose | Scope |
|---------|---------|-------|
| `electron` | desktop runtime | devDependency |
| `electron-builder` | portable `.exe` packaging | devDependency |

---

## 8. Implementation Phases (preview for Design)

1. **Shell up** — `electron/main.js` + `preload.js`; load `public/index.html`; frameless window.
2. **IPC engine** — wire detect/convert/open/reveal to `convert.js`; `window.api` shim in renderer.
3. **Window chrome** — drag region + min/max/close controls; reuse the faux title bar.
4. **File input** — native dialog + drag‑drop real paths.
5. **Package** — electron-builder config, bundle Chromium (asarUnpack), build portable `.exe`.
6. **Verify** — run packaged exe, convert sample, screenshot vs handoff; regression CLI/web.

---

## 9. Next Steps

1. [ ] `/pdca design electron-portable` — detail IPC contract, main/preload code, builder config.
2. [ ] Implement per the design (`/pdca do`).
3. [ ] `/pdca analyze` gap check → iterate to ≥ 90% → `/pdca report`.

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-06-17 | Initial draft | mmoollee101-lab |
| 0.2 | 2026-06-17 | FR‑02 updated: drop maximize for the fixed‑size window (minimize/close only), per design review S3 | mmoollee101-lab |
