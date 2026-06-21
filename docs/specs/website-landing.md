# Website Landing Page — Design Spec

**Issue:** #425  
**Branch:** `feat/website-landing`  
**Source of truth:** this spec, derived from Brandbook v1 (2026-05-27) — a design artefact not committed to the repo; this file supersedes it.  
**Status:** v1.1 — implementation-ready

---

## 1. Color Tokens

All CSS variables live in `:root` (light theme). Dark overrides go in `[data-theme="dark"]`. Variable naming follows the conventions in `.claude/rules/design-tokens.md` — `--bg-*`, `--surface-*`, `--border-*`, `--text-*`, `--accent-*`.

### 1.1 Brand palette

| Token | Light value | Dark value | Role |
|---|---|---|---|
| `--raspberry` | `#BC4670` | `#BC4670` | Raw hex reference only — never applied directly to text |
| `--raspberry-dark` | `#D06185` | `#D06185` | Dark-mode brand variant — lifted for contrast on near-black |
| `--mulberry` | `#A23A5B` | — | Hover/pressed state; accent text on light (passes WCAG AA) |
| `--gold` | `#C08A2D` | — | Muted secondary — editorial flourishes only, used sparingly |

### 1.2 Semantic accent tokens (applied in components)

| Token | Light value | Dark value | Role |
|---|---|---|---|
| `--accent` | `var(--raspberry)` → `#BC4670` | `var(--raspberry-dark)` → `#D06185` | Fills: buttons, active states, the Raspberry period |
| `--accent-text` | `var(--mulberry)` → `#A23A5B` | `var(--raspberry-dark)` → `#D06185` | Raspberry-colored text and links (AA-safe on both canvases) |
| `--accent-bg` | `rgba(188, 70, 112, 0.08)` | `rgba(208, 97, 133, 0.12)` | Tinted highlight surfaces (pill backgrounds, focus rings) |
| `--glow` | `rgba(188, 70, 112, 0.16)` | `rgba(208, 97, 133, 0.22)` | Radial glow behind hero wordmark — stronger in dark |

### 1.3 Background and surface tokens

| Token | Light value | Dark value | Role |
|---|---|---|---|
| `--bg-app` | `#FAFAFA` | `#161618` | Page canvas — near-white, felt not seen; near-black in dark |
| `--surface-1` | `#FFFFFF` | `#1E1E21` | Cards and panels lift above the canvas |
| `--surface-2` | `#F4F4F5` | `#232327` | Section rhythm / alternating stripe |

### 1.4 Text tokens

| Token | Light value | Dark value | Role |
|---|---|---|---|
| `--text-primary` | `#1C1C1E` | `#ECECEE` | Body and headings — near-black / near-white |
| `--text-secondary` | `#6B6B70` | `#9A9AA2` | Hints, captions, eyebrow labels |

### 1.5 Border tokens

| Token | Light value | Dark value | Role |
|---|---|---|---|
| `--border` | `#E8E8EA` | `#2C2C31` | Default dividers and card borders |
| `--border-strong` | `#D8D8DC` | `#3A3A41` | Emphasis borders, "Don't" column left edge |
| `--border-focus` | `var(--accent)` | `var(--accent)` | Focus ring border — always Raspberry |

### 1.6 Full `:root` block (website globals.css)

```css
:root {
  /* Brand raws — reference only, do not apply to text */
  --raspberry: #BC4670;
  --raspberry-dark: #D06185;
  --mulberry: #A23A5B;
  --gold: #C08A2D;

  /* Semantic accent */
  --accent: var(--raspberry);
  --accent-text: var(--mulberry);
  --accent-bg: rgba(188, 70, 112, 0.08);
  --glow: rgba(188, 70, 112, 0.16);

  /* Surfaces */
  --bg-app: #FAFAFA;
  --surface-1: #FFFFFF;
  --surface-2: #F4F4F5;

  /* Text */
  --text-primary: #1C1C1E;
  --text-secondary: #6B6B70;

  /* Borders */
  --border: #E8E8EA;
  --border-strong: #D8D8DC;
  --border-focus: var(--accent);

  /* Typography stacks */
  --font-head: 'Geist', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-body: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace;

  /* Layout */
  --maxw: 1080px;
  --gutter: clamp(20px, 5vw, 80px);
  --track-head: -0.025em;
}

[data-theme="dark"] {
  --accent: var(--raspberry-dark);
  --accent-text: var(--raspberry-dark);
  --accent-bg: rgba(208, 97, 133, 0.12);
  --glow: rgba(208, 97, 133, 0.22);

  --bg-app: #161618;
  --surface-1: #1E1E21;
  --surface-2: #232327;

  --text-primary: #ECECEE;
  --text-secondary: #9A9AA2;

  --border: #2C2C31;
  --border-strong: #3A3A41;
}
```

---

## 2. Typography Scale

Three families, all SIL OFL — self-hostable, zero licensing risk.

| Role | Family | Weight | Size | Tracking | Line-height |
|---|---|---|---|---|---|
| Display / wordmark | Geist | 600 | `clamp(72px, 18vw, 220px)` | `−0.04em` | `0.9` |
| H1 | Geist | 600 | `clamp(52px, 8vw, 72px)` | `−0.025em` | `1.05` |
| H2 / section title | Geist | 600 | `clamp(30px, 5vw, 52px)` | `−0.025em` | `1.05` |
| H3 | Geist | 600 | `19–20px` | `−0.025em` | `1.2` |
| Tagline | Geist | 500 | `clamp(24px, 4.4vw, 46px)` | `−0.025em` | `1.1` |
| Lead / large body | Inter | 400 | `clamp(17px, 2vw, 21px)` | `0` | `1.55` |
| Body | Inter | 400 | `15–16px` | `0` | `1.6` |
| Small body / card desc | Inter | 400 | `15px` | `0` | `1.5` |
| Eyebrow / kicker | Geist Mono | 400–500 | `11–12px` | `0.08–0.14em` | `1` |
| Mono technical | Geist Mono | 400 | `13px` | `0.04em` | `1.6` |
| Nav links | Geist Mono | 400 | `11px` | `0.08em` | `1` (uppercase) |

**Combinations in code:**

- `font-family: var(--font-head)` → always pair with `letter-spacing: var(--track-head)` and a weight of 600.
- `font-family: var(--font-mono)` for eyebrows, kickers, nav, technical labels — always `text-transform: uppercase` at small sizes.
- `font-family: var(--font-body)` for all paragraph text.

---

## 3. Landing Page Copy — Verbatim from Brandbook

### 3.1 Top bar

- **Wordmark:** `Marvinz.` — "Marvinz" in `--font-head`, the period in `--accent`.
- **Nav links (mono, uppercase, 11px):** `Positioning` · `Logo` · `Color` · `Type` · `Voice` · `Messaging` (not all may carry over to the landing page — retain at minimum one anchor set relevant to a marketing page).
- **Theme toggle label:** `◐ Theme`

