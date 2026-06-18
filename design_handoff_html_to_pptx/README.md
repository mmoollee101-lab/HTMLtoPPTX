# Handoff: HTML to PPTX — Converter App

## Overview
**HTML to PPTX** is a small, portable desktop utility that converts a finished HTML
presentation/deck into a native, fully-editable PowerPoint (`.pptx`) file — real text
boxes and shapes, not flat screenshots. This handoff covers the **main app window UI**
(all five states) and the **app icon package**.

The intended distribution is a **portable release** (a single small app window, not a
web page). Design the implementation to live inside a desktop shell (Electron, Tauri,
or similar). The window is fixed-size and centered — it does **not** stretch to fill
the viewport.

---

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing
the intended look and behavior, **not production code to copy directly**. The task is to
**recreate these designs in the target codebase's environment** (React, Vue, Svelte,
SwiftUI, native, etc.) using its established patterns and component library. If no
environment exists yet, choose the most appropriate framework for a small desktop
utility (e.g. a Tauri/Electron + React app) and implement the designs there.

The HTML prototypes are authored as "Design Components" (a `.dc.html` template + a small
logic class). Treat them as **visual + behavioral specs**. The conversion engine itself
(HTML → PPTX) is **out of scope** for this UI handoff — the prototype mocks the flow with
a timed progress simulation; wire the real engine behind the same state machine.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, radii, shadows, and
interactions are specified below. Recreate the UI pixel-accurately using the codebase's
existing libraries, then swap the simulated convert flow for the real engine.

---

## Screens / Views

The app is **one window** with a fixed title bar and a two-pane body. The **left pane is
constant** (brand panel). The **right pane swaps between five states**: `empty`,
`file`, `converting`, `complete`, `error`.

### Window shell
- **Outer canvas**: full background `#e7e9ef`, app window centered, 32px padding around.
- **Window**: width `720px`, `border-radius: 14px`, `overflow: hidden`,
  `background: #fff`, shadow `0 24px 60px -18px rgba(15,23,42,.34), 0 0 0 1px rgba(15,23,42,.06)`.
- **Title bar**: height `42px`, `background: #fbfbfd`, bottom border `1px solid #eef1f5`,
  15px horizontal padding. Left: three traffic-light dots (11px circles, `#ff5f57`,
  `#febc2e`, `#28c840`, 7px gap). Center: window title "HTML to PPTX", 12.5px / 600 /
  `#94a3b8`, letter-spacing `-.01em` (optically centered with `margin-left:-39px`).

### Left pane — Brand (constant)
- **Box**: width `262px` (fixed, `flex-shrink:0`), right border `1px solid #eceefb`,
  padding `26px 26px 24px`, vertical flex column.
- **Background**: `linear-gradient(168deg, #f6f7fe, #edf0fc 65%, #e9ecfb)`.
- **Logo row**: 27px rounded-8px square, `linear-gradient(135deg,#6366f1,#8b5cf6)`,
  shadow `0 6px 14px -4px rgba(99,102,241,.5)`, white presentation/landscape glyph
  inside; wordmark "HTML to PPTX" 14.5px / 700 / `#1e293b`, letter-spacing `-.02em`.
- **Headline**: "HTML in.\nEditable slides out." — 21px / 700 / `#0f172a`,
  letter-spacing `-.025em`, line-height 1.2, margin-top 26px.
- **Subcopy**: "No screenshots. Real PowerPoint text, shapes and layout you can keep
  editing." — 12.5px / 400 / `#6b7280`, line-height 1.55, margin-top 11px.
- **Checklist** (3 items, 13px gap, margin-top 26px). Each: 20px rounded-6px white tile
  (`1px solid #e3e6f5`) with an indigo check (`#6366f1`), then label 12px / 500 / `#475569`:
  1. "Native, fully editable text boxes"
  2. "Fonts, colors & layout preserved"
  3. "Runs locally — files never leave your machine"
- **Footer** (pinned bottom via `margin-top:auto`): "OPEN SOURCE · OFFLINE · v1.0" —
  JetBrains Mono 10px, `#a3abc2`, letter-spacing `.05em`.

### Right pane — Work area
- **Box**: `flex:1`, padding `28px 30px`, `min-height: 380px`, vertical flex, content
  vertically centered (`justify-content:center`).

#### State: `empty`
- Eyebrow "CONVERT" (JetBrains Mono 11px / 500 / `#6366f1`, letter-spacing `.06em`).
- Title "Convert a presentation" — 15px / 700 / `#0f172a`, letter-spacing `-.01em`.
- **Dropzone** (clickable → `file`): dashed border `1.5px dashed #cdd4e2`,
  `border-radius:13px`, padding `28px 18px`, centered, `background:#fafbff`.
  Hover: border `#6366f1`, background `#f5f6ff`. Contains a 46px rounded-12px `#eef2ff`
  tile with a 22px upload arrow icon (`#6366f1`), label "Choose an HTML file **or drag it
  here**" (13.5px / 600, the "or drag it here" span in `#6366f1`), and hint
  "self-contained .html recommended" (JetBrains Mono 11px / `#94a3b8`).
