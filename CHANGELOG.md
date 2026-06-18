# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Portable desktop app (Electron).** A single Windows `.exe` with a frameless window,
  native file dialog, and a bundled Chromium — no Node install required. Build with
  `npm run dist`; run from source with `npm run app`.
- IPC layer (`electron/main.js` + `electron/preload.js`) reusing the conversion engine,
  with pre-flight slide detection, **Open** / **Show in folder**, and window controls.
- Self-hosted UI fonts (Hanken Grotesk, JetBrains Mono) so the app runs fully offline.
- App icons and a redesigned UI matching the design handoff.
- Open-source project files: issue/PR templates, CI, Code of Conduct, Security policy.

### Changed
- Redesigned the desktop/web UI (fixed 720px window, five states) and switched the
  interface to English.
- Desktop window uses **Windows‑style controls** (right‑aligned minimize / close) and a
  Content‑Security‑Policy; the window shows a proper taskbar icon.
- `npm run app` now launches the Electron app. The previous Puppeteer `--app` launcher is
  still available as `npm run app:server`.
- Shared helpers (`safeBaseName`, `uniquePath`, `isAllowedPath`, output dir) extracted to
  `src/util.js` and reused by the web server and the Electron main process.

### Fixed
- **Unicode filenames** are preserved on save — e.g. a Korean deck name no longer collapses
  to `___.pptx`; only characters illegal on Windows are stripped.
- **Bullet markers** drawn with `::before` no longer glue to the text (`○측정`); they're
  exported as standalone positioned boxes, keeping the original indent gap.

## [1.0.0]

### Added
- Initial release: convert finished HTML decks into editable native PowerPoint (`.pptx`)
  via Puppeteer + `dom-to-pptx`.
- CLI (single file + batch), local web app, and a standalone window launcher.
- Automatic web-font embedding (incl. bold), line-break locking, source aspect-ratio
  detection, and slideshow-deck (`<deck-stage>`) handling.

[Unreleased]: https://github.com/mmoollee101-lab/HTMLtoPPTX/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/mmoollee101-lab/HTMLtoPPTX/releases/tag/v1.0.0