### 3.2 Hero section

**Hero meta strip (mono, uppercase, 12px, `--text-secondary`):**
```
Brandbook v1   Codename obsclone   Category Visual workspace for Claude Code   Status draft
```
(The landing page meta strip should replace "Brandbook v1 / Status draft" with something user-facing — e.g., a version badge or platform badge. The brandbook text is the template; adapt for marketing context.)

**Wordmark (display):**
```
Marvinz.
```
Period is `--accent` (Raspberry fill).

**Tagline (H1 level, Geist 500):**
```
Where AI output becomes knowledge you can navigate.
```

**Sub-description (mono, 13–16px, `--text-secondary`):**
```
The visual workspace for Claude Code.
```
The word "Claude Code" renders in `--accent-text` (Mulberry on light, Raspberry-dark on dark).

**Primary CTA button:**
```
Download
```
Raspberry fill (`--accent`), white label, `--radius-md`, links to GitHub Releases (`https://github.com/marcelusfernandes/marvinz/releases`).

### 3.3 How it works — 3-step section

**Eyebrow:** `01 · How it works` (mono, uppercase, `--accent-text`)

**Section title (H2):**
```
One product, not two.
```

**Lead paragraph:**
```
Marvinz makes the DIY stack of "Claude Code CLI + Obsidian" one product. The agent edits your local markdown directly inside a workspace where you read, navigate and curate — every change snapshotted, every tool call approvable.
```

**Three steps (numbered cards):**

Step 1 — kicker: `01`
```
Point Marvinz at your vault.
```
Body: `Your files stay where they are. Marvinz reads the vault — nothing is uploaded, nothing is moved.`

Step 2 — kicker: `02`
```
The agent works — output lands as navigable markdown.
```
Body: `Claude Code edits your local files. Every change lands as a linked, readable note in your vault, snapshotted so you can roll back any turn.`

Step 3 — kicker: `03`
```
Read, navigate, validate — and restore any earlier version.
```
Body: `Review the agent's work side-by-side with your own notes. Approve tool calls before they run. Restore any snapshot from one click.`

### 3.4 Features grid section

**Eyebrow:** `02 · Features` (mono, uppercase, `--accent-text`)

**Section title (H2):**
```
The workspace native to the Claude Code + vault workflow.
```

**Lead:**
```
Built for engineers and PMs who already run Claude Code alongside a markdown vault and want to read, navigate and validate what the AI generates — to trust it and build on it, instead of losing it in a terminal scroll.
```

**Feature cards (kicker + h3 + body — 6 cards, 3-col grid):**

Card 1 — kicker: `Vault`
```
Markdown vault as the agent's canvas
```
Body: `Point Marvinz at any local folder. The agent reads and writes markdown directly — no sync, no upload, your files stay on your machine.`

Card 2 — kicker: `Agent`
```
Claude Code sidebar
```
Body: `Chat with the agent, approve tool calls before they run, and watch edits land in the editor in real time.`

Card 3 — kicker: `Snapshots`
```
Every edit is snapshotted
```
Body: `Marvinz saves a snapshot on every agent turn. Restore any earlier version from the history panel in one click.`

Card 4 — kicker: `Preview`
```
Live markdown preview
```
Body: `Side-by-side editor and rendered preview. Tables, wikilinks, code blocks — all rendered as you write or as the agent writes.`

Card 5 — kicker: `Tabs`
```
Multi-tab workspace
```
Body: `Open multiple files at once, switch between agent output and your own notes, build the context you need.`

Card 6 — kicker: `Control`
```
Approvable tool calls
```
Body: `Every filesystem action the agent wants to take surfaces for your approval. You decide what runs — nothing happens without your review.`

### 3.5 Screenshot spread section

**Eyebrow:** `03 · See it` (mono, uppercase, `--accent-text`)

**Section title (H2):**
```
Your vault. Your files. Your terms.
```

**Lead:**
```
The agent's output lands as navigable, linked markdown you can read side-by-side with your own notes, validate whenever you need, and restore to any earlier version.
```

Layout: app screenshot(s) framed as editorial spreads with generous margins on `--surface-2` background. No stock people. No neon glows. If no final screenshot is available at build time, use a placeholder with correct aspect ratio and caption.

### 3.6 Footer

**Wordmark:** `Marvinz.` — same treatment as topbar.

**Footer copy (mono, 12px, `--text-secondary`):**
```
The visual workspace for Claude Code.
```

**Links row:**
- `GitHub` → `https://github.com/marcelusfernandes/marvinz`
- `Releases` → `https://github.com/marcelusfernandes/marvinz/releases`

**Credits line (mono, 12px, `--text-secondary`):**
```
Geist · Geist Mono · Inter (SIL OFL) · Codicons © Microsoft (CC-BY-4.0)
```

---

## 4. Banned Words

These words must not appear in any landing page copy, button labels, or meta descriptions. They fail the brandbook voice standard (calm, evidence-based, no hype).

| Banned | Reason |
|---|---|
| seamless | Cliché; implies absence of effort that we can't promise |
| revolutionary | Brand-as-hero hype |
| empower | Corporate filler |
| leverage | Jargon |
| supercharge | Hype; velocity word |
| 10x | Unsubstantiated performance claim |
| magic | Undermines trust / transparency |
| effortless | Patronizing; implies the user's problem was trivial |
| simply / just | Same as above |
| easy | Same as above |
| AI-powered | Category cliché; every tool in the market says this |
| next-generation | Meaningless superlative |

Auditing rule: run a grep for each word before merging copy changes.

---

## 5. Color Discipline Rules

These rules are in addition to the general token rules in `.claude/rules/design-tokens.md`.

### 5.1 Raspberry (`--accent`, `#BC4670` / `#D06185` dark)

Apply only on:
- Button fills (primary CTA background)
- Active / selected state backgrounds
- The wordmark period (`Marvinz.`)
- Radial glow decorations (`--glow` token)
- Horizontal rules or border accents used as section dividers
- Link underlines and hover underlines

Never apply:
- As body text color on `--bg-app` or `--surface-1` — fails WCAG AA (contrast ratio ~3.5:1 against `#FAFAFA`)
- As a background for large surfaces
- As a gradient combined with orange or warm yellow

### 5.2 Mulberry (`--accent-text`, `#A23A5B` light only)

Apply on:
- All Raspberry-colored text and inline links on the light theme
- Eyebrow / kicker labels where accent color is intended
- Hover state for nav links

Mulberry passes WCAG AA on `#FAFAFA` (contrast ~5.1:1). On dark, `--accent-text` resolves to `--raspberry-dark` (`#D06185`), which passes AA on `#161618` (~4.8:1).

