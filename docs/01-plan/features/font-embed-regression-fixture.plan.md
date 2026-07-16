# font-embed-regression-fixture Planning Document

> **Summary**: A zero-dependency regression check that font embedding works, run against a
> `data:`-URI woff2 deck and a CDN deck, so the two failure modes we already hit can't silently return.
>
> **Project**: html-to-pptx
> **Version**: 1.0.0
> **Author**: mmoollee101-lab (with Claude Opus 4.8)
> **Date**: 2026-07-16
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

Guard the font-embedding pipeline (`src/convert.js`) against silent regressions. The
[woff2-datauri-font-embed](../../04-report/features/woff2-datauri-font-embed.report.md) fix relied
entirely on manual PowerPoint-COM verification; there is no automated check, so either failure mode
below could return unnoticed.

### 1.2 Background

Two concrete regressions occurred during that fix:

- **R1 — not embedded.** woff2 fonts inlined as `data:` URIs were tagged but never embedded
  (`ppt/fonts` empty) → PowerPoint substituted a fallback + faux-bold.
- **R2 — subset trap.** An interim resolver rewrite embedded a CDN font as a tiny 31 KB
  `unicode-range` **subset** (no Korean) instead of the full 5.9 MB face. Caught only by chance
  when the sample was re-checked.

A small deterministic fixture that asserts real embedding (family present, Regular **and** Bold,
CJK glyph coverage, size floor) would have caught both.

### 1.3 Related Documents

- Completion report: [woff2-datauri-font-embed.report.md](../../04-report/features/woff2-datauri-font-embed.report.md) (see §6.3 "Try")
- Verification convention (memory): render output, not XML; for fonts use PowerPoint COM + cmap checks

---

## 2. Scope

### 2.1 In Scope

- [ ] A `data:`-URI woff2 fixture deck (self-contained, **offline**) + assertions.
- [ ] A CDN-font check reusing `samples/sample.html` (Noto Sans KR), **network-gated** — skipped
      with a clear message when the CDN is unreachable/offline.
- [ ] A shared assertion helper: unzip `.pptx`, assert `ppt/fonts/*.fntdata` non-empty, parse
      `<p:embeddedFontLst>` (family + `<p:regular>` + `<p:bold>`), decode each EOT and assert its
      cmap covers an expected codepoint, and assert a byte-size floor (subset guard).
- [ ] An `npm test` (or `npm run check:fonts`) entry so it runs locally and in CI.
- [ ] Wire the check into the existing GitHub Actions workflow.

### 2.2 Out of Scope

- A full unit-test suite for the rest of the converter (only font embedding is covered here).
- Pixel-level visual/rendering assertions (PowerPoint COM stays a manual step; not portable to CI).
- Fully-offline reproduction of the CDN subset trap (would require committing font binaries —
  explicitly declined in favor of network-gating).

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | Offline `data:`-URI woff2 fixture converts and asserts the font is embedded (family, Regular+Bold) | High | Pending |
| FR-02 | Assert each embedded face decodes as EOT and its cmap covers the expected CJK codepoint(s) | High | Pending |
| FR-03 | Assert an embedded-face byte-size floor (catches subset shrinkage, e.g. the 31 KB trap) | High | Pending |
| FR-04 | CDN check (`samples/sample.html`) asserts a full, CJK-covering face; **skips cleanly** when offline | High | Pending |
| FR-05 | Runnable via `npm test`; non-zero exit on failure | High | Pending |
| FR-06 | Wired into CI so PRs run it | Medium | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| Dependencies | No new runtime **or** test-runner dependency | Use Node built-in `node:test` + `node:assert`; reuse `jszip`/`fonteditor-core` already present |
| Runtime | Full check completes in a reasonable time on CI | Reuse a single headless browser; keep fixture tiny |
| Repo size | No multi-MB binaries committed | `data:` fixture uses a small **subsetted** woff2 (only the glyphs it asserts); CDN case adds nothing |
| Determinism | Offline path is fully deterministic | R1/R2-offline assertions never touch the network |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] All functional requirements implemented.
- [ ] `npm test` passes locally (both cases) and fails loudly if embedding breaks.
- [ ] Deliberately reverting the fix (or forcing woff2-skip) makes the test FAIL — proven, not assumed.
- [ ] CI runs the check on PRs.
- [ ] CHANGELOG / docs note the new check.

### 4.2 Quality Criteria

- [ ] Zero lint errors; no new dependency in `package.json`.
- [ ] Offline case runs with the network disabled.
- [ ] Skipped CDN case prints an explicit "skipped: CDN unreachable" line (never a false pass).

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| CDN test flaky/offline in CI | Medium | Medium | Network-gate FR-04: on fetch failure, `test.skip` with a message — never fail, never silently pass |
| A tiny `data:` fixture is itself a "subset", weakening FR-03's size floor | Medium | Medium | Set the size floor per-fixture; for R1 assert only the glyphs the fixture actually contains, and rely on FR-04 (CDN full font) for the true size floor |
| Building the fixture's subsetted woff2 needs tooling | Low | Medium | Generate once with `fonteditor-core` (already a dep) from a full font → subset → woff2; commit only the small result |
| `node:test` behavior differs across Node 18/20/22 | Low | Low | Use the stable subset of the API; CI matrix already pins Node versions |

---

## 6. Architecture Considerations

### 6.1 Project Level

| Level | Selected | Rationale |
|-------|:--------:|-----------|
| Starter (`scripts/`, flat `src/`) | ✅ | This is a Node CLI/desktop tool, not a web app. Add a `test/` dir + a `scripts/` helper; no framework layering. |
| Dynamic / Enterprise | ☐ | N/A |

### 6.2 Key Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| Test runner | node:test / vitest / jest | **node:test (built-in)** | No new dependency; matches the project's minimal-deps, portable ethos |
| Assertions | node:assert / chai | **node:assert** | Built-in |
| CDN regression coverage | network-gate / commit font binaries / drop it | **network-gate** | Keeps repo lean; real coverage when CI has network (user-approved) |
| `data:` fixture font | commit small subset woff2 / generate at test time | **commit small subset** | Deterministic, tiny, no build step at test time |
| Unzip / font decode | reuse `jszip` + `fonteditor-core` | reuse | Already dependencies; same tools the fix uses |

*(Web-app template sections — frameworks, state, styling, env vars, DB — are N/A for this
internal tooling feature.)*

---

## 7. Convention Prerequisites

- Existing conventions: CommonJS, `'use strict'`, no test framework yet (this feature introduces the first).
- New convention to establish: `test/` holds `node:test` files (`*.test.js`); fixtures under `test/fixtures/`; `npm test` runs them.
- No environment variables needed.

---

## 8. Next Steps

1. [ ] Write design document (`font-embed-regression-fixture.design.md`) — fixture format, helper API, file layout, CI wiring.
2. [ ] Implement (`/pdca do`).
3. [ ] Gap analysis (`/pdca analyze`).

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-07-16 | Initial draft | mmoollee101-lab / Claude |
