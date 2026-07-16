# font-embed-regression-fixture Design Document

> **Summary**: File layout, fixture-generation strategy, assertion-helper API, `node:test` structure, and CI wiring for the font-embedding regression check.
>
> **Project**: html-to-pptx
> **Version**: 1.0.0
> **Author**: mmoollee101-lab (with Claude Opus 4.8)
> **Date**: 2026-07-16
> **Status**: Draft
> **Planning Doc**: [font-embed-regression-fixture.plan.md](../../01-plan/features/font-embed-regression-fixture.plan.md)

---

## 1. Overview

### 1.1 Design Goals

- Deterministically fail if a converted deck's fonts are not really embedded (family missing,
  Regular/Bold missing, no CJK coverage, or a suspiciously tiny subset face).
- Zero new dependencies; reuse `puppeteer`, `jszip`, `fonteditor-core`, `pako` already present.
- Cover both failure modes: **R1** (offline `data:`-URI woff2) always; **R2** (CDN subset trap)
  network-gated.

### 1.2 Principles

- Test the **public API** (`convertHtmlToPptx`) end-to-end, not internals — that's where the
  regressions lived.
- Assert on the **output `.pptx` bytes** (embedded EOT + `embeddedFontLst`), the user-facing artifact.
- Skips must be **loud and explicit** — never a silent pass.

---

## 2. Architecture

### 2.1 File Layout

```
test/
  fixtures/
    datauri-woff2.html        # self-contained: 1 slide, Korean text, tiny Pretendard-subset woff2 as a data: URI
    NOTICE.md                 # font attribution (Pretendard, OFL-1.1) + how the subset was made
  helpers/
    assert-embed.js           # shared assertions over a .pptx Buffer
  font-embed.test.js          # node:test suite (R1 offline + R2 network-gated)
scripts/
  gen-font-fixture.js         # dev-only: regenerate datauri-woff2.html from a full font (documented, not run by tests)
```

### 2.2 Data Flow (per test case)

```
fixture .html ──▶ convertHtmlToPptx(html, {browser}) ──▶ .pptx Buffer ──▶ assertEmbed(buf, {family, mustCover, minBytes})
                                                                             │
                                    unzip → ppt/fonts/*.fntdata + presentation.xml
                                    ├─ assert ≥1 fntdata
                                    ├─ parse <p:embeddedFontLst>: family present, <p:regular> + <p:bold>
                                    ├─ decode each EOT (fonteditor) → assert cmap covers `mustCover` codepoints
                                    └─ assert each fntdata byteLength ≥ minBytes  (subset guard)
```

### 2.3 Dependencies

| Component | Depends On | Purpose |
|-----------|-----------|---------|
| `font-embed.test.js` | `node:test`, `node:assert`, `src/convert.js` | drive conversion, orchestrate cases |
| `assert-embed.js` | `jszip`, `fonteditor-core` | unzip + decode + assert |
| shared browser | `puppeteer` | one `browser` reused across cases (via `convertHtmlToPptx({browser})`) |

---

## 3. Assertion Helper API

```js
// test/helpers/assert-embed.js
/**
 * @param {Buffer} pptx
 * @param {object} exp
 * @param {string}   exp.family     expected typeface in <p:embeddedFontLst>
 * @param {number[]} exp.mustCover  codepoints every embedded face's cmap must contain
 * @param {number}   [exp.minBytes] per-face fntdata size floor (subset guard)
 * @param {boolean}  [exp.bold=true] require a <p:bold> face too
 * @returns {Promise<{faces:number}>}  (throws AssertionError on any miss)
 */
async function assertEmbed(pptx, exp) { /* … */ }
module.exports = { assertEmbed };
```