### 5.3 What to avoid

| Forbidden use | Why |
|---|---|
| Purple or violet in any structural element | Collides with Obsidian brand; reinforces the "AI tool" cliché |
| Claude-orange (`#c4691f` or similar) | Claude-skin risk — confuses Marvinz with the Anthropic brand |
| Warm cream canvas (e.g., `#F5F1E8`) | Read as "aged" in user testing — replaced by `#FAFAFA` |
| Raw Raspberry as text on light backgrounds | Fails WCAG AA |
| Cold neon accents | Inconsistent with the editorial, warm-neutral identity |
| Gradients that mix Raspberry with blue-violet | Brand collision with Cursor/Linear |
| Sepia or aged textures | Against editorial restraint directive |

### 5.4 File-type icons exception

The one place color beyond Raspberry is explicitly allowed is the file tree, where `material-icon-theme` colored icons carry semantic file-type meaning. This rule applies only within the product UI; the landing page does not render a file tree and this exception does not apply there.

---

## 6. Layout and Spacing Guidelines

### 6.1 Container

Max-width `1080px`, centered, horizontal gutter `clamp(20px, 5vw, 80px)`. The gutter collapses gracefully on mobile — never go below 20px.

### 6.2 Section vertical rhythm

Each section: `padding-block: clamp(64px, 9vw, 132px)`. Separated by a `1px` border in `--border`. This rhythm creates the editorial whitespace the brandbook describes as "felt, not seen."

### 6.3 Breakpoints

- Below `760px`: two-column and three-column grids collapse to single column. Nav hides.
- Below `640px`: bstable (key-value table) stack to single column.
- Below `860px`: 4-column swatch row collapses to 2-column.

### 6.4 Card hover lift

Cards get `transform: translateY(-2px)` on hover with `border-color: var(--border-strong)` and `box-shadow: 0 12px 36px rgba(0,0,0,0.06)`. Transition: `0.25s ease`. Matches brandbook spec exactly.

---

## 7. Motion Spec

| Interaction | Duration | Easing | Property |
|---|---|---|---|
| Nav link color hover | `120ms` | `ease` | `color` |
| Card hover lift | `250ms` | `ease` | `transform`, `border-color`, `box-shadow` |
| Theme toggle | `400ms` | `ease` | `background`, `color` |
| Section reveal on load | `700ms` | `cubic-bezier(0.22, 1, 0.36, 1)` | `opacity`, `transform` (Y +16px → 0) |
| Button hover | `200ms` | `ease` | `background`, `color`, `border-color` |

`prefers-reduced-motion: reduce` must disable `transform` animations and reduce duration of `opacity` transitions to `0ms` (instant swap). The theme background transition may remain but should reduce to `200ms`.

---

## 8. Imagery Rules

- Product screenshots: framed as editorial spreads with generous whitespace, `--surface-2` background, border `--border`, `border-radius: var(--radius-lg)`.
- Diagrams preferred over photos.
- When illustrating: clean line-art with `--accent` (Raspberry) as the single warm accent against the neutral canvas.
- No stock photography of people at laptops.
- No neon glows beyond the Raspberry radial glow (`--glow` token).
- No sepia / aged textures.
- No gradients that aren't warm-Raspberry.
- Icon sets: VS Code Codicons (UI actions), `material-icon-theme` (file types in product only). No hand-rolled inline SVGs.
- The loop glyph from the brandbook is direction-only — not final logo. Do not ship it as the definitive brand mark.

---

## 9. Accessibility Requirements

- All text/background color pairs must meet WCAG 2.1 AA (4.5:1 for normal text, 3:1 for large text and UI components).
- Focus states: `box-shadow: var(--focus-ring)` on `:focus-visible` — never suppress outlines without a replacement.
- Semantic HTML: `<header>`, `<main>`, `<section>`, `<footer>` with appropriate `<h1>–<h3>` hierarchy.
- Every `<img>` has meaningful `alt` text. Decorative images get `alt=""`.
- Theme toggle button has `aria-label="Toggle theme"`.
- Download CTA must be a real `<a>` with `href` pointing to releases, not a `<div>` click handler.
- Keyboard-navigable in logical DOM order.

---

## 10. Font Loading

All three families are loaded from Google Fonts with `display=swap`. Self-hosting is the preferred path for production (they are all SIL OFL):

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap"
  rel="stylesheet"
/>
```

Subsets to load: latin. Weights: 400, 500, 600 for all three. 700 for Geist (wordmark display).

---

## 11. Theme Behavior

- Default: respect `prefers-color-scheme` on first load.
- Manual toggle: button sets `data-theme="dark"` or `data-theme="light"` on `<html>`.
- Persist selection: store in `localStorage` key `theme`.
- No flash of wrong theme (FOWT): set `data-theme` synchronously in a `<script>` in `<head>` before body renders.

```js
// Place in <head>, before any stylesheet-dependent rendering
(function () {
  var stored = localStorage.getItem('theme');
  var system = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', stored || system);
})();
```

---

## 12. v1.1 — Product Imagery & Motion

This section replaces the `ScreenshotSpread` placeholder and introduces a motion system across the full page. The product mockup is built entirely in DOM — no raster images, no `<canvas>`. Every color comes from existing brand tokens so the mockup adapts to light/dark automatically.

**Design references:** Cursor.com (full-bleed window anchored below hero copy, offset second window for depth) and Flowblock.co (raised centered frame with app chrome). Marvinz adopts the Cursor compositional model — primary window left-anchored, second window floating offset to the right and slightly behind — but keeps the canvas near-white and the palette to Raspberry only, matching Marvinz editorial restraint rather than Flowblock's neon-dark energy.

**Updated direction (post §12 spec):** The mockup must faithfully replicate the visual layer of the real Marvinz Electron/React UI sourced from `src/components/` and `src/App.css`. Structure, proportions, surface colors, chrome details, and component anatomy below now reflect the actual app rather than an invented composition. React will report any deviations between what is built and this spec; §12.4 (re-QA) uses fidelity to the real app as its primary criterion.

---

### 12.1 Hero Mockup Composition

The mockup faithfully replicates the visual layer of the real Marvinz app. All token values, surface colors, font sizes, component shapes and labels below are sourced directly from `src/App.css` and the component files in `src/components/`.

The mockup lives in two placements:

1. **Hero position** — directly below the `.actions` CTA row, `margin-top: var(--space-7)`. Bleeds toward the section bottom border, anchoring the hero in the real product.
2. **ScreenshotSpread section** — replaces the placeholder frame at larger scale with more surrounding whitespace.

Both use the same `<ProductMockup>` component; `size="hero"` and `size="spread"` control scale only.

#### Window chrome — real app values

The outer window is a panel card matching `.editor-pane` / `.claude-pane` in `App.css`:

- `border-radius: var(--radius-lg)` (12px — matches `.editor-pane` and `.claude-pane`)
- `background: var(--surface-1)` (white / `#1F1F1F` dark)
- `box-shadow: var(--shadow-md)` (light: `0 4px 12px rgba(0,0,0,0.08)`, dark: heavier)
- No explicit border on the panel cards in the real app — the shadow provides separation

