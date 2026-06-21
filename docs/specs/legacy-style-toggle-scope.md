# Legacy style toggle — audit scope

Merge base: `8b4180ca26322452676f7438d112834e15b72231`
Compared against: `HEAD` on `feat/legacy-style-toggle` (which includes all of `feat/redesign-shell-sidebar`).

Files changed: `src/App.css`, `src/App.tsx`, `src/components/Editor.tsx`, `src/components/PathSuggest.tsx`, `src/components/Properties.tsx`, `src/components/SettingsModal.tsx`, `src/components/TabBar.tsx`, `src/components/TopBar.tsx` (deleted), `electron/main.ts`.

---

## Section 1 — CSS-revertible

Every item below is a visual change that can be restored to the legacy look via a `[data-style='legacy']` selector override. No JSX changes are needed for these.

### 1.1 Design tokens — `:root`

| Token                | Legacy value | Modern value                                                |
| -------------------- | ------------ | ----------------------------------------------------------- |
| `--radius-sm`        | `3px`        | `4px`                                                       |
| `--radius-md`        | `6px`        | `8px`                                                       |
| `--space-0`          | _(absent)_   | `2px`                                                       |
| `--pill-bg`          | _(absent)_   | `var(--surface-3)`                                          |
| `--pill-border`      | _(absent)_   | `var(--border)`                                             |
| `--pill-text`        | _(absent)_   | `var(--text-primary)`                                       |
| `--pill-tag-bg`      | _(absent)_   | `color-mix(in srgb, var(--accent-claude) 12%, transparent)` |
| `--pill-tag-border`  | _(absent)_   | `color-mix(in srgb, var(--accent-claude) 35%, transparent)` |
| `--pill-tag-text`    | _(absent)_   | `var(--accent-claude)`                                      |
| `--accent-claude`    | _(absent)_   | `#c4691f`                                                   |
| `--accent-claude-bg` | _(absent)_   | `#c4691f14`                                                 |
| `--accent-codex`     | _(absent)_   | `var(--accent)`                                             |
| `--accent-codex-bg`  | _(absent)_   | `var(--accent-bg)`                                          |

Note: The new `--accent-claude*` and `--accent-codex*` tokens are used by `.agent-tab[data-agent='claude'].active` and `.agent-tab[data-agent='codex'].active` backgrounds. In legacy mode these agent-specific accent backgrounds should revert to the old `.agent-tab.active::after` underline indicator; see Section 1.7.

### 1.2 Design tokens — `[data-theme='dark']`

| Token                       | Legacy value | Modern value |
| --------------------------- | ------------ | ------------ |
| `--bg-app`                  | `#121212`    | `#0e0e0e`    |
| `--surface-1`               | `#1e1e1e`    | `#26262a`    |
| `--surface-2`               | `#181818`    | `#2e2e32`    |
| `--surface-3`               | `#232323`    | `#36363a`    |
| `--border`                  | `#2e2e2e`    | `#38383a`    |
| `--border-strong`           | `#3a3a3a`    | `#48484a`    |
| `--text-primary`            | `#e6e6e6`    | `#f2f2f7`    |
| `--text-secondary`          | `#a0a0a0`    | `#aeaeb2`    |
| `--text-tertiary`           | `#6a6a6a`    | `#8e8e93`    |
| `--accent-claude` (dark)    | _(absent)_   | `#d97a30`    |
| `--accent-claude-bg` (dark) | _(absent)_   | `#d97a3022`  |

### 1.3 Shell & layout

