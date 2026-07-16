# woff2-datauri-font-embed Completion Report

> **Status**: Complete
>
> **Project**: html-to-pptx
> **Version**: 1.0.0 (fix landed on `main`, targeted for next release)
> **Author**: mmoollee101-lab (with Claude Opus 4.8)
> **Completion Date**: 2026-07-16
> **PDCA Cycle**: retrospective (direct bug-fix — no prior Plan/Design/Analysis docs)

---

## 1. Summary

### 1.1 Overview

| Item | Content |
|------|---------|
| Feature | Embed woff2 & inlined (`data:` URI) web fonts |
| Trigger | User reported "폰트가 대차게 깨졌다" on a re-converted deck (`Simufact Additive 사용사례`) |
| Start / End | 2026-07-16 (single session) |
| Merge | PR [#2](https://github.com/mmoollee101-lab/HTMLtoPPTX/pull/2) → `main` `9b022ff` (squash) |

### 1.2 Results

```
┌─────────────────────────────────────────────┐
│  Acceptance criteria: 6 / 6 met (100%)       │
├─────────────────────────────────────────────┤
│  ✅ Complete:     6 / 6                       │
│  ⏳ Carried over: 0                           │
│  ❌ Cancelled:    0                           │
└─────────────────────────────────────────────┘
```

---

## 2. Problem (Root Cause)

Self-contained decks ship their fonts inside the HTML as a resource map and reference them by a
UUID placeholder that the page's own loader rewrites at runtime into a `data:font/woff2;base64,…`
URI:

```css
@font-face { font-family:"Pretendard"; src: url("79f70677-…") format("woff2") }
```

The converter failed to embed the font for **two** reasons:

1. **Wrong source.** `resolveEmbeddableFonts` parsed only the **raw** `<style>`/`<link>` text,
   where `src` is still the unresolved UUID — so nothing matched.
2. **woff2 skipped.** Even when a URL was found, woff2 was explicitly rejected
   ("the embedder can't decode it").

Net effect: all 21 slides were tagged `typeface="Pretendard"` but `ppt/fonts` was **empty** →
PowerPoint substituted a fallback and bold runs rendered as a mismatched **faux-bold** → "broken
fonts".

---

## 3. Completed Items

### 3.1 Acceptance Criteria

| ID | Requirement | Status | Evidence |
|----|-------------|--------|----------|
| FR-01 | Embed fonts inlined as `data:`/`blob:` woff2 | ✅ | Pretendard Regular 2529 KB embedded |
| FR-02 | Embed a real **Bold** face (not faux-bold) | ✅ | Pretendard Bold 2467 KB (`<p:bold>` in `embeddedFontLst`) |
| FR-03 | Embedded faces cover Korean glyphs | ✅ | 14,716 glyphs; cmap covers `가` U+AC00, `유` U+C720 |
| FR-04 | No regression for CDN (`<link>`) fonts | ✅ | Noto Sans KR sample still embeds full 5.9 MB face (not a subset) |
| FR-05 | Only families actually used are embedded | ✅ | `usedFamilies` scan filters unused CDN faces |
| NFR-01 | No new runtime dependency | ✅ | Uses `fonteditor-core`'s built-in `woff2` module |

### 3.2 Deliverables

| Deliverable | Location | Status |
|-------------|----------|--------|
| Font resolver + woff2→TTF decode + embed pipeline | `src/convert.js` | ✅ |
| CLI help text update | `src/cli.js` | ✅ |
| README / CHANGELOG | `README.md`, `CHANGELOG.md` | ✅ |
| Corrected deck delivered to user | `~/Downloads/Simufact Additive 사용사례 (폰트수정).pptx` | ✅ |

---

## 4. Design of the Fix

Two complementary font sources, because neither alone is enough:

1. **Live CSSOM, `data:`/`blob:` faces only** — captures self-contained decks whose `src` is
   resolved only after their loader runs. woff2 here is **decoded to TrueType** (PowerPoint and
   dom-to-pptx are both woff2-blind) and re-wrapped as a `data:font/ttf` URI.
2. **Node-side parse of CDN `<link>`/`<style>`** (unchanged) — a plain-UA fetch returns the
   **full** font rather than the browser's per-script `unicode-range` **subsets**; CSSOM subset
   faces are skipped for the same reason (a subset embeds as a tiny face missing most glyphs).

Regular is embedded via dom-to-pptx (fed the decoded TTF); the matching Bold weight is added
Node-side (`embedBoldWeights`). woff2 is decoded lazily once via `ensureWoff2()`.

---

## 5. Quality / Verification

Per the project's "verify visually, not from XML" rule — and because this machine has
**PowerPoint (Office 16) but no LibreOffice, and Pretendard is not installed** (so PowerPoint
falls back to the embedded font, reproducing the user's broken condition):

| Check | Method | Result |
|-------|--------|--------|
| Visual — user deck | PowerPoint COM render of slides 1/3/6 (before vs after) | Faux-bold gone; uniform real Pretendard, matches source |
| Font embed present | Inspect `ppt/fonts/*.fntdata` + `embeddedFontLst` | Regular `rId201314` + Bold `rId201315` |
| Glyph coverage | Decode EOT, check cmap | `가`/`유`/`A` all present, 14,716 glyphs |
| CDN regression | Re-convert `samples/sample.html` | Noto Sans KR full 5.9 MB, Korean present (not a 31 KB subset) |

---

## 6. Retrospective

### 6.1 Keep

- Reproduced the exact break locally via PowerPoint COM with Pretendard uninstalled — turned a
  vague "깨졌다" into a concrete, verifiable before/after.
- Prototyped the whole pipeline in the scratchpad before touching `src/`, which surfaced the
  CDN-subset regression **before** it shipped.

### 6.2 Problem

- The first resolver rewrite (read all CSSOM faces) silently **regressed** CDN fonts to a
  broken 31 KB unicode-range subset — caught only because the sample was re-checked, not by any
  test.

### 6.3 Try

- Add a tiny fixture-based check for font embedding (assert `ppt/fonts` non-empty + cmap covers
  a CJK codepoint) for both a `data:`-URI deck and a CDN deck, so the subset trap can't silently
  return.

---

## 7. Next Steps

- [ ] Cut a patch release noting the woff2 / inlined-font fix (CHANGELOG `Unreleased` → versioned).
- [ ] Optional: font-embedding regression fixture (see 6.3).
- [ ] Continue toward the Electron/Tauri distribution direction (unblocked by this fix).

---

## 8. Changelog (excerpt)

**Fixed:**
- woff2 / inlined (`data:` URI) web fonts now embed (Regular + Bold, full glyph coverage);
  previously the font was tagged but not embedded, so PowerPoint substituted a fallback and bold
  text rendered as a mismatched faux-bold.

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-07-16 | Completion report created | mmoollee101-lab / Claude |
