# font-embed-regression-fixture — Gap Analysis (Check)

> **Project**: html-to-pptx · **Date**: 2026-07-16 · **Phase**: Check
> **Plan**: [../01-plan/features/font-embed-regression-fixture.plan.md](../01-plan/features/font-embed-regression-fixture.plan.md)
> **Design**: [../02-design/features/font-embed-regression-fixture.design.md](../02-design/features/font-embed-regression-fixture.design.md)
> **Analyzer**: bkit gap-detector (read-only) + local test run

---

## Overall

| Category | Score |
|----------|:-----:|
| Design match (FR-01..FR-06) | 100% |
| DoD / traceability (design §7) | 100% |
| Architecture (Starter: `test/` + `scripts/`) | 100% |
| Convention (CommonJS, `'use strict'`, `*.test.js`, no new deps) | 100% |
| **Overall** | **~98%** (≥ 90% → Check complete) |

Single deduction was one cosmetic JSDoc `@returns` drift (design said `{faces, family}`, code returns `{faces}`) — **resolved** by aligning the design doc to the code ("code is truth").

## Requirements Traceability

| FR | Requirement | Status | Evidence |
|----|-------------|:---:|----------|
| FR-01 | Offline `data:`-URI woff2 fixture; family + Regular + Bold | ✅ | `test/font-embed.test.js` R1; `assert-embed.js` embeddedFont block; `fixtures/datauri-woff2.html` two `@font-face` |
| FR-02 | Each face decodes as EOT; cmap covers CJK | ✅ | `assert-embed.js` `Font.create({type:'eot'})` + `cmap[cp]` check; R1 `[0x41,0xAC00]`, R2 `[0xAC00]` |
| FR-03 | Byte-size floor (subset guard) | ✅ | `assert-embed.js` `buf.length >= minBytes`; R2 `500_000` |
| FR-04 | CDN check, network-gated skip | ✅ | R2 HEAD probe → `t.skip(...)`; asserts full Noto Sans KR |
| FR-05 | `npm test`; non-zero exit | ✅ | `package.json` scripts; `node --test` exit code |
| FR-06 | CI wiring | ✅ | `.github/workflows/ci.yml` `font-embed` job (Chromium, `npm run test:fonts`) |

## Empirical Verification

- `npm test` → **2 pass, 0 fail, 0 skipped** (R2 CDN reachable at run time).
- Regression-catch **proven**: neutralizing the `data:`-URI embed in `src/convert.js` makes R1 fail with
  `no embedded fonts (ppt/fonts empty) — expected "PretendardSubset"` (the assertion at
  `assert-embed.js` line ~27), then reverted cleanly.

## Gaps

| Severity | Item | Resolution |
|:---:|------|-----------|
| 🔵 Low | design §3 `@returns` listed `family`; code returns `{faces}` only | ✅ Fixed — design updated to `{faces:number}` |
| 🟡 Info | R1 `minBytes:1000` concrete value; test imports `puppeteer`/`path` directly | Accepted — consistent with plan §5 and design §4 shared-browser intent; no conflict |
| 🔴 Missing | — | None |

## Verdict

Match ~98% (≥ 90%). No `/pdca iterate` required → proceed to Report.
