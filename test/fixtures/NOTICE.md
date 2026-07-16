# Test fixture fonts — attribution

`datauri-woff2.html` inlines a **subset** of the **Pretendard** typeface as a
`data:font/woff2` URI, used solely to exercise font embedding in the test suite.

- **Font**: Pretendard by Kil Hyung-jin (길형진 / orioncactus)
- **License**: SIL Open Font License 1.1 (OFL-1.1) — redistribution and subsetting permitted
- **Upstream**: https://github.com/orioncactus/pretendard
- **What's included**: only the glyphs `A B C 가 나 다` (weights 400 and 700), ~1.7 KB each

Regenerate with:

```bash
node scripts/gen-font-fixture.js <pretendard-regular.woff2> <pretendard-bold.woff2>
```

The generator subsets the source fonts to the codepoints listed above, so no full
font binary is committed to this repository.
