# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **woff2 / inlined web fonts now embed** — decks that ship their fonts as
  `url("data:font/woff2;base64,…")` (self-contained exports) previously came out with the
  font *tagged* but **not embedded**, so PowerPoint substituted a wider fallback and bold
  text rendered as a mismatched faux-bold ("broken fonts"). Font resolution now reads the
  live CSSOM (so resolved `data:`/`blob:` sources are seen, not the raw placeholder URLs),
  decodes woff2 to TrueType (PowerPoint can't read woff2), and embeds the real Regular and
  Bold faces. Cross-origin CDN stylesheets are still parsed Node-side, and only families
  actually used by the slides are embedded.

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
