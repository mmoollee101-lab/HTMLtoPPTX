# Contributing

Thanks for your interest in **HTML to PPTX**! Issues and pull requests are welcome.

## Getting set up

```bash
git clone https://github.com/mmoollee101-lab/HTMLtoPPTX.git
cd HTMLtoPPTX
npm install          # downloads a bundled Chromium via Puppeteer
npm run sample       # sanity check: samples/sample.html → samples/sample.pptx
```

- **Node.js ≥ 18** is required (the code uses the built‑in `fetch`).
- No build step — it's plain CommonJS and a single static HTML page.

## Project layout

| Path | What it is |
|---|---|
| `src/convert.js` | the conversion engine (Puppeteer + `dom-to-pptx`) — shared by all entry points |
| `src/cli.js` | command‑line interface |
| `src/server.js` | local HTTP server (web mode): `/api/detect`, `/api/convert`, `/api/open`, `/api/reveal` |
| `src/util.js` | shared helpers: output dir, filename sanitize/dedup, path guard |
| `src/app.js` | legacy Puppeteer `--app` launcher (`npm run app:server`) |
| `electron/` | desktop app: `main.js` (frameless window + IPC) and `preload.js` (`window.api` bridge) |
| `public/` | the UI — one HTML file that talks IPC in Electron and `fetch` on the web |
| `scripts/` | build helpers (`resolve-chromium.js` stages the bundled browser for packaging) |
| `design_handoff_html_to_pptx/` | the high‑fidelity design spec the UI is built from |
| `docs/` | design and PDCA notes |

## How to verify a change

There's no automated test suite yet; verify manually:

1. **Engine / CLI:** `npm run sample`, then open the `.pptx` in PowerPoint and confirm
   text is editable, fonts/colors are preserved, and nothing is clipped.
2. **Web app:** `npm run web`, drag in `samples/sample.html`, convert, and check the
   detect count, progress, and Open / Show in folder actions.
3. **Desktop app:** `npm run app` and confirm the window opens and converts.

When changing the UI, keep it faithful to `design_handoff_html_to_pptx/` (tokens, spacing,
states). A quick way to eyeball every state is to toggle the `.state.active` class in the
browser devtools.

## Pull requests

- Keep changes focused and match the surrounding code style.
- Describe what you changed and how you verified it.
- For UI changes, attach before/after screenshots.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