- **Slide selector field**: label "Slide selector · auto-detect if empty" (12px / 600 /
  `#334155`, the note in `#94a3b8` / 400). Input: full width, padding `10px 12px`,
  `1px solid #e2e8f0`, `border-radius:10px`, JetBrains Mono 12px, `#334155`. Focus:
  border `#6366f1`, `box-shadow: 0 0 0 3px #eef2ff`. Placeholder: "Auto · .slide,
  [data-label], deck-stage…".
- **Convert button (disabled)**: full width, padding 12px, `border-radius:11px`,
  `background:#eef2ff`, text `#a5b4fc`, 13.5px / 600, `cursor:not-allowed`. Label
  "Convert to PPTX".

#### State: `file` (a file is selected)
- Eyebrow "READY"; same title.
- **File card**: `1px solid #e2e8f0`, `border-radius:13px`, padding `13px 15px`,
  shadow `0 1px 2px rgba(15,23,42,.04)`. 40px rounded-11px `#eef2ff` tile with a 19px
  document icon (`#6366f1`); filename "keynote-q3.html" (13px / 600 / `#1e293b`); meta
  "1.8 MB · **18 slides detected**" (11px / `#94a3b8`, the detected part `#16a34a` / 600).
  Trailing **remove** button (× → back to `empty`): 26px rounded-7px `#f1f5f9` / `#94a3b8`,
  hover `#fee2e2` / `#dc2626`.
- Same slide-selector field as `empty`.
- **Convert button (active)** → `converting`: full width, `background:#6366f1`, white,
  13.5px / 600, shadow `0 10px 22px -8px rgba(99,102,241,.6)`. Hover `#4f46e5`. Label
  "Convert to PPTX →".

#### State: `converting`
- Centered. 52px spinner: SVG circle `r=27`, track `#eef1f5` width 6, arc `#6366f1`
  width 6 round cap `stroke-dasharray:60 200`, rotating `1s linear infinite`.
- Label "Converting slide N of 18" (15px / 700 / `#0f172a`), where N tracks progress.
- Subcopy "Generating editable text boxes…" (11.5px / `#94a3b8`).
- **Progress bar**: 8px tall, track `#eef1f5`, `border-radius:99px`; fill
  `linear-gradient(90deg,#6366f1,#8b5cf6)`, width = progress %, `transition: width .15s ease`.
- Below: progress % on the left (`#6366f1` / 500), "Cancel" on the right (→ `empty`,
  hover `#dc2626`). Both JetBrains Mono 11px / `#94a3b8`.

#### State: `complete`
- Centered. 58px green circle `#f0fdf4` with a 31px check (`#16a34a`).
- "keynote-q3.pptx is ready" — 16.5px / 700 / `#15803d`, letter-spacing `-.015em`.
- Meta "18 slides · 2.4 MB · editable text & shapes" (11.5px / `#94a3b8`).
- Buttons: **Open** (`#6366f1` fill, white, 13px / 600, shadow, hover `#4f46e5`) and
  **Show in folder** (`1px solid #e2e8f0`, white, `#475569`, hover `#f8fafc`).
- Text link "Convert another" (→ `empty`): 12.5px / 600 / `#6366f1`.

#### State: `error`
- Centered. 58px red circle `#fef2f2` with a 31px alert icon (`#dc2626`).
- "No slides detected" — 15.5px / 700 / `#b91c1c`, letter-spacing `-.015em`.
- Subcopy "Set a selector like `.slide` or `section` and try again." (11.5px /
  `#94a3b8`, the code spans JetBrains Mono / `#64748b`).
- Buttons: **Edit settings** (outline, → `file`) and **Try again** (`#6366f1`, →
  `converting`).

---

## Interactions & Behavior
- **empty → file**: click anywhere on the dropzone (real impl: also accept native file
  drop and a file-picker dialog). Validate `.html`; ideally self-contained HTML.
- **file → empty**: click the × remove button.
- **file → converting**: click "Convert to PPTX →".
- **converting**: progress advances; in the prototype it's simulated (+3% every 75ms).
  At 100% it transitions to **complete** after ~320ms. "Cancel" returns to `empty`.
  The slide counter = `round(progress/100 * totalSlides)`, clamped `1..total`.
- **converting → complete**: on success. Show output filename, slide count, file size.
- **converting → error**: on failure (e.g. no slide elements matched the selector).
- **complete → empty**: "Convert another". "Open" / "Show in folder" call OS file APIs.
- **error → file / converting**: "Edit settings" / "Try again".
- **Spinner**: continuous 360° rotation, `1s linear infinite`.
- **Hover transitions**: `all .15s` on dropzone; `background .15s` on primary buttons.
- The window is **fixed-size** (720px wide); it is not responsive/fluid.

