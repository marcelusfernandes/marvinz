# Pastel Theme — Design Spec

**Issue:** #398
**Flavor selector:** `[data-flavor='pastel']`
**Variants:** pastel-light · pastel-dark
**Status:** FINAL v2 — pastel-dark surface ramp deepened to Claude-brand near-black; 34/34 contrast checks pass

---

## Design intent

The pastel flavor replaces Marvinz's cool neutral palette with a warm cream/ivory canvas rooted in the Claude brand identity. Backgrounds shift from `#fafafa` (neutral white) to warm creams. The raspberry accent is replaced by a clay/coral derived from the existing `--accent-claude: #c4691f` family.

Four design goals, all met in this spec:

1. **Reading comfort** — surface-1 (editor, sidebar, claude card) is warm cream, not near-white
2. **WCAG 1.4.11** — `--border-strong` ≥ 3:1 on every surface it appears against (recalculated against final surfaces)
3. **Shell-wash coherence** — vibrancy tint harmonized with each variant's bg-app
4. **Claude-brand dark depth** — pastel-dark surface ramp mirrors Claude app's warm near-black with tight, subtle elevation steps (lum deltas 0.003 / 0.004 / 0.005, matching Claude dark cadence)

**Unchanged tokens (omitted from tables):** spacing, radius, typography, z-index, motion, syntax highlight, semantic status colors (`--text-error`, `--border-error`, `--bg-error-*`, etc.), find-in-page highlights, chat panel tokens, pill tokens. `--accent-claude` and `--accent-codex` are agent identity colors — untouched.

**`--border` (decorative dividers) is intentionally soft** — WCAG 1.4.11 only requires 3:1 for borders that are the sole visual indicator of a component. Decorative dividers are exempt; forcing them to 3:1 would flatten the pastel aesthetic.

---

## Contrast audit (WCAG AA — computed against final surfaces)

All ratios via WCAG 2.1 relative luminance. Text: ≥ 4.5:1. UI components/borders: ≥ 3:1.

### Pastel Light

