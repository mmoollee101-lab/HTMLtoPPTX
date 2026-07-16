# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **`npm run dist` now builds the NSIS installer**, not a portable. The script still forced
  `--win portable`, which overrode the `nsis` build target added in 1.0.2 — so `npm run dist`
  silently produced the wrong artifact. Updated to `--win nsis`, and the README's desktop-app
  section now describes the installer (`-setup.exe`) instead of the old portable `.exe`.

## [1.0.3] — 2026-07-16

Correct, complete font embedding — and an automated regression guard for it.

### Fixed
- **woff2 / inlined web fonts now embed** — decks that ship their fonts as
  `url("data:font/woff2;base64,…")` (self-contained exports) previously came out with the
  font *tagged* but **not embedded**, so PowerPoint substituted a wider fallback and bold
  text rendered as a mismatched faux-bold ("broken fonts"). Font resolution now reads the
  live CSSOM (so resolved `data:`/`blob:` sources are seen, not the raw placeholder URLs),
  decodes woff2 to TrueType (PowerPoint can't read woff2), and embeds the real Regular and
  Bold faces. Cross-origin CDN stylesheets are still parsed Node-side, and only families
  actually used by the slides are embedded.

### Added
- **Font-embedding regression test** (`npm run test:fonts`, zero new dependencies — `node:test`).
  Converts real decks and asserts the output `.pptx` truly embeds a face: a **data:-URI woff2**
  fixture (offline) and a **CDN** deck (network-gated, skips cleanly when unreachable). Checks
  `ppt/fonts` is non-empty, `embeddedFontLst` has Regular **and** Bold, every embedded EOT's cmap
  covers Korean, and a byte-size floor rejects the unicode-range subset trap. Runs in CI via a
  dedicated `font-embed` job that launches real Chromium.

[1.0.3]: https://github.com/mmoollee101-lab/HTMLtoPPTX/releases/tag/v1.0.3

## [1.0.2] — 2026-06-19

Faster, more trustworthy startup: ship a Windows **installer** instead of the self-extracting portable.

### Changed
- **Distribution is now an NSIS installer** (`HTML-to-PPTX-<ver>-setup.exe`) instead of the
  one-file portable. The portable re-unpacked ~650 MB (Electron + bundled Chromium) to a temp
  folder **on every launch**, so the window took a long time to appear and looked suspicious.
  The installer unpacks **once** at install time (per-user, no admin), then every launch is
  near-instant. Adds Start-menu/Desktop shortcuts and a proper uninstaller.

### Notes
- The installer is still **unsigned**, so Windows SmartScreen may warn once on first run
  (*More info → Run anyway*). Code signing remains on the roadmap.

[1.0.2]: https://github.com/mmoollee101-lab/HTMLtoPPTX/releases/tag/v1.0.2

## [1.0.1] — 2026-06-18

Reliability & diagnostics for the portable desktop app.

### Fixed
- **Conversion errors are now readable.** The Electron layer rejected IPC calls with a
  plain object, which the renderer could only show as `Error invoking remote method
  'h2p:convert': [object Object]` — hiding the real cause. Errors are now carried as a
  tagged result and re-thrown in the renderer with the original message, `code` and slide
  `candidates` intact (`electron/main.js`, `electron/preload.js`).

### Changed
- **More robust first run.** Headless Chromium now launches with a longer startup timeout
  (antivirus often scans the freshly-unpacked ~240 MB Chromium on first run, which could
  exceed Puppeteer's default 30s and surface as a failed conversion). On a genuine launch
  failure the engine throws a clear, actionable message instead of a cryptic timeout
  (`src/convert.js`).

### Added
- **Headless self-test** for support/diagnostics: set `H2P_SELFTEST=<file.html>` to run a
  real detect+convert in the packaged runtime and print the result (or the real error),
  then exit — no window. Inert for normal users (`electron/main.js`).

[1.0.1]: https://github.com/mmoollee101-lab/HTMLtoPPTX/releases/tag/v1.0.1

## [1.0.0] — 2026-06-18

First public release.

### Core
- Convert finished HTML decks into **editable native PowerPoint** (`.pptx`) — real text
  boxes, shapes and vector SVG — via Puppeteer + `dom-to-pptx`.
- Automatic web-font embedding (incl. bold), line-break locking, source aspect-ratio
  detection, and slideshow-deck (`<deck-stage>`) handling.

### Three ways to run
- **CLI** (`src/cli.js`): single file + batch, custom selectors.
- **Local web app** (`npm run web`): drag-and-drop in any browser; output to Downloads.
- **Portable desktop app** (Electron, `npm run dist`): a single Windows `.exe` with a
  frameless window, Windows-style minimize/close controls, native file dialog, bundled
  Chromium and a Content-Security-Policy — no Node install required. Run from source with
  `npm run app`.

### UI & engine
- Redesigned, English UI from the design handoff (fixed 720px window, five states),
  with self-hosted fonts (Hanken Grotesk, JetBrains Mono) so it runs fully offline.
- IPC layer (`electron/main.js` + `electron/preload.js`) reusing the conversion engine,
  with pre-flight slide detection and **Open** / **Show in folder**.
- Shared helpers extracted to `src/util.js`; engine gains an additive `executablePath`
  option for the bundled Chromium.

### Fidelity fixes
- **Unicode filenames** preserved on save — a Korean deck name no longer collapses to
  `___.pptx`; only characters illegal on Windows are stripped.
- **Decorative `::before` bullets** are faithfully reproduced: rendered as their own run
  (neutral color, matched size, vertically centered via font metrics), with the original
  indent gap and hang-indented continuation lines.

### Project
- Open-source files: README, LICENSE (MIT), CONTRIBUTING, Code of Conduct, Security policy,
  issue/PR templates, and CI.

[1.0.0]: https://github.com/mmoollee101-lab/HTMLtoPPTX/releases/tag/v1.0.0