| Selector                              | Legacy state                                                 | Modern change                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `#root`                               | `background: var(--bg-app)`                                  | `background: transparent` (vibrancy)                                                                                                  |
| `.shell`                              | `background: var(--surface-1)`; no padding, no border-radius | `background: rgba(246,246,246,0.7)`; `padding: var(--space-3)`; `border-radius: 16px`; `overflow: hidden`; `-webkit-app-region: drag` |
| `[data-theme='dark'] .shell`          | _(absent)_                                                   | `background: rgba(15,15,15,0.75)`                                                                                                     |
| `.app`                                | `background: var(--surface-1)`                               | background removed; splitter gap changed from `1px` to `var(--space-3)`                                                               |
| `.app[data-layout='claude-center']`   | splitter tracks: `1px`                                       | `var(--space-3)`                                                                                                                      |
| `.splitter`                           | `background: var(--border)`                                  | `background: transparent`                                                                                                             |
| `.splitter::before`                   | `left: -3px; right: -3px` (extends past 1px line)            | `inset: 0` (fills the gap track)                                                                                                      |
| `.splitter:hover, .splitter.dragging` | `background: var(--accent)`                                  | `background: var(--accent-bg)`                                                                                                        |

### 1.4 Topbar (removed in Modern; must be restored in Legacy via JSX — see Section 2)

The `.topbar`, `.topbar-left`, `.topbar-right`, `.topbar-search`, `.topbar-search-icon`, `.topbar-search-text`, `.topbar-search-shortcut`, `.topbar-icon-btn` CSS classes were entirely removed from `App.css`. The CSS rules for `.palette-footer kbd` / `.sidebar-search-btn kbd` replaced `.topbar-search-shortcut kbd`. These classes need to be restored in `legacy.css` so they can style the topbar JSX that task #8 will re-introduce conditionally.

### 1.5 Sidebar

| Selector                                                 | Legacy state                                                         | Modern change                                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `.sidebar`                                               | `background: var(--surface-2)`                                       | `background: transparent`; `border-radius: var(--radius-xl)`                                        |
| `.sidebar-header`                                        | `border-bottom: 1px solid var(--border)`; `height: 38px`             | border-bottom removed; height removed; `gap: var(--space-2)`                                        |
| `.vault-name` (class renamed to `.sidebar-project-name`) | `color: var(--text-secondary)`                                       | now `.sidebar-project-name` with `color: var(--text-primary)`                                       |
| `.sidebar-footer`                                        | `border-top: 1px solid var(--border)`; `padding: 6px var(--space-2)` | border-top removed; new padding/flex layout for `.sidebar-footer-btn`                               |
| `.sidebar-footer-btn`                                    | _(absent)_                                                           | full new block: `display: flex; align-items: center; gap; padding; border-radius; font-size; color` |
| `.file-tree-row` color                                   | `color: var(--text-secondary)`                                       | `color: var(--text-primary)`                                                                        |
| `.file-tree-row .icon-wrap`                              | `color: var(--text-tertiary)`                                        | `color: var(--text-secondary)`                                                                      |
| `.file-tree-row .folder-icon, .file-icon`                | `color: var(--text-tertiary)`                                        | `color: var(--text-secondary)`                                                                      |
| `.text-btn` padding                                      | `padding: var(--space-1) 6px`                                        | `padding: var(--space-1) var(--space-2)`                                                            |

New classes added (sidebar-only, require legacy restoration):

- `.sidebar-search` (container with `padding-left: 80px` for traffic light clearance)
- `.sidebar-search-btn` (the pill-shaped search trigger)
- `.sidebar-search-placeholder`, `.sidebar-search-kbd`
- `.sidebar-project-info`, `.sidebar-project-text`, `.sidebar-project-name`, `.sidebar-branch-name`
- `.sidebar-avatar`

In legacy mode these classes will not exist in the DOM (JSX is conditional — Section 2), so their CSS need not be overridden. However, `.vault-name` must be restored because it will be re-introduced by the legacy JSX path.

### 1.6 Editor pane