| Pair                                            | Ratio   | Result                                                                                                                                                                                                                                 |
| ----------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--text-primary` (#2b1f14) on `--bg-app`        | 14.41:1 | AAA                                                                                                                                                                                                                                    |
| `--text-primary` (#2b1f14) on `--surface-1`     | 13.55:1 | AAA                                                                                                                                                                                                                                    |
| `--text-primary` (#2b1f14) on `--surface-2`     | 12.32:1 | AAA                                                                                                                                                                                                                                    |
| `--text-primary` (#2b1f14) on `--surface-3`     | 11.14:1 | AAA                                                                                                                                                                                                                                    |
| `--text-secondary` (#6b5344) on `--bg-app`      | 6.40:1  | AA                                                                                                                                                                                                                                     |
| `--text-secondary` (#6b5344) on `--surface-1`   | 6.02:1  | AA                                                                                                                                                                                                                                     |
| `--text-secondary` (#6b5344) on `--surface-2`   | 5.47:1  | AA                                                                                                                                                                                                                                     |
| `--text-secondary` (#6b5344) on `--surface-3`   | 4.95:1  | AA                                                                                                                                                                                                                                     |
| `--text-tertiary` (#766050) on `--bg-app`       | 5.30:1  | AA                                                                                                                                                                                                                                     |
| `--text-tertiary` (#766050) on `--surface-1`    | 4.98:1  | AA                                                                                                                                                                                                                                     |
| `--text-tertiary` (#766050) on `--surface-2`    | 4.53:1  | AA                                                                                                                                                                                                                                     |
| `--text-tertiary` (#766050) on `--surface-3`    | 4.10:1  | Only co-occurs on a disabled 28px icon button (`.chat-composer-send:disabled`); non-text 1.4.11 (≥3:1) applies and disabled controls are exempt per 1.4.3; still better than the default theme baseline (2.33:1) for the same element. |
| `--accent-text` (#a84f2b) on `--bg-app`         | 4.94:1  | AA                                                                                                                                                                                                                                     |
| `--accent-text` (#a84f2b) on `--surface-1`      | 4.64:1  | AA                                                                                                                                                                                                                                     |
| `--on-accent` (#ffffff) on `--accent` (#a84f2b) | 5.50:1  | AA                                                                                                                                                                                                                                     |
| `--border-strong` (#8f6e5c) on `--surface-1`    | 3.90:1  | AA (UI component)                                                                                                                                                                                                                      |
| `--border-strong` (#8f6e5c) on `--surface-2`    | 3.54:1  | AA (UI component)                                                                                                                                                                                                                      |
| `--border-strong` (#8f6e5c) on `--surface-3`    | 3.20:1  | AA (UI component)                                                                                                                                                                                                                      |

### Pastel Dark (v3 surfaces — dessaturated to warm-neutral charcoal, R-B +6/+8)

| Pair                                            | Ratio   | Result            |
| ----------------------------------------------- | ------- | ----------------- |
| `--text-primary` (#f5ede4) on `--bg-app`        | 15.50:1 | AAA               |
| `--text-primary` (#f5ede4) on `--surface-1`     | 14.74:1 | AAA               |
| `--text-primary` (#f5ede4) on `--surface-2`     | 13.82:1 | AAA               |
| `--text-primary` (#f5ede4) on `--surface-3`     | 12.78:1 | AAA               |
| `--text-secondary` (#c9a98f) on `--bg-app`      | 8.18:1  | AA                |
| `--text-secondary` (#c9a98f) on `--surface-1`   | 7.77:1  | AA                |
| `--text-tertiary` (#b09070) on `--bg-app`       | 6.05:1  | AA                |
| `--text-tertiary` (#b09070) on `--surface-1`    | 5.75:1  | AA                |
| `--text-tertiary` (#b09070) on `--surface-2`    | 5.39:1  | AA                |
| `--text-tertiary` (#b09070) on `--surface-3`    | 4.99:1  | AA                |
| `--accent-text` (#d97a45) on `--bg-app`         | 5.84:1  | AA                |
| `--accent-text` (#d97a45) on `--surface-1`      | 5.55:1  | AA                |
| `--on-accent` (#1a1614) on `--accent` (#d97a45) | 5.84:1  | AA                |
| `--border-strong` (#9a7460) on `--surface-1`    | 4.10:1  | AA (UI component) |
| `--border-strong` (#9a7460) on `--surface-2`    | 3.84:1  | AA (UI component) |
| `--border-strong` (#9a7460) on `--surface-3`    | 3.56:1  | AA (UI component) |

---

## CSS blocks — paste into App.css

### `[data-flavor='pastel']` — after the `:root` block

```css
[data-flavor='pastel'] {
  /* === Surfaces — warm cream canvas for reading comfort === */
  --bg-app: #f7f2eb; /* warm linen canvas */
  --surface-1: #f2ebe0; /* warm cream; editor, sidebar, claude card */
  --surface-2: #ebe0d2; /* deeper warm; recessed inputs, search */
  --surface-3: #e3d5c4; /* tan; hover fills, inactive tabs */

  /* === Borders — warm, muted; only --border-strong carries 3:1 requirement === */
  --border-subtle: rgba(92, 60, 30, 0.06); /* warm hairline */
  --border: #e0d0be; /* warm decorative divider */
  --border-strong: #8f6e5c; /* 3.20:1 on surface-3 (AA UI component) */

  /* === Text — warm-brown scale === */
  --text-primary: #2b1f14; /* dark espresso; 13.55:1 on surface-1 */
  --text-secondary: #6b5344; /* medium warm brown; 6.02:1 on surface-1 */
  --text-tertiary: #766050; /* muted warm brown; 4.53:1 on surface-2 */

  /* === Accent — clay/coral (Claude brand family) === */
  --accent: #a84f2b; /* clay; replaces raspberry #c95d7f */
  --accent-bg: rgba(168, 79, 43, 0.12); /* warm tint wash */
  --accent-text: #a84f2b; /* 4.64:1 on surface-1 (AA) */
  --on-accent: #ffffff; /* 5.50:1 on clay (AA) */

  /* === Hover washes — warm tint === */
  --bg-hover: rgba(92, 60, 30, 0.07);
  --bg-hover-strong: rgba(92, 60, 30, 0.12);

  /* === Shell wash — deeper than panels so surface-1 reads as elevated === */
  --shell-wash: rgba(
    235,
    224,
    210,
    0.85
  ); /* surface-2 base, 0.85 opacity resists vibrancy lightening */

  /* === Shadows — warm clay tint === */
  --shadow-sm: 0 1px 2px rgba(60, 35, 10, 0.06);
  --shadow-md: 0 4px 12px rgba(60, 35, 10, 0.1);
  --shadow-lg: 0 12px 30px rgba(60, 35, 10, 0.18);

  /* === Focus ring — warm tint === */
  --focus-ring: 0 0 0 3px rgba(92, 60, 30, 0.35);
  --focus-ring-inset: inset 0 0 0 2px rgba(92, 60, 30, 0.5);
}
```

### `[data-flavor='pastel'][data-theme='dark']` — after the `[data-theme='dark']` block

```css
[data-flavor='pastel'][data-theme='dark'] {
  /* === Surfaces — warm-neutral charcoal; R-B +6/+8 (subtle warmth, not espresso) === */
  --bg-app: #1a1614; /* warm charcoal canvas */
  --surface-1: #1f1b19; /* warm charcoal; cards */
  --surface-2: #24211e; /* warm dark; inputs */
  --surface-3: #2b2723; /* raised; hover tabs */

  /* === Borders — warm dark === */
  --border-subtle: rgba(255, 200, 150, 0.07); /* warm white hairline */
  --border: #3d2b1e; /* warm decorative divider */
  --border-strong: #9a7460; /* 3.56:1 on surface-3 (AA UI component) */

  /* === Text — warm cream scale === */
  --text-primary: #f5ede4; /* warm cream; 15.48:1 on bg-app */
  --text-secondary: #c9a98f; /* warm tan; 8.17:1 on bg-app */
  --text-tertiary: #b09070; /* muted warm; 5.29:1 on surface-2 */

  /* === Accent — lighter clay for dark surfaces === */
  --accent: #d97a45; /* lighter clay */
  --accent-bg: rgba(217, 122, 69, 0.18); /* warm tint wash */
  --accent-text: #d97a45; /* 5.83:1 on bg-app (AA) */
  --on-accent: #1a1614; /* dark text on light clay; 5.84:1 (AA) */

  /* === Hover washes — warm light tint === */
  --bg-hover: rgba(255, 200, 150, 0.08);
  --bg-hover-strong: rgba(255, 200, 150, 0.13);

  /* === Shell wash — warm espresso tint, coherent with bg-app === */
  --shell-wash: rgba(18, 12, 8, 0.78);

  /* === Shadows — heavier for dark === */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.2);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.35);
  --shadow-lg: 0 12px 30px rgba(0, 0, 0, 0.55);

  /* === Focus ring — warm tint on dark === */
  --focus-ring: 0 0 0 3px rgba(255, 200, 150, 0.35);
  --focus-ring-inset: inset 0 0 0 2px rgba(255, 200, 150, 0.5);
}
```

---

## Notes for the implementer

1. **Selector order matters.** `[data-flavor='pastel'][data-theme='dark']` has higher specificity than `[data-theme='dark']`. Place it after `[data-theme='dark']` in `App.css`.

2. **`--border-focus` inherits automatically.** It is `var(--accent)` in `:root` — the pastel clay override flows through without an explicit override.

3. **`--pill-bg`, `--pill-border`, `--pill-text`** are `var()` aliases of surface/border/text tokens. They resolve to pastel values automatically.

4. **Chat panel tokens** (`--chat-bubble-*`, `--thinking-*`, `--provider-*`) are `var()`-based and resolve automatically.

5. **`--on-accent` differs between variants.** Light: `#ffffff` (white on dark clay). Dark: `#1a1614` (dark text on lighter clay). Verify button components use `var(--on-accent)`, not hardcoded `color: white`.

6. **Semantic status tokens are untouched** (`--text-error`, `--border-error`, `--bg-error-*`, etc.).
