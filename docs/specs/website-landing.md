# Website Landing Page — Design Spec

**Issue:** #425  
**Branch:** `feat/website-landing`  
**Source of truth:** `/tmp/marvinz-brandbook.html` (Brandbook v1, 2026-05-27)  
**Status:** Draft — implementation-ready

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