| Selector                           | Legacy state                                                                                                                                  | Modern change                                                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `.editor-pane` (`.editor` parent)  | no `border-radius`                                                                                                                            | `border-radius: var(--radius-xl)`                                                                                                            |
| `.tab-bar`                         | `background: var(--surface-2)`; `border-bottom: 1px solid var(--border)`; `padding: 0 var(--space-1)`; `height: 38px`; `align-items: stretch` | `background: transparent`; no border; `padding: var(--space-2) var(--space-3)`; `height: 48px`; `align-items: center`; `gap: var(--space-1)` |
| `.tab`                             | no border-radius; `border-right: 1px solid var(--border)`; no height; no background                                                           | `height: 32px`; `border-radius: var(--radius-md)`; `background: var(--surface-2)`                                                            |
| `.tab` font-weight                 | _(unset / inherit)_                                                                                                                           | `font-weight: var(--font-weight-medium)`                                                                                                     |
| `.tab.active`                      | `background: var(--surface-1)` + `::after` underline in `--accent`                                                                            | `background: var(--accent-bg)`; no `::after`                                                                                                 |
| `.tab.active::after`               | 2px bottom underline in `--accent`                                                                                                            | removed                                                                                                                                      |
| `.tab-close`                       | `display: flex` (always visible)                                                                                                              | `display: none` by default; `display: flex` only when `.tab.active`                                                                          |
| `.tab-icon` color on active        | `color: var(--text-secondary)`                                                                                                                | `color: var(--text-primary)`                                                                                                                 |
| `.tab-new-btn`                     | `height: 100%`                                                                                                                                | `height: 32px`; `border-radius: var(--radius-md)`                                                                                            |
| `.file-tree-row.file.non-md .name` | `color: var(--text-tertiary)`                                                                                                                 | `color: var(--text-secondary)`                                                                                                               |

### 1.7 Claude pane / Agents tab bar

