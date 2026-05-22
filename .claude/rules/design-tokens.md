# Design Tokens

This guide defines Marvinz's design token system — the single source of truth for colors, spacing, typography, shadows, and motion. All UI values must come from tokens, never hardcoded.

## Token categories

| Category | Var Prefix | Count | Examples |
|----------|-----------|-------|----------|
| **Color** | `--bg-`, `--surface-`, `--border-`, `--text-`, `--accent-` | 27 | `--bg-app: #ececec`, `--text-primary: #1a1a1a`, `--text-error`, `--border-focus`, `--bg-overlay`, `--bg-hover`, `--bg-error-strong`, `--bg-error-subtle` |
| **Z-index** | `--z-` | 5 | `--z-dropdown: 50`, `--z-modal: 200`, `--z-toast: 300` |
| **Focus** | `--focus-ring`, `--focus-ring-inset` | 2 | Apply as `box-shadow: var(--focus-ring)` inside `:focus-visible` |
| **Code syntax** | `--code-` | 8 | `--code-keyword`, `--code-string`, `--code-comment` (italic). Wired into CodeMirror via `HighlightStyle` in `Editor.tsx` |
| **Spacing** | `--space-` | 7 | `--space-1: 4px`, `--space-4: 16px`, `--space-7: 48px` |
| **Radius** | `--radius-` | 5 | `--radius-sm: 3px`, `--radius-md: 6px`, `--radius-lg: 12px`, `--radius-xl: 16px`, `--radius-pill: 999px` |
| **Typography** | `--font-family-`, `--font-size-`, `--line-height-`, `--font-weight-` | 14 | `--font-family-sans` (system UI), `--font-family-mono` (system mono), `--font-size-md: 1rem` (14px), `--font-weight-semibold: 600`, `--font-weight-bold: 700` |
| **Shadow** | `--shadow-` | 3 base + dark variants | `--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08)` |
| **Motion** | `--duration-`, `--ease-` | 5 | `--duration-normal: 200ms`, `--ease-out: cubic-bezier(0, 0, 0.2, 1)` |

## When to use which

**Color tokens** — Every surface, text, border, and accent. Light theme in `:root`, dark overrides in `[data-theme='dark']`.
- Surfaces: `--bg-app` (page), `--surface-1/2/3` (cards, panels, nesting)
- Text: `--text-primary` (body), `--text-secondary` (hints, captions), `--text-tertiary` (disabled, very faint), `--text-error / --text-warning / --text-success` (semantic states)
- Borders: `--border-subtle` (intra-panel hairlines), `--border` (default dividers), `--border-strong` (emphasis), `--border-focus` (focused inputs — defaults to `--accent`), `--border-error / --border-warning / --border-success` (semantic states)
- Accent: `--accent` (buttons, links), `--accent-bg` (highlights)

**Spacing** — padding/margin inside components or between elements.
- Inside buttons: `--space-2` or `--space-3`
- Component padding: `--space-4` or `--space-5`
- Large gaps/insets: `--space-6`, `--space-7`

**Radius** — border-radius for UI elements.
- Buttons, inputs: `--radius-md` (6px)
- Modals, popovers: `--radius-lg` (12px)
- Layout panels (sidebar, editor, claude card): `--radius-xl` (16px)
- Badges, pills, avatars: `--radius-pill` (999px)
- Chrome elements (scrollbars): `--radius-sm` (3px)

**Typography** — font-size, line-height, and weight for all text.
- Captions/status: `--font-size-xs` (10px), `--line-height-tight`
- Body text: `--font-size-md` (14px), `--line-height-normal`, `--font-weight-regular`
- Section headers: `--font-size-lg` (16px), `--font-weight-semibold`
- Modal titles: `--font-size-xl` (20px), `--font-weight-semibold`

**Shadow** — elevation on cards, modals, and hover states.
- Small (tooltips, subtle lift): `--shadow-sm`
- Medium (cards, dropdowns): `--shadow-md`
- Large (modals, panels): `--shadow-lg`
- Dark theme gets heavier shadows for visibility.

**Z-index** — UI layering. Never use bare integers for z-index (except local stacking contexts like `z-index: 1`).
- Dropdowns / inline suggestions: `--z-dropdown`
- Popovers / path-suggest: `--z-popover`
- Modals + backdrops: `--z-modal`
- Toasts / context menus / overlays above modals: `--z-toast`
- Tooltips: `--z-tooltip`

**Focus** — keyboard focus ring. Apply via `box-shadow` inside `:focus-visible`, not `outline` (avoids layout shift).
```css
.btn:focus-visible { box-shadow: var(--focus-ring); }
.input:focus-visible { box-shadow: var(--focus-ring-inset); }
```

**Motion** — transitions and animations.
- Hover effects (fast feedback): `--duration-fast` (120ms) + `--ease-out`
- Click/toggle (normal feel): `--duration-normal` (200ms) + `--ease-in-out`
- Panel/modal open (deliberate): `--duration-slow` (300ms) + `--ease-in-out`

## Rules

- **No new hex, px, or rem literals in component CSS** when a token exists for that purpose. Use `var(--token-name)` instead.
- **Spacing in components MUST come from `--space-*`**. Never hardcode `padding: 12px` — use `padding: var(--space-3)`.
- **All color values must use color tokens**, even white, black, or grays. Hardcoded `#fff` or `rgba(0,0,0,...)` is a flag for review.
- **Typography combinations are standardized**. When setting font-size, also set line-height and weight from the same scale for visual consistency.
- **Dark theme tokens override in `[data-theme='dark']`** — colors and shadows only. Spacing, radius, typography are the same across themes.
- **New tokens require alignment with the team** before adding to `:root`. Propose the value + use case in a comment, discuss, then commit.

## How to add a new token

1. **Propose**: Comment in your PR what value you need and why (e.g., "adding `--space-0: 2px` for very tight icon gaps in the toolbar").
2. **Align**: Get feedback from the team on naming and whether it fits the existing scale.
3. **Commit**: Add to `:root` with a one-line comment explaining the purpose. If it's a color, add the dark theme override too.

Example:
```css
:root {
  /* Spacing — 4px base, 7 steps from tight UI gaps to editorial insets */
  --space-1: 4px;
  /* ... */
  --space-7: 48px;
}

[data-theme='dark'] {
  /* Shadows inherit overrides for visibility in dark mode */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.15);
  /* ... */
}
```

Keep the token system lean. When in doubt, ask yourself: "Does this value exist elsewhere?" If yes, use that token instead.
