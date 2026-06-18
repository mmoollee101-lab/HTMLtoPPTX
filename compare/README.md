# compare — side-by-side HTML vs PPTX, slide by slide

A small dev tool to check how closely the converted PPTX matches the source HTML, by
rendering both to images and stacking them **per slide**.

```bash
# 1) Render HTML slides to images (same as conversion: noscale + print)
node compare/render-html.js "<deck.html>" compare/html

# 2) Render PPTX slides to images (PPTXjs browser renderer + real font loading)
node compare/render-pptx.js "<deck.pptx>" compare/pptx

# 3) Stack HTML (top) / PPT (bottom) into one comparison image per slide
node compare/combine.js          # -> compare/cmp/cmp_NN.png
```

## Why not export straight from PowerPoint?

PowerPoint COM (`Slides.Export`) / PDF export works, but some enterprise document-security
DRM (e.g. "DOCUMENT SAFER") **encrypts PowerPoint output files** so ordinary processes can't
read them. So the PPT side is rendered with **PPTXjs** (a browser pptx renderer) instead.

## Limitations (important)

PPTXjs reflects our pptx's **box coordinates, sizes, text and fonts**, but is **not
pixel-identical to PowerPoint**. Pseudo-element bullets (`::before`), line spacing, and tiny
positions can look different — so image diffs are a *reference*, not PowerPoint's final
appearance. The most accurate check is opening the file in PowerPoint itself.