| Selector                                 | Legacy state                                                                                                              | Modern change                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude-pane`                           | `background: var(--surface-2)`                                                                                            | `background: var(--surface-1)`; `border-radius: var(--radius-xl)`                                                                            |
| `.agent-tabs`                            | `height: 38px`; `border-bottom: 1px solid var(--border)`; `padding: 0 var(--space-1)`; `align-items: stretch`             | `height: 48px`; no border; `background: transparent`; `padding: var(--space-2) var(--space-3)`; `gap: var(--space-1)`; `align-items: center` |
| `.agent-tab`                             | `border-right: 1px solid var(--border)`; `color: var(--text-tertiary)`; no border-radius; no height; `position: relative` | `height: 32px`; `border-radius: var(--radius-md)`; `background: var(--surface-2)`; `color: var(--text-secondary)`                            |
| `.agent-tab:hover`                       | `color: var(--text-secondary)`                                                                                            | `background: var(--surface-3)`; `color: var(--text-primary)`                                                                                 |
| `.agent-tab.active`                      | `background: var(--surface-1)` + `::after` underline in `--accent`                                                        | `background: var(--accent-bg)`; no `::after`                                                                                                 |
| `.agent-tab.active::after`               | 2px bottom underline                                                                                                      | removed                                                                                                                                      |
| `.agent-tab[data-agent='claude'].active` | _(absent, used generic active)_                                                                                           | `background: var(--accent-claude-bg)`                                                                                                        |
| `.agent-tab[data-agent='codex'].active`  | _(absent)_                                                                                                                | `background: var(--accent-codex-bg)`                                                                                                         |
| `.agent-tab:hover .agent-tab-close`      | `display: inline-flex` (shown on hover)                                                                                   | removed (close only shows on `.agent-tab.active`)                                                                                            |
| `.agent-tab-close`                       | `width: 18px`                                                                                                             | `width: 22px`; `height: 22px`; `padding: 0`                                                                                                  |
| `.agent-new-plus`                        | `width: 38px`; `border-radius: var(--radius-sm) 0 0 var(--radius-sm)`                                                     | `width: 32px`; `border-radius: var(--radius-md) 0 0 var(--radius-md)`                                                                        |
| `.agent-new-chevron`                     | `width: 38px`; `border-left: 1px solid var(--border)`; `border-radius: 0 var(--radius-sm)...`                             | `width: 24px`; no border-left; `border-radius: 0 var(--radius-md)...`                                                                        |
| `.agent-new-plus, .agent-new-chevron`    | `height: 100%`; `border: 1px solid transparent`                                                                           | `height: 32px`; `border: none`                                                                                                               |
| `.claude-host .xterm-viewport`           | no `background` override                                                                                                  | `background: transparent !important`                                                                                                         |
| `.agent-terminal, .agent-stack`          | _(absent)_                                                                                                                | `background: transparent`                                                                                                                    |

### 1.8 Path suggest dropdown

| Selector                               | Legacy state                                               | Modern change                                                                                                      |
| -------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `.path-suggest-dropdown`               | `background: var(--surface-2)`                             | `background: color-mix(in srgb, var(--surface-2) 75%, transparent)` + `backdrop-filter: blur(24px) saturate(180%)` |
| `.path-suggest-dropdown` border-radius | `var(--radius-md)`                                         | `var(--radius-lg)`                                                                                                 |
| `.path-suggest-dropdown` padding       | `4px`                                                      | `var(--space-1)`                                                                                                   |
| `.path-suggest-dropdown` box-shadow    | `0 12px 30px rgba(0,0,0,0.5)`                              | `var(--shadow-lg)`                                                                                                 |
| PathSuggest width logic                | `Math.min(Math.max(rect.width, 280), 520)` — clamped width | exact `rect.width` match to input                                                                                  |

Note: The width change is in `PathSuggest.tsx` logic (the `MAX_DROPDOWN_WIDTH` constant was removed). This is CSS-adjacent: the legacy mode can restore clamped width via a `min-width` / `max-width` on `.path-suggest-dropdown` in `legacy.css`, but only if the JSX sets a legacy-mode class on the dropdown. Alternatively, task #8 can restore the old JS width calculation conditionally.

### 1.9 Edit/Preview segmented control (`.mode-toggle`)

| Selector           | Legacy state                                                                                                      | Modern change                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `.mode-toggle`     | `display: flex`; `border: 1px solid var(--border)`; `border-radius: var(--radius-md)`; `padding: 2px`; `gap: 2px` | `display: inline-flex`; no border; `border-radius: var(--radius-pill)`; `padding: var(--space-1)`; `gap: var(--space-1)`          |
| `.mode-btn`        | `font-size: var(--font-size-xs)`; `padding: 3px 10px`; `border-radius: var(--radius-md)`; no transition           | `font-size: var(--font-size-sm)`; `padding: var(--space-1) var(--space-3)`; `border-radius: var(--radius-pill)`; transition added |
| `.mode-btn.active` | `background: var(--surface-3)`                                                                                    | `background: var(--surface-3)`; `box-shadow: var(--shadow-sm)`                                                                    |

### 1.10 CodeMirror editor

| Selector                                                 | Legacy state                           | Modern change                                                       |
| -------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------- |
| `.cm-host .cm-content`                                   | `font-family: var(--font-family-sans)` | `font-family: var(--font-family-mono)`                              |
| `.cm-host.cm-host-code .cm-content`                      | _(absent)_                             | `font-size: 13px`                                                   |
| `.cm-host.cm-host-prose .cm-content`                     | _(absent)_                             | `font-family: var(--font-family-sans)`                              |
| `.cm-host .cm-content` other                             | no `color` or `caret-color` set        | `color: var(--text-primary)`; `caret-color: var(--accent)`          |
| `.cm-host .cm-activeLine, .cm-host .cm-activeLineGutter` | `background: transparent`              | `background: var(--bg-hover)`                                       |
| `.cm-host .cm-selectionBackground`                       | _(absent, uses browser default)_       | `background: var(--accent-bg) !important`                           |
| `.cm-host ::selection`                                   | _(browser default)_                    | `background-color: transparent !important` (kills native selection) |
| `.cm-host .cm-cursor`                                    | browser default                        | `border-left: 2px solid var(--accent) !important`                   |
| `.cm-host .cm-activeLineGutter`                          | no opacity override                    | `color: var(--text-secondary)`; `opacity: 1`                        |
| `.cm-host .cm-lineNumbers`                               | no `font-weight`                       | `font-weight: var(--font-weight-regular)`                           |
| `.cm-host.cm-host-code .cm-lineNumbers`                  | _(absent)_                             | `font-size: 13px`                                                   |
| `.cm-host.cm-host-prose .cm-lineNumbers`                 | _(absent)_                             | `font-family: var(--font-family-sans)`                              |
| `.cm-host .cm-gutterElement`                             | no `opacity`                           | `opacity: 0.7`                                                      |
| `.cm-host .cm-gutters`                                   | `padding-top: 24px`                    | padding-top removed                                                 |

### 1.11 Properties panel

| Selector                                              | Legacy state                                                                                                                    | Modern change                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `.prop-row`                                           | `gap: 10px`; `padding: 5px 6px`; `min-height: 28px`                                                                             | `gap: var(--space-2)`; `padding: var(--space-2) var(--space-3)`; `min-height: 32px`                                                        |
| `.prop-bool`                                          | `gap: 8px`                                                                                                                      | `gap: var(--space-2)`                                                                                                                      |
| `.prop-bool-box`                                      | `border-radius: 3px`                                                                                                            | `border-radius: var(--radius-sm)`                                                                                                          |
| `.prop-pills`                                         | `gap: 4px`                                                                                                                      | `gap: var(--space-1)`                                                                                                                      |
| `.prop-pill`                                          | `gap: 2px`; `background: var(--surface-3)`; `color: var(--text-primary)`; `padding: 2px 8px`; `border: 1px solid var(--border)` | `gap: var(--space-0)`; uses `--pill-bg/text/border` tokens; `padding: var(--space-0) var(--space-2)`                                       |
| `.prop-pill-tag`                                      | `background: rgba(196,105,31,0.12)`; `border-color: rgba(196,105,31,0.35)`; `color: #e6a06b`                                    | uses `--pill-tag-*` tokens                                                                                                                 |
| `.prop-pill-hash`                                     | `color: var(--accent)`; `font-weight: 600`                                                                                      | `color: inherit`; `font-weight: var(--font-weight-semibold)`                                                                               |
| `.prop-row .prop-remove`                              | `right: 6px; top: 4px`                                                                                                          | `right: var(--space-2); top: var(--space-1)`                                                                                               |
| `.prop-display`                                       | `border-radius: 3px`                                                                                                            | `border-radius: var(--radius-sm)`                                                                                                          |
| `.prop-edit`                                          | `padding: 3px 8px`                                                                                                              | `padding: var(--space-1) var(--space-2)`                                                                                                   |
| `button.prop-bool`                                    | `gap: 8px`                                                                                                                      | `gap: var(--space-2)`                                                                                                                      |
| `.prop-pill` (second block)                           | `gap: 4px`                                                                                                                      | `gap: var(--space-1)`                                                                                                                      |
| `.prop-pill-remove`                                   | `border-radius: 50%`; `margin-left: 2px`                                                                                        | `border-radius: var(--radius-pill)`; `margin-left: var(--space-0)`                                                                         |
| `.props-add`                                          | `margin-top: 6px`; `font-size: 12px`; `padding: 4px 6px`; plain text "+"                                                        | `margin-top: var(--space-1)`; `font-size: var(--font-size-sm)`; `padding: var(--space-1) var(--space-2)`; `display: inline-flex` with Icon |
| `.props-add-row`                                      | `gap: 6px`; `margin-top: 6px`; `padding: 6px`                                                                                   | `gap: var(--space-2)`; `margin-top: var(--space-1)`; `padding: var(--space-2)`                                                             |
| `.prop-type-select` (replaced by `.prop-type-picker`) | native `<select>` element                                                                                                       | custom button `<.prop-type-picker>` with ContextMenu                                                                                       |
| `.props-add-btn`                                      | `font-size: 12px`; `padding: 4px 10px`                                                                                          | `font-size: var(--font-size-sm)`; `padding: var(--space-1) var(--space-3)`                                                                 |