Above the panel cards, a `topbar` strip replicating `.topbar` from the real `TopBar.tsx`:

- `height: 40px`, `background: var(--bg-app)` (transparent in real Electron, rendered as `--bg-app` in the mockup)
- Left area: empty (`.topbar-left`)
- Center: a search bar pill — `background: var(--surface-2)`, `border: 1px solid var(--border)`, `border-radius: var(--radius-md)`, `font-size: var(--font-size-sm)`, placeholder `Search files…` in `var(--text-tertiary)`, Codicon `search` icon left, `⌘P` kbd right in `var(--text-tertiary)`
- Right area: gear Codicon icon button

No macOS traffic lights — the real app topbar does not render them. They were in the original invented spec; this corrects that.

#### Tab bar — real app values

Below the topbar, sitting above the editor pane, the tab bar matches `.tab-bar` in `App.css`:

- `background: transparent`, `padding: var(--space-2)`, `gap: var(--space-2)`, `height: auto`
- Each tab (`.tab`): `height: 28px`, `padding: var(--space-2) var(--space-3)`, `border-radius: var(--radius-md)` (8px), `background: var(--surface-2)`, `font-size: var(--font-size-sm)` (12px), `font-weight: var(--font-weight-medium)`, `color: var(--text-secondary)`
- Active tab (`.tab.active`): `background: var(--accent-bg)`, `color: var(--text-primary)` — no underline, just the accent tint fill
- Tab has a file-type Codicon icon left (12px, `color: var(--text-tertiary)`) and a close `×` Codicon right (only visible on active)
- Show two tabs: `research-notes` (active, accent-bg fill) and `project-plan` (inactive, surface-2 fill)
- New-tab `+` button at the end: `width: 28px`, `height: 28px`, `border-radius: var(--radius-md)`, `color: var(--text-tertiary)`

#### Primary window — three-pane layout

Real app layout (from `App.css` `.app` grid): `sidebar | splitter | editor | splitter | claude`. In the mockup, simplify to the three visible panels side by side with 8px gaps (matching `var(--space-2)` splitter width):

**Pane 1 — Sidebar / file tree** (`width: 200px`, `flex: none`)

Matches `.sidebar` + `.file-tree` in `App.css`. Background is transparent in the real app (macOS vibrancy), rendered as `var(--bg-app)` in the mockup. Top: `.sidebar-header` — project name in `font-size: var(--font-size-sm)`, `font-weight: var(--font-weight-semibold)`, `color: var(--text-primary)`. Below: `.file-tree-toolbar` with two small Codicon icon buttons (new-file, new-folder) in `color: var(--text-secondary)`.

File tree rows (`ROW_HEIGHT: 28px` per `FileTree.tsx`): `font-size: var(--font-size-sm)` (12px), `color: var(--text-secondary)`. Active file row (`.file-tree-row.active-file`): text in `color: var(--text-primary)`, no background fill — the real app uses font weight/color only, not a tinted bg for the active row. Selected row (`.file-tree-row.selected`): `background: var(--accent-bg)`.

Tree structure to render (decorative):
```
research-notes     ← selected (accent-bg)
project-plan
meeting-2026-06-08
.marvin/
  snapshots/
```

Material file icons from `material-icon-theme` for `.md` files (blue/teal document icon). Folder chevron (`›`) for `.marvin/` in `color: var(--text-tertiary)`.

Sidebar footer: `.sidebar-footer` — two small icon buttons at bottom in `color: var(--text-secondary)`.

**Pane 2 — Editor** (`flex: 1`, `background: var(--surface-1)`)

Matches `.editor-pane` in `App.css`. Contains the tab bar (above) + editor content area.

Editor content (`font-family: var(--font-family-mono)`, `font-size: var(--font-size-md)` = 14px, `line-height: var(--line-height-normal)` = 1.45, `color: var(--text-primary)`). Render 12–14 lines of realistic markdown:

```
# Snapshot restore — decision log

## Context
Exploring two restore strategies after agent turn:
- **Full vault replace** — simpler, destroys concurrent edits
- **File-level patch** — surgical, conflict detection needed

## Decision
Go with file-level patch (`.marvin/snapshots/<turn-id>`).
Rationale: vault may have unsaved work in open tabs.

## Open questions
- [ ] Binary files in snapshot?
- [ ] Conflict UX when agent + user edit same file
```

Syntax coloring matches `App.css` CodeMirror tokens: `#` headings in `var(--text-primary)` at `var(--font-weight-semibold)`; `**bold**` markers in `var(--accent-text)`; list markers `•` and `[ ]` in `var(--text-secondary)`; inline code spans in `font-family: var(--font-family-mono)` with `background: var(--accent-bg)`, `border-radius: var(--radius-sm)`, `padding: 1px 4px`. Cursor: 2px vertical bar in `var(--accent)`.

**Pane 3 — Claude/agents pane** (`width: 240px`, `flex: none`, `background: var(--surface-1)`, `border-radius: var(--radius-lg)`)

Matches `.claude-pane` in `App.css`. Contains the chat panel.

Chat header (`.claude-header`, `height: 38px`, `border-bottom: 1px solid var(--border)`, `padding: 10px 14px`):
- Dot indicator: `width: 8px`, `height: 8px`, `border-radius: 50%`, `background: var(--accent-claude)` (`#c4691f` light / `#d97a30` dark) — Anthropic orange, faithful to the real app's `.claude-header .dot`
- Label: `font-size: var(--font-size-sm)`, `font-weight: var(--font-weight-semibold)`, `color: var(--text-secondary)` — text reads `Claude Code`

Below the header, the chat panel (`.chat-panel-body`). Provider pill (`.chat-provider-pill`): `height: 18px`, `border-radius: var(--radius-pill)`, `background: var(--provider-claude-bg)` (`rgba(196,105,31,0.12)`), `color: var(--provider-claude-fg)` (`#cc6600` light / `#e6a06b` dark) — Anthropic orange, faithful to the real app.

> **Scoped exception — Claude identity orange:** The agent dot and provider pill render the real Anthropic orange (`--accent-claude`, `--provider-claude-fg`) exclusively inside `ProductMockup`, as a faithful product representation. This orange never appears in the site's own UI — CTAs, links, and accents remain Raspberry-only per §5.3. Decided by user.