- EOT decode uses `fonteditor.Font.create(buf, {type:'eot'})`; cmap check is `font.data.cmap[cp] !== undefined`.
- If any embedded face is woff2 (shouldn't happen post-fix), `ensureWoff2()`-style init is NOT needed
  because embedded faces are always EOT.

---

## 4. Test Cases (`font-embed.test.js`)

| Case | Fixture | Network | Assertions |
|------|---------|:------:|------------|
| R1 — `data:`-URI woff2 | `test/fixtures/datauri-woff2.html` | none | family `PretendardSubset`, cover `[0xAC00 '가', 0x41 'A']`, Regular+Bold, `minBytes` small (subset is intentionally tiny) |
| R2 — CDN font | `samples/sample.html` | **gated** | family `Noto Sans KR`, cover `[0xAC00]`, Regular+Bold, `minBytes ≥ 500_000` (the real subset-trap guard: 31 KB would fail) |

- One `before()` launches a shared `puppeteer` browser; `after()` closes it. Each case calls
  `convertHtmlToPptx(fixture, {browser, log(){} })`.
- **R2 gating**: wrap the CDN case; on any conversion/fetch error OR when a quick reachability probe
  to the font CDN fails, call `t.skip('CDN unreachable — skipping subset-trap check')`. A genuine
  embed failure (browser up, CDN up, but wrong bytes) still FAILS.

### 4.1 Fixture generation (`scripts/gen-font-fixture.js`, dev-only)

1. Read a full Pretendard TTF/woff2 (from a path arg).
2. `fonteditor.Font.create(buf, {type, subset:[0x41,0x42,0x43,0xAC00,0xB098,0xB2E4], inflate/woff2 init as needed})`.
3. Write woff2 (`font.write({type:'woff2'})`), base64-inline into an HTML template with one `.slide`,
   a `@font-face { font-family:"PretendardSubset"; src:url("data:font/woff2;base64,…") }`, a 700-weight
   `@font-face` for bold, and Korean+Latin text using both weights.
4. Emit `test/fixtures/datauri-woff2.html`. Commit the result; the script is not run at test time.

*(Committing a ~5–10 KB OFL-licensed subset is fine; attribution in `test/fixtures/NOTICE.md`.)*

---

## 5. npm & CI Wiring

### 5.1 package.json

```jsonc
"scripts": {
  // Explicit file (not a dir/glob): Node 20 — the CI font-embed job — doesn't
  // expand --test globs, and a bare `test/` dir arg is mis-read as a module.
  "test": "node --test test/font-embed.test.js",
  "test:fonts": "node --test test/font-embed.test.js"
}
```

### 5.2 CI (`.github/workflows/ci.yml`)

The existing `check` job sets `PUPPETEER_SKIP_DOWNLOAD=1` (no browser) — the font test can't run there.
Add a **separate job** that installs Chromium and runs the test:

```yaml
font-embed:
  name: Font embedding (e2e)
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: '20', cache: npm }
    - run: npm ci                      # downloads Puppeteer Chromium (no SKIP here)
    - run: npm run test:fonts
```

- Runners have network → the R2 CDN case actually runs there.
- Keeps the fast `check` matrix untouched.

---

## 6. Risks / Edge Cases

| Risk | Handling |
|------|----------|
| `subset` option unsupported for the source container | Decode to TTF first (`fontBufferToTtf`-style), subset the TTF, then write woff2 |
| Bold face identical to regular in subset (no 700 source) | Generator takes both a 400 and 700 source; fixture asserts Bold present, not that it differs |
| CDN case silently passing when offline | Explicit `t.skip` with message; never a bare `return` |
| Test slow (browser launch) | Single shared browser for both cases |

---

## 7. Definition of Done (traceability)

| Plan FR | Design element |
|---------|----------------|
| FR-01 | R1 case + `datauri-woff2.html` fixture |
| FR-02 | `assertEmbed` cmap coverage check |
| FR-03 | `assertEmbed` `minBytes` floor (R2 = 500 KB) |
| FR-04 | R2 case, network-gated `t.skip` |
| FR-05 | `npm test` / `test:fonts`, non-zero exit via `node:test` |
| FR-06 | dedicated `font-embed` CI job |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-07-16 | Initial draft | mmoollee101-lab / Claude |