## State Management
- Single enum: `view ∈ { empty, file, converting, complete, error }`.
- `progress: number` (0–100), only meaningful during `converting`.
- Real implementation also needs: selected `file` (handle + name + size), parsed
  `slideCount`, chosen `selector` string, output path, and an error reason.
- Always clear the progress interval/worker on unmount and on Cancel/reset.

## Design Tokens

### Colors
| Token | Hex | Use |
|---|---|---|
| Primary | `#6366f1` | buttons, accents, eyebrows, focus ring base |
| Primary hover | `#4f46e5` | primary button hover |
| Primary 2 | `#8b5cf6` | gradient end (logo, progress, icon) |
| Primary tint | `#eef2ff` | icon tiles, disabled button bg |
| Primary tint 2 | `#f5f6ff` | dropzone hover bg |
| Disabled text | `#a5b4fc` | disabled button label |
| Ink | `#0f172a` | primary headings |
| Ink 2 | `#1e293b` | wordmark, strong labels |
| Body | `#475569` / `#5b6478` | checklist / body text |
| Muted | `#64748b` / `#6b7280` | secondary copy |
| Faint | `#94a3b8` | hints, meta |
| Faint 2 | `#a3abc2` | footer mono |
| Hairline | `#e2e8f0` / `#eef1f5` / `#eceefb` / `#f1f5f9` | borders, tracks |
| Surface | `#ffffff` | window, cards |
| Surface 2 | `#fbfbfd` / `#fafbff` | title bar, dropzone |
| App bg | `#e7e9ef` | desktop backdrop |
| Success | `#16a34a` / `#15803d` | detected count, complete |
| Success bg | `#f0fdf4` | complete circle |
| Error | `#dc2626` / `#b91c1c` | error text, destructive hover |
| Error bg | `#fef2f2` / `#fee2e2` | error circle, remove hover |
| Brand panel | `linear-gradient(168deg,#f6f7fe,#edf0fc 65%,#e9ecfb)` | left pane |
| Brand mark | `linear-gradient(135deg,#6366f1,#8b5cf6)` | logo, progress fill, icon |

### Typography
- **UI font**: `'Hanken Grotesk', system-ui, sans-serif` (weights 400/500/600/700).
- **Mono font**: `'JetBrains Mono', monospace` (eyebrows, hints, code, footer, meta).
- Scale used: 21 (headline) / 16.5 / 15.5 / 15 / 14.5 / 13.5 / 13 / 12.5 / 12 / 11.5 / 11 / 10.
- Headings use negative letter-spacing (`-.01em` to `-.025em`).

### Spacing & radii
- Window radius 14px; cards 13px; tiles 11–12px; inputs/buttons 10–11px; checklist
  tiles 6px.
- Window padding 32px (outer); panes 26–30px; dropzone 28px; cards 13–14px.
- `-webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;`

### Shadows
- Window: `0 24px 60px -18px rgba(15,23,42,.34), 0 0 0 1px rgba(15,23,42,.06)`
- Card: `0 1px 2px rgba(15,23,42,.04)`
- Primary button: `0 10px 22px -8px rgba(99,102,241,.6)`
- Logo: `0 6px 14px -4px rgba(99,102,241,.5)`
- Focus ring: `0 0 0 3px #eef2ff`

---

## Assets

### App icon
Gradient squircle (`#6d6bf2 → #8b5cf6`, diagonal) with a top sheen, holding a layered
slide-deck mark: a back card (white @ 50%) for depth and a front white slide showing a
gradient title block plus three light content lines (`#c8cdf5`). The squircle corner
radius is ~22.37% of the icon size.

Provided in `icons/` as square PNGs:

| File | Size |
|---|---|
| `icon-1024.png` | 1024×1024 |
| `icon-512.png` | 512×512 |
| `icon-256.png` | 256×256 |
| `icon-128.png` | 128×128 |
| `icon-64.png` | 64×64 |
| `icon-48.png` | 48×48 |
| `icon-32.png` | 32×32 |
| `icon-16.png` | 16×16 |

**Bundling for release:**
- **Windows** (`app.ico`): combine 16, 32, 48, 256.
- **macOS** (`app.icns`): combine 16→1024 (incl. @2x variants — generate from 1024 base).
- **Linux**: ship the PNGs directly (hicolor theme: 16/32/48/64/128/256).

The PNG corners are already pre-rounded; if your shell applies its own mask, use a
full-bleed square version instead (regenerate without the squircle clip).

### Icons (in-app, inline SVG)
Upload arrow, document, check, alert-circle, presentation/landscape (logo). All
single-color line icons — map to your icon library (e.g. Lucide: `upload`, `file`,
`check`, `alert-circle`, `image`) using the colors above.

---

## Files
HTML design references included in this bundle:
- `HTML to PPTX App.dc.html` — the main app window, all five states + simulated flow.
- `Icon Package.dc.html` — icon showcase (contexts, size ladder, dock mockup, file list).
- `icons/` — the eight PNG icon sizes.

> Note: `.dc.html` files are self-contained HTML and open directly in a browser. Open
> them to inspect exact markup, inline styles, and the small state-machine logic class.