One assistant message block rendered as timeline-style (not a bubble — matches the real app's `TimelineItem` pattern): text in `font-size: var(--font-size-md)` (14px), `color: var(--text-primary)`:
```
Updated research-notes.md with the file-level
patch decision. Snapshot saved at
.marvin/snapshots/2026-06-09T14-22.
```

Tool approval gate (`.chat-approval-gate` from `ToolApprovalGate.tsx`): rendered below the message. A row with:
- Tool call label in `font-size: var(--font-size-sm)`, `font-weight: var(--font-weight-medium)`, `color: var(--text-primary)`: `write_file research-notes.md`
- Two buttons side by side: Allow (`.chat-approval-btn.primary`, `background: var(--accent)`, `color: var(--surface-1)`) and Deny (`.chat-approval-btn[data-action='deny']`, `color: var(--text-error)`, `border: 1px solid var(--border)`)
- Both buttons: `border-radius: var(--radius-md)`, `font-size: var(--font-size-sm)`, `padding: var(--space-1) var(--space-3)`

Composer row at the bottom (`.chat-panel-composer`, `padding: var(--space-2) var(--space-3) var(--space-3)`): a rounded input field, `background: var(--surface-2)`, `border: 1px solid var(--border)`, `border-radius: var(--radius-md)`, placeholder `Ask Claude Code…` in `color: var(--text-tertiary)`, `font-size: var(--font-size-sm)`.

#### Secondary window — offset depth layer

A second smaller window (`width: min(480px, 60vw)`, same aspect ratio `16/10`) positioned absolutely, offset `+32px right` and `+48px down` from the primary window's bottom-right quadrant, `z-index: 0` (behind primary at `z-index: 1`), `opacity: 0.72`.

Shows only the editor pane (no sidebar, no agents pane) with `project-plan.md` content as a faint layer. Same token values as primary. The `box-shadow` uses `var(--shadow-md)`.

#### Composition container

```css
.mockup-stage {
  position: relative;
  padding-right: clamp(48px, 8vw, 120px);
  padding-bottom: 48px;
}
```

No background on the stage — inherits section background.

---

### 12.2 Motion System

All durations and easings come from existing tokens or are declared as new motion tokens in `:root`. All animations are gated by `prefers-reduced-motion: reduce` — when that query is active, all entrance and ambient animations are disabled entirely (not just slowed). The theme background transition that was preserved in the reduced-motion rule (Section 7 / globals.css) is the only motion that persists.

#### New motion tokens to add to `:root`

```css
/* Motion — extend existing set */
--duration-slow: 300ms;     /* deliberate panel/modal open — already in spec §7 */
--duration-enter: 600ms;    /* entrance fade-up */
--duration-reveal: 500ms;   /* scroll-triggered section reveal */
--duration-float: 6000ms;   /* slow ambient float on mockup windows */
--duration-pulse: 4000ms;   /* glow breathe */
--ease-spring: cubic-bezier(0.22, 1, 0.36, 1);  /* entrance — overshoots slightly */
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);    /* scroll reveals */
```

#### Hero entrance sequence

Elements animate in on mount, staggered. Each element starts `opacity: 0; transform: translateY(20px)` and animates to `opacity: 1; transform: translateY(0)`. All use `--ease-spring`.

| Element | Delay | Duration |
|---|---|---|
| Hero meta strip | `0ms` | `--duration-enter` (600ms) |
| Wordmark | `80ms` | `--duration-enter` |
| Tagline | `160ms` | `--duration-enter` |
| Sub-description | `220ms` | `--duration-enter` |
| CTA actions row | `300ms` | `--duration-enter` |
| Product mockup stage | `420ms` | `--duration-enter` |

Implementation: use CSS `animation-fill-mode: both` with `animation-delay`. A single `data-animate="hero"` attribute on the section triggers a parent class swap on mount (`"entering"` → `"entered"`) which activates child `[data-step="N"]` animations. No JavaScript animation libraries — CSS `@keyframes` only.

```css
@keyframes fade-up {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}

[data-animate="hero"] [data-step] {
  opacity: 0; /* initial — overridden by animation */
  animation: fade-up var(--duration-enter) var(--ease-spring) both;
}
[data-step="0"] { animation-delay: 0ms; }
[data-step="1"] { animation-delay: 80ms; }
[data-step="2"] { animation-delay: 160ms; }
[data-step="3"] { animation-delay: 220ms; }
[data-step="4"] { animation-delay: 300ms; }
[data-step="5"] { animation-delay: 420ms; }

@media (prefers-reduced-motion: reduce) {
  [data-animate="hero"] [data-step] {
    opacity: 1;
    animation: none;
  }
}
```

#### Scroll-triggered section reveals

Each `<Section>` component gets a `data-reveal` attribute. An `IntersectionObserver` (threshold `0.12`, `rootMargin: "0px 0px -60px 0px"`) adds `data-visible="true"` once the section enters the viewport. The transition happens once — no re-trigger on scroll-out.

```css
[data-reveal] {
  opacity: 0;
  transform: translateY(16px);
  transition:
    opacity var(--duration-reveal) var(--ease-in-out),
    transform var(--duration-reveal) var(--ease-in-out);
}

[data-reveal][data-visible="true"] {
  opacity: 1;
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  [data-reveal] {
    opacity: 1;
    transform: none;
    transition: none;
  }
}
```

The `IntersectionObserver` hook lives in a single `useReveal()` custom hook, called once in `page.tsx`. It queries all `[data-reveal]` elements and attaches the observer. On SSR the elements render visible (`opacity: 1`) — the CSS only kicks in after hydration sets `data-reveal` via the hook.

To avoid FOUC during SSR: the `[data-reveal]` attribute is set on the DOM element via `useEffect`, not on the JSX directly. The element renders without the attribute (and therefore visible) during SSR; the attribute appears on mount and the CSS immediately applies the hidden state before the first paint on the client — acceptable given Next.js hydration speed. Alternatively, add `data-reveal` in JSX and suppress the opacity flash with a `[data-reveal]:not([data-visible])` selector scoped to `html.js-loaded` (set a `js-loaded` class on `<html>` on mount).

#### Mockup ambient float

The primary window and secondary window float independently on slow sinusoidal paths. This reads as life — not as a distraction.

```css
@keyframes float-primary {
  0%, 100% { transform: translateY(0px) rotate(0deg); }
  40%       { transform: translateY(-6px) rotate(0.3deg); }
  70%       { transform: translateY(-3px) rotate(-0.2deg); }
}

@keyframes float-secondary {
  0%, 100% { transform: translateY(0px) rotate(0deg); }
  30%       { transform: translateY(-4px) rotate(-0.4deg); }
  65%       { transform: translateY(-8px) rotate(0.2deg); }
}

.mockup-primary {
  animation: float-primary var(--duration-float) var(--ease-in-out) infinite;
}

.mockup-secondary {
  animation: float-secondary var(--duration-float) var(--ease-in-out) infinite;
  animation-delay: -2400ms; /* offset phase so windows don't float in sync */
}

@media (prefers-reduced-motion: reduce) {
  .mockup-primary, .mockup-secondary { animation: none; }
}
```

Float constraints: max vertical travel `8px`, max rotation `0.4deg`. No horizontal drift — it would fight the reading axis. The phase offset (`-2400ms`) ensures the two windows move at different moments, creating subtle parallax depth without explicit parallax.

#### Raspberry glow pulse

The hero `--glow` radial gradient breathes slowly in opacity.

```css
@keyframes glow-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.55; }
}

.hero-glow {
  animation: glow-pulse var(--duration-pulse) var(--ease-in-out) infinite;
}

@media (prefers-reduced-motion: reduce) {
  .hero-glow { animation: none; }
}
```

Duration `--duration-pulse` is `4000ms` — slow enough to be subliminal. The glow already exists as `.glow` in `Hero.module.css`; this animation is additive. Do not increase the glow's base opacity — the token values are correct for the static case.

---

### 12.3 Responsive Behavior of the Mockup

| Breakpoint | Behavior |
|---|---|
| `> 1080px` | Both windows visible, secondary offset fully rendered |
| `760px – 1080px` | Secondary window hidden (`display: none`). Primary window takes full container width. |
| `< 760px` | Mockup stage removed from the hero entirely (`display: none`). ScreenshotSpread section shows only the primary window, full-width, no offset window. |

The mockup is a visual enhancement, not content — removing it at mobile does not hide information. The three-pane layout inside the primary window also simplifies at narrow widths: the file tree pane hides below `520px` (primary window internal breakpoint), leaving only editor + agent sidebar.

---

### 12.4 Accessibility Notes for Mockup & Motion

- The entire `<ProductMockup>` component gets `role="img"` on its outer wrapper and `aria-label="Marvinz workspace — file tree, markdown editor, and Claude Code agent sidebar"`. Screen readers skip the decorative DOM content inside.
- All decorative text inside the mockup (file names, chat lines, code content) is `aria-hidden="true"` at the paragraph/span level, or wrapped in a single `aria-hidden="true"` container.
- The traffic light circles are `aria-hidden="true"`.
- The `IntersectionObserver` in `useReveal()` must check `window.matchMedia('(prefers-reduced-motion: reduce)').matches` before registering — if reduced motion is on, skip observer setup entirely and leave elements visible.
- The float and pulse animations are already gated by `prefers-reduced-motion: reduce` in CSS, but the JS observer skip is a second layer of defense for browsers where the CSS media query fires after paint.
```

---

## 13. v2 — Dark-first Editorial Layout (cutthecode.com reference)

**Route:** `/website/v2` — a standalone Next.js page living alongside the existing v1 at `/website` (root). Both routes serve at the same time so the user can compare them locally. No shared layout between v1 and v2 — each page imports its own CSS module for page-level overrides on top of `globals.css`.

**Design reference:** cutthecode.com — dark charcoal canvas, oversized light-weight editorial headline, ticker bar, pill CTAs with icon chips, alternating light "sheet" sections with giant top-radius, dark bento-grid cards with large rounded corners, product displayed inside a large organic Raspberry-filled shape.

**Brand translation rule (mandatory):** Every place cutthecode.com uses its lilac/purple accent, v2 uses Raspberry (`--accent`) or Mulberry (`--accent-text`). Purple and violet are prohibited by the brandbook. No exceptions. The structural language is borrowed; the palette is entirely Marvinz.

**Copy:** identical to v1 — all brandbook sections, zero banned words.

**Motion:** the §12.2 motion system (hero entrance stagger, scroll reveals, float, glow pulse) applies to v2 without modification.

---

### 13.1 Page-level Token Additions for v2

v2 is dark-first — `--bg-app` starts as the dark canvas value. Because `globals.css` already defines light as default and dark as `[data-theme="dark"]`, v2 sets `data-theme="dark"` as the default on its `<html>` while still supporting the toggle. The existing token set covers everything; the additions below are v2-specific structural values that should be declared in a `/website/v2/v2.css` file (not in `globals.css`):

```css
/* v2-specific structural tokens — do not add to globals.css */
:root {
  --sheet-radius: 48px;         /* top-radius of light sheets rising from dark canvas */
  --bento-radius: 24px;         /* card radius in bento grid */
  --ticker-height: 40px;        /* scrolling ticker bar */
  --hero-weight: 300;           /* editorial headline font-weight — Geist Light */
  --hero-line-height: 0.88;     /* tighter than normal for display-scale type */
  --mockup-blob-radius: 40% 60% 55% 45% / 45% 40% 60% 55%; /* CSS border-radius blob */
}
```

The `--sheet-radius` value of 48px matches the visual from the reference (large but not pill-level). On mobile it should reduce: `clamp(24px, 5vw, 48px)`.

---

### 13.2 v2 Page Structure

Sections in order:

1. **Ticker bar** — full-width, above the nav
2. **TopBar** — same component as v1, but `background: var(--bg-app)` (near-black) with no blur/backdrop-filter (the dark canvas is already opaque)
3. **Hero** — dark canvas, oversized display headline, Raspberry blob shape containing the product mockup
4. **Service cards** — still on dark canvas, three cards in a row (same structure as HowItWorks but card-styled)
5. **Light sheet — How it works** — first light sheet, rises from the dark with `border-radius: var(--sheet-radius) var(--sheet-radius) 0 0` at the top
6. **Light sheet — Features bento** — second light sheet, continues from the first (no dark gap between them), bento grid layout
7. **Dark section — Mockup spread** — returns to dark canvas for the full-width mockup at large scale
8. **Footer** — dark canvas, same content as v1 footer

---

### 13.3 Ticker Bar

A `<div>` spanning full viewport width, `height: var(--ticker-height)` (40px), `background: var(--surface-2)` (on dark this is `#232327`), `border-bottom: 1px solid var(--border)`, `overflow: hidden`.

Inside: a single long `<p>` with `white-space: nowrap` that scrolls continuously leftward using a CSS `@keyframes` animation (`transform: translateX(0)` to `transform: translateX(-50%)` on a duplicated string — the classic infinite-scroll ticker technique). Speed: `30s linear infinite`.

Content (Geist Mono, 11px, `letter-spacing: 0.08em`, `text-transform: uppercase`, `color: var(--text-secondary)`):

```
Where AI output becomes knowledge · Navigate your vault · Approve every tool call · Restore any version · Read side-by-side · Your files, your terms · Where AI output becomes knowledge · Navigate your vault · Approve every tool call · Restore any version · Read side-by-side · Your files, your terms ·
```

The string is duplicated (×2) in the DOM so the loop is seamless. Accent dots (`·`) rendered in `var(--accent-text)` — wrap them in `<span style="color: var(--accent-text)">`.

`prefers-reduced-motion: reduce`: pause the animation (`animation-play-state: paused`). Do not remove — the text is still readable when static.

Accessibility: `aria-hidden="true"` on the ticker. It is purely decorative — the content repeats copy already in the page.

---

### 13.4 Hero Section (v2)

The hero sits on the dark canvas (`var(--bg-app)` = `#161618`). No section border-bottom — it bleeds into the service cards section below.

**Eyebrow chip:** a small pill above the headline. `background: var(--accent-bg)`, `border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent)`, `border-radius: var(--radius-pill)`, `padding: 4px 12px`. Content: a Raspberry dot glyph `●` followed by `Marvinz · Visual workspace for Claude Code` in Geist Mono 11px `var(--accent-text)`. This mirrors the cutthecode.com eyebrow pattern exactly — their lilac dot becomes Raspberry.

**Headline:** Geist, `font-weight: var(--hero-weight)` (300 — Light), `font-size: clamp(56px, 13vw, 180px)`, `line-height: var(--hero-line-height)` (0.88), `letter-spacing: -0.04em`, `color: var(--text-primary)` (`#ECECEE` in dark). Multi-line, breaks freely at the container edge. No `max-width` constraint — the text fills the full column.

```
Where AI output
becomes knowledge
you can navigate.
```

The period at the end of the last line is `color: var(--accent)` (Raspberry). This is the wordmark-period treatment extended to the headline period.

**Sub-description:** Inter 400, `font-size: clamp(15px, 1.8vw, 18px)`, `color: var(--text-secondary)`, `max-width: 52ch`, `margin-top: var(--space-5)`.

```
The visual workspace for Claude Code. Point it at your markdown vault — the agent's output lands as navigable, linked notes you can read, validate, and restore.
```

**CTA row:** two pill buttons side by side, `gap: var(--space-3)`, `margin-top: var(--space-6)`.

Primary pill: `background: var(--accent)`, `color: white`, `border-radius: var(--radius-pill)`, `padding: var(--space-3) var(--space-5)`, `font-family: var(--font-head)`, `font-weight: 600`, `font-size: 15px`. Contains an icon chip on the left: a `+` glyph in a small square (`16×16px`, `background: rgba(255,255,255,0.2)`, `border-radius: 4px`, `font-size: 12px`) — this is the cutthecode CTA chip pattern, translated to Raspberry. Label: `Download`.

Secondary pill: `background: transparent`, `border: 1px solid var(--border-strong)`, `color: var(--text-primary)`, same radius and padding. Label: `See how it works`.

Hover states: primary darkens to `var(--accent-hover)`, secondary border brightens to `var(--border-focus)` and text to `var(--text-primary)`.

**Product blob shape:** a large organic div below the CTA row, `margin-top: var(--space-7)`, partially visible (bleeds below the hero section bottom). This is the cutthecode.com pattern where their product sits in a large lilac organic shape — translated to Raspberry for Marvinz.

```css
.hero-blob {
  position: relative;
  width: min(960px, 95vw);
  aspect-ratio: 16 / 10;
  background: var(--accent-bg);  /* subtle Raspberry tint */
  border-radius: var(--mockup-blob-radius);
  /* A stronger Raspberry border gives the organic shape definition */
  outline: 2px solid color-mix(in srgb, var(--accent) 40%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
```

Inside `.hero-blob` sits `<ProductMockup size="hero" />` (from §12.1). The blob clips the mockup with `overflow: hidden`, so the windows appear to emerge from the Raspberry-tinted organic shape. The blob itself has the slow float animation from §12.2 applied via an outer wrapper (the blob div does not float — only the mockup inside it does, so the shape stays anchored while the content breathes).

On mobile (`< 760px`): blob shrinks to full width, `border-radius: var(--radius-lg)` (falls back to simple rectangle), `aspect-ratio: 4/3`, `overflow: hidden`.

---

### 13.5 Service Cards (v2, on dark canvas)

Three cards in a row on the dark canvas, `gap: var(--space-5)`, same grid as HowItWorks. Each card: `background: var(--surface-1)` (`#1E1E21`), `border: 1px solid var(--border)`, `border-radius: var(--bento-radius)` (24px), `padding: clamp(24px, 3vw, 36px)`.

Card structure:
- Arrow glyph `→` in top-right corner, `color: var(--text-secondary)`, `font-size: 18px`
- Title: Geist 600, 22px, `color: var(--text-primary)`, `letter-spacing: var(--track-head)`
- Body: Inter 400, 15px, `color: var(--text-secondary)`, `line-height: 1.5`

Content (three cards mapping to the three How-it-works steps):

Card 1 — title: `Point at your vault.` / body: `Your files stay where they are. Nothing uploaded, nothing moved. Marvinz reads your local markdown directly.`

Card 2 — title: `The agent works.` / body: `Claude Code edits your files. Output lands as linked, readable notes — snapshotted on every turn so you can roll back.`

Card 3 — title: `Read, navigate, validate.` / body: `Review agent work side-by-side with your own notes. Approve tool calls. Restore any earlier version in one click.`

Hover: `transform: translateY(-3px)`, `border-color: var(--border-strong)`, `box-shadow: var(--shadow-card)`. Transition 250ms ease.

Responsive: `@media (max-width: 760px)` → single column.

---

### 13.6 Light Sheet Sections

The transition from dark to light is achieved by a `<div>` that acts as a "sheet" — a light-colored block with large rounded top corners rising up from the dark canvas. This is the defining structural pattern of the cutthecode.com reference (second screenshot: the cream/light sheet lifting from the dark section below the service cards).

```css
.sheet {
  background: var(--surface-1);  /* #FFFFFF on light, #1E1E21 on dark — but v2 default is dark */
  border-radius: clamp(24px, 5vw, 48px) clamp(24px, 5vw, 48px) 0 0;
  padding: clamp(64px, 9vw, 120px) var(--gutter) clamp(64px, 9vw, 120px);
  /* negative margin pulls it up over the dark section above, creating overlap */
  margin-top: -clamp(24px, 5vw, 48px);
}
```

Since v2 default theme is dark, `var(--surface-1)` resolves to `#1E1E21` — which would make the sheet indistinguishable from the canvas. The sheet sections must explicitly override their background to the light theme value. Use a `data-sheet="light"` attribute with a targeted rule:

```css
[data-sheet="light"] {
  background: #fafafa;
  color: var(--ink, #1c1c1e);
}
[data-sheet="light"] * {
  /* ensure text tokens still resolve correctly inside the sheet */
  --text-primary: #1c1c1e;
  --text-secondary: #6b6b70;
  --surface-1: #ffffff;
  --surface-2: #f4f4f5;
  --border: #e8e8ea;
  --border-strong: #d8d8dc;
}
```

This is a contained override — it does not affect `[data-theme]` globally and does not break the theme toggle. The toggle still switches the overall page; sheets always remain light.

**Sheet 1 — How it works (v2):** Same copy as v1 HowItWorks. Section eyebrow `01 · How it works` in `var(--accent-text)` (Mulberry — which is correctly resolved even inside the sheet because `--accent-text` is not overridden in `[data-sheet="light"]`; it inherits from the nearest `[data-theme]`). Steps in a 3-column grid, same as v1 HowItWorks but styled with the light sheet background.

**Sheet 2 — Features bento (v2):** Immediately below Sheet 1 with no gap (both sheets have `border-radius: 0` on the bottom, so they join seamlessly). `background: var(--surface-2)` (`#F4F4F5` when forced light) — a slightly different shade creates a subtle tonal separation.

---

### 13.7 Bento Grid (Features, v2)

This is the defining v2 pattern — replacing the v1 uniform 3-column features grid with an asymmetric bento layout (third screenshot: the 2-column irregular grid with large rounded cards). The bento uses CSS Grid with named areas.

```css
.bento {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: auto auto auto;
  gap: var(--space-4);
  margin-top: var(--space-7);
}

/* Asymmetry: first card spans full width */
.bento-item:first-child {
  grid-column: 1 / -1;
}
```

Each bento card: `background: var(--surface-1)` (white inside the light sheet), `border: 1px solid var(--border)`, `border-radius: var(--bento-radius)` (24px), `padding: clamp(28px, 3.5vw, 44px)`.

Card anatomy (matching cutthecode reference):
- Eyebrow: Geist Mono 11px uppercase `var(--accent-text)`, `letter-spacing: 0.1em`, `margin-bottom: var(--space-4)`
- Title: Geist 600, `font-size: clamp(20px, 2.5vw, 28px)`, `letter-spacing: var(--track-head)`, `color: var(--text-primary)`, `margin-bottom: var(--space-3)`
- Body: Inter 400, 15px, `color: var(--text-secondary)`, `line-height: 1.55`
- No arrow — the cutthecode arrow glyph was in the dark service cards; bento cards are lighter/softer

Six feature cards arranged in the bento:

**Card 1 (full-width span)** — eyebrow: `Vault` / title: `Markdown vault as the agent's canvas` / body: `Point Marvinz at any local folder. The agent reads and writes markdown directly — no sync, no upload, your files stay on your machine.`

**Card 2** — eyebrow: `Agent` / title: `Claude Code sidebar` / body: `Chat with the agent, approve tool calls before they run, and watch edits land in the editor in real time.`

**Card 3** — eyebrow: `Snapshots` / title: `Every edit is snapshotted` / body: `Marvinz saves a snapshot on every agent turn. Restore any earlier version from the history panel in one click.`

**Card 4** — eyebrow: `Preview` / title: `Live markdown preview` / body: `Side-by-side editor and rendered preview. Tables, wikilinks, code blocks — rendered as you write.`

**Card 5** — eyebrow: `Tabs` / title: `Multi-tab workspace` / body: `Open multiple files at once, switch between agent output and your own notes, build the context you need.`

**Card 6 (full-width span)** — eyebrow: `Control` / title: `Approvable tool calls` / body: `Every filesystem action the agent wants to take surfaces for your approval. You decide what runs — nothing happens without your review.`

Cards 1 and 6 span full width (`grid-column: 1 / -1`). Cards 2–5 are in a 2-column pair. This creates the asymmetric rhythm visible in the cutthecode bento reference.

Responsive: below 640px, all cards go single-column (`grid-template-columns: 1fr`).

---

### 13.8 Mockup Spread Section (v2, dark)

Returns to dark canvas (`background: var(--bg-app)`). No sheet wrapper — this is a standard dark section. Contains `<ProductMockup size="spread" />` (from §12.1) at full container width, same spec as v1. The dark background makes the `--shadow-card` (heavier dark variant) read more clearly and gives the spread a cinematic quality that the v1 light spread cannot match.

Section copy is identical to v1 ScreenshotSpread: eyebrow `03 · See it`, title `Your vault. Your files. Your terms.`, lead from the spec §3.5.

---

### 13.9 Footer (v2)

Same component as v1 footer, no changes. On dark canvas it inherits the dark token values correctly.

---

### 13.10 v2 Typography Adjustments

| Element | v1 value | v2 value | Why |
|---|---|---|---|
| Hero headline weight | 500 (medium) | 300 (light) | Editorial scale — cutthecode pattern; works because size compensates for weight |
| Hero headline size | `clamp(24px, 4.4vw, 46px)` | `clamp(56px, 13vw, 180px)` | Display-scale, fills full column width |
| Hero line-height | `1.1` | `0.88` | Tighter — standard for display-scale editorial type |
| Section title `max-width` | `22ch` | `none` (v2 hero headline) | Let the type fill the column |
| Bento card title size | 19px (v1 card) | `clamp(20px, 2.5vw, 28px)` | Larger cards need more title weight |

No other typography changes — body, mono, and section H2 remain the same across v1 and v2.

---

### 13.11 v2 Responsive Summary

| Breakpoint | Hero headline | Blob shape | Ticker | Bento | Sheets |
|---|---|---|---|---|---|
| `> 1080px` | Full display scale | Organic border-radius | Scrolling | 2-col asymmetric | Full radius |
| `760px – 1080px` | Scales with `clamp` | Simplified to `--radius-lg` | Scrolling | 2-col uniform | Reduced radius |
| `< 760px` | `clamp` floor ~56px | Full-width rectangle | Paused (reduced motion) | 1-col | `24px` top radius |
| `< 480px` | `clamp` floor ~56px | Hidden | Hidden | 1-col | `16px` top radius |

---

### 13.12 v2 File Structure

```
/website
  /app
    page.tsx           ← v1 (unchanged)
    layout.tsx         ← shared (unchanged)
    globals.css        ← shared tokens (unchanged)
    /v2
      page.tsx         ← v2 page, imports v2.css + all v2 components
      v2.css           ← v2-specific structural tokens (sheet-radius, bento-radius, etc.)
  /components
    TopBar.tsx         ← shared (unchanged)
    ThemeToggle.tsx    ← shared (unchanged)
    Footer.tsx         ← shared (unchanged)
    ProductMockup.tsx  ← shared (built in task #10)
    /v2
      Ticker.tsx
      HeroV2.tsx
      ServiceCards.tsx
      SheetSection.tsx  ← wrapper component for light sheets
      BentoGrid.tsx
      MockupSpreadV2.tsx
```

v2 components import shared components (TopBar, ThemeToggle, Footer, ProductMockup) directly. No duplication. v2-only components live in `/components/v2/`.