### 1.12 Topbar icon button (class removed)

The `.topbar-icon-btn` and `.topbar-icon-btn:hover/.active` rules were deleted because the topbar was removed. These must be restored in `legacy.css` to style the re-introduced gear/settings button.

---

## Section 2 — Requires component logic

These changes altered JSX structure or component composition. They cannot be reverted with CSS alone. Each will need a `visualStyle === 'legacy'` branch in the relevant component (task #8).

### 2.1 TopBar component removed

`src/components/TopBar.tsx` was deleted entirely. In Modern the topbar no longer renders.

**Legacy requirement:** Conditionally render `<TopBar>` when `visualStyle === 'legacy'`. The original component rendered: macOS traffic light spacer, a centered search trigger (⌘P), and a right-side group with the gear Settings button and `<LayoutToggle>`.

**Impact:** Also requires restoring all `.topbar*` CSS classes in `legacy.css` and removing the duplicate search/settings entry points added in the sidebar and `SettingsModal`.

### 2.2 Sidebar search moved into sidebar header

In Modern, the search trigger (⌘P) was moved from the topbar into a new `<div className="sidebar-search">` block above the sidebar header.

**Legacy requirement:** Suppress the `.sidebar-search` block when `visualStyle === 'legacy'` (search lives in the topbar in legacy mode).

### 2.3 Sidebar header restructured

The old `<span className="vault-name">` was replaced with a multi-element `<div className="sidebar-project-info">` containing project name, a git-branch chip (`<Icon name="git-branch">`), and a hardcoded `"main"` branch label.

**Legacy requirement:** Render the simple `<span className="vault-name">{vaultName}</span>` in legacy mode; suppress `.sidebar-project-info` / `.sidebar-branch-name` subtree.

### 2.4 Sidebar footer restructured

Old footer: single `<button className="text-btn">Switch vault</button>`.
Modern footer: two `<button className="sidebar-footer-btn">` elements (Switch Folder + Settings).

**Legacy requirement:** Render the old single "Switch vault" button (and settings was accessed via topbar gear). The settings button in the sidebar footer should be suppressed in legacy mode (settings is reached via the topbar gear icon instead).

### 2.5 Back/forward navigation buttons removed from Editor

`Editor.tsx` had `canBack`, `canForward`, `onBack`, `onForward` props and rendered two `<button className="nav-btn">` elements. These were removed entirely in Modern.

**Legacy requirement:** Restore the props and conditionally render the two nav buttons in the editor header left side when `visualStyle === 'legacy'`.

### 2.6 Editor CodeMirror className changes

The `<CodeMirror>` component now receives `className={`cm-host ${isMd ? 'cm-host-prose' : 'cm-host-code'}`}` (used for per-mode font switching). The `theme` prop changed from a resolved CodeMirror theme object to `"none"`.

**Legacy requirement (partial CSS):** Most of the font/size changes are CSS-revertible (Section 1.10). The `cm-host-prose/cm-host-code` classes are new and simply won't exist in legacy DOM — meaning the per-mode CSS rules in Section 1.10 will not apply. No JSX change needed beyond restoring the old `className="cm-host"` and the original `theme` prop, which task #8 should handle.

### 2.7 HighlightStyle changes in Editor.tsx

Heading styles changed from a single `t.heading` rule to per-level `t.heading1/2/3+` with explicit font sizes (`1.428em`, `1.143em`). `t.strong`, `t.emphasis` gained explicit colors. New `t.meta` rule added.

**Legacy requirement:** Restore the old single `t.heading` rule and remove per-level size rules when in legacy mode. This is JavaScript-level configuration (CodeMirror `HighlightStyle.define`), not CSS — requires a conditional in `Editor.tsx`.

### 2.8 Properties type picker: `<select>` replaced by `<button>` + ContextMenu

The `<select className="prop-type-select">` in `AddPropertyRow` was replaced by a `<button className="prop-type-picker">` that opens a `<ContextMenu>` with codicon icons.

**Legacy requirement:** Restore the `<select>` element when `visualStyle === 'legacy'`. The `.prop-type-select` CSS class must be present in `legacy.css`. The new `.prop-type-picker` CSS is a Modern-only addition.

### 2.9 PathSuggest width clamping removed

`MAX_DROPDOWN_WIDTH = 520` constant was removed; dropdown now matches exact input width.

**Legacy requirement:** Restore the clamped-width logic (`Math.min(Math.max(rect.width, 280), 520)`) when `visualStyle === 'legacy'`. This is JavaScript logic in `PathSuggest.tsx`.

### 2.10 SettingsModal props changed

`SettingsModal` now receives `layoutMode` and `onLayoutChange` props (to render the panel arrangement control in Settings). The component interface changed.

**Legacy requirement:** The layout control in SettingsModal can remain in both modes (it's a functional addition, not a visual regression). No legacy-specific JSX needed here unless the design specifies otherwise.

### 2.11 macOS vibrancy + transparent window (electron/main.ts)

`transparent: true`, `frame: false` (macOS), `vibrancy: 'fullscreen-ui'`, and `backgroundColor: '#00000000'` were added to the BrowserWindow options.

**Legacy requirement:** Cannot be toggled at runtime via CSS; it requires a BrowserWindow restart or a native IPC call. **This is out of scope for the runtime toggle.** Legacy CSS can compensate visually by giving `.shell` an opaque background, but true OS-level vibrancy cannot be reverted without restarting the window. Recommend documenting this limitation.

---

## Summary table

| #   | Area                                                            | CSS-revertible                                             | Needs JSX                              |
| --- | --------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------- |
| 1   | Dark mode surface/border/text tokens                            | Yes                                                        | No                                     |
| 2   | New design tokens (`--space-0`, `--pill-*`, `--accent-claude*`) | Yes (override with old values or unset)                    | No                                     |
| 3   | Shell padding + rounded corners + vibrancy background           | Yes (opacity/bg)                                           | No (vibrancy itself is Electron-level) |
| 4   | Topbar removed                                                  | No — topbar must be re-rendered                            | Yes (task #8)                          |
| 5   | Sidebar search moved                                            | No — DOM position changed                                  | Yes (task #8)                          |
| 6   | Sidebar header (vault-name → project-info + branch chip)        | No — structure changed                                     | Yes (task #8)                          |
| 7   | Sidebar footer (single btn → two btns)                          | No                                                         | Yes (task #8)                          |
| 8   | Splitter: 1px line → var(--space-3) gap                         | Yes                                                        | No                                     |
| 9   | Tab bar: flat strip → pill tabs                                 | Yes                                                        | No                                     |
| 10  | Active tab: underline indicator → accent-bg fill                | Yes                                                        | No                                     |
| 11  | Tab-close visibility (always vs. active-only)                   | Yes                                                        | No                                     |
| 12  | Editor back/forward buttons removed                             | No                                                         | Yes (task #8)                          |
| 13  | Editor cm-host-code/prose classes + mono font                   | Partially — can override font in CSS; class names need JSX | Yes for className (task #8)            |
| 14  | HighlightStyle per-heading font sizes                           | No — CodeMirror JS config                                  | Yes (task #8)                          |
| 15  | Edit/Preview toggle: border-radius pill shape                   | Yes                                                        | No                                     |
| 16  | Path suggest: backdrop-filter + shadow-lg + radius-lg           | Yes                                                        | No                                     |
| 17  | PathSuggest width clamping                                      | No — JS logic                                              | Yes (task #8)                          |
| 18  | Properties panel spacing tokenization                           | Yes                                                        | No                                     |
| 19  | prop-pill colors → pill tokens                                  | Yes                                                        | No                                     |
| 20  | prop-type-select → prop-type-picker (ContextMenu)               | No — element type changed                                  | Yes (task #8)                          |
| 21  | Claude pane border-radius + surface-1                           | Yes                                                        | No                                     |
| 22  | Agent tabs: strip → pill tabs + brand accent                    | Yes                                                        | No                                     |
| 23  | macOS vibrancy (Electron window)                                | No — Electron-level, runtime-irreversible                  | N/A (document limitation)              |
