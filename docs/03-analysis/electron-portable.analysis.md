---
template: analysis
feature: electron-portable
project: html-to-pptx
date: 2026-06-17
matchRate: 99
verdict: ready-for-report
---

# electron-portable — Gap Analysis (PDCA Check)

> **Match Rate: 99%** · Verdict: **Ready for report** (≥ 90%) · No Critical / Should-fix gaps.
> Method: `gap-detector` compared design v0.2 + plan (FR-01..FR-10, §10 steps) against the
> implementation. Plus runtime verification (below) done during Do.

## Scores

| Category | Score |
|----------|:-----:|
| Design match (§4–§8 + §10) | 99% |
| Architecture compliance (engine-as-truth, least-privilege renderer, one-path/two-transports) | 100% |
| Convention compliance (CommonJS, naming, DRY) | 100% |
| **Overall** | **99%** |

## Functional Requirements

| FR | Status | Evidence |
|----|:------:|----------|
| FR-01 frameless 720 window, existing UI | ✅ | `electron/main.js` (width 720, `frame:false`, `resizable:false`), loads `public/index.html?shell=electron` |
| FR-02 draggable bar; minimize/close (no maximize) | ✅ | `win:minimize`/`win:close` in main+preload; renderer wires `winClose`/`winMin`; no `win:maximize` anywhere |
| FR-03 detect/convert via IPC reusing engine | ✅ | `main.js` calls `detectSlides`/`convertHtmlToPptx`; renderer uses `window.api` when `inElectron` |
| FR-04 native dialog + drag-drop real path | ✅ | `h2p:choose-file`; `webUtils.getPathForFile` in preload |
| FR-05 open/reveal via shell, path-guarded | ✅ | `h2p:open`/`reveal` guarded by `isAllowedPath` |
| FR-06 bundled Chromium resolves in packaged app | ✅ | `resolveChromium()` glob; `executablePath` → engine; **verified converting with the bundled binary** |
| FR-07 portable Windows .exe + icon | ✅ | `build.win.target=portable`; **built `dist/HTML-to-PPTX-1.0.0-portable.exe` (171 MB)** |
| FR-08 output to Downloads, dedup | ✅ | `OUTPUT_DIR` + `uniquePath` (src/util.js) |
| FR-09 `npm run app` dev launches Electron | ✅ | `"app":"electron ."`, `main` set (devtools available via default shortcuts) |
| FR-10 CLI + web still work | ✅ | server imports helpers from util.js; `executablePath` additive; **CLI + web regression pass** |

## §10 Implementation Steps — all Implemented (step 9 = manual verify, done below).

## Special checks (all ✅)
- IPC channel parity exact across design §4 / main.js / preload.js, incl. optional `h2p:discard` (cancel).
- `opts.executablePath` reaches `puppeteer.launch` in **both** `convertHtmlToPptx` and `detectSlides`.
- Transport shim routes `{path}` (Electron) vs `{html}` (web); web fallback + AbortController intact.
- `resolveChromium()` globs nested `chrome-win64` layout (bounded walk, depth 4).
- `asarUnpack` includes `dom-to-pptx` + `fonteditor-core` (S1 fix; `addScriptTag` needs the real bundle file).
- v0.2 elements present: `sandbox:true`, `will-navigate`/`setWindowOpenHandler` guards, single-instance lock, maximize dropped.
- Script tags balanced (the mid-edit missing `</script>` was caught and fixed).

## Runtime verification (during Do)
- ✅ Bundled `resources/chromium/chrome.exe` converts the sample (detect 3 slides → convert 7197 KB, identical to CLI).
- ✅ asarUnpack confirmed in `dist/win-unpacked`: `dom-to-pptx.bundle.js` + `chrome.exe` present.
- ✅ Unpacked packaged app boots (3 processes, no errors); frameless layout matches the handoff (`docs/screenshots/electron-window.png`).
- ✅ CLI (`npm run sample`) and web (`/api/detect` + `/api/convert`) regression pass.

## Gaps

- **Critical / Should-fix**: none.
- **Nice-to-have**:
  1. FR-09 — optionally `win.webContents.openDevTools()` in dev to match the wording verbatim (functionally already available).
  2. Re-run the §9.2 manual checklist on the final exe (drag a deck with relative assets to demonstrate the real-path advantage); README roadmap already ticked.

## Verdict

**99% — ready for `/pdca report electron-portable`.**
