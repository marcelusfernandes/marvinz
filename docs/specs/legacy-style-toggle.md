# Legacy visual style toggle — product requirements

Goal: Enable users to switch between Modern (post-redesign) and Legacy (pre-redesign) visual styles via a Settings control, allowing existing users to stay on the familiar look while new users default to the redesigned experience.

## 1. User story

**New users (fresh installs):**

- Launch the app for the first time
- See the Modern visual style (redesigned shell, sidebar, tabs, editor, properties panel)
- Can switch to Legacy via Settings if they prefer the familiar pre-redesign look

**Existing users (upgrading from pre-redesign):**

- Launch the upgraded app
- Default to Modern style (recommended)
- See a one-time hint in Settings suggesting the Modern design
- Can immediately switch to Legacy if the new look is unsettling; toggle persists across restarts
- Can switch back to Modern anytime after review

**Justification for Modern default on upgrade:**
The redesign represents a deliberate visual refresh with improved structure (3-card shell layout, rounded corners, macOS vibrancy) and refined typography. Defaulting new users and upgrading users to Modern establishes the intended brand direction and prevents the codebase from carrying two permanent visual tracks. The one-time hint and instant toggle provide a soft landing for users who need it.

## 2. Acceptance criteria

- [ ] Fresh install defaults to Modern style
- [ ] Upgrading user defaults to Modern style
- [ ] Settings modal includes a "Visual style" segmented control with "Modern" and "Legacy" options
- [ ] Toggling between Modern and Legacy in Settings live-updates the UI without page reload
- [ ] Style preference persists across application restarts
- [ ] All 4 combinations of color theme (light/dark/system) × visual style (modern/legacy) render without layout breaks or missing styles
- [ ] Switching during an active editing session (note open) preserves buffer and scroll position
- [ ] Tooltip, help text, and UX copy are clear that "Modern" is the recommended style
- [ ] Settings store validates `visualStyle` as either `'modern'` or `'legacy'`; undefined or invalid values fall back to `'modern'`

## 3. Edge cases & behavior

### 3.1 First run UX for upgrading users

**Scenario:** User has been on the app pre-redesign, upgrades, and boots the app.

**Behavior:**

- App reads `visualStyle` from settings storage
- If setting is absent (upgrade case), app defaults to `'modern'`
- Settings modal shows a subtle hint: "Modern style is the redesigned look. Switch to Legacy to keep the previous design."
- User can toggle anytime without any warning or friction
- No migration timer or forced transition date

### 3.2 Structural JSX changes CSS cannot revert

**Scenario:** The redesign removed the back/forward buttons from the editor toolbar and moved the search into the sidebar. CSS overrides alone cannot restore these.

**Behavior:**

- Identify all structural changes from the redesign that require JSX conditions (not CSS)
- Use `visualStyle` setting to conditionally render components or skip their rendering
- Example: `{visualStyle === 'legacy' && <BackForwardButtons />}`
- Document these cases in task #8 for implementation

### 3.3 Mid-render style switch

**Scenario:** User opens Settings, toggles the style, and closes Settings while a note is being rendered.

**Behavior:**

- Setting change triggers a global subscription update to all subscribers (including App.tsx and component tree)
- Components that read `visualStyle` via hooks re-render
- CSS tokens update via `data-style` attribute on the document root
- No page reload required; smooth visual transition

### 3.4 Missing style-dependent settings in one mode

**Scenario:** A hypothetical setting exists only in Modern mode (e.g., "Editor minimap") but not in Legacy.

**Behavior:**

- Settings modal omits the control when in Legacy mode (if the setting is Modern-only)
- Or: Control is always visible, but toggling it while in Legacy mode is a no-op (setting is ignored by Legacy CSS/JSX)
- For this project, no such collision is expected in the initial release, but future work should establish the pattern

## 4. Out of scope

- **No A/B telemetry:** We are not measuring user preference or cohort retention across styles. (Future work may add analytics.)
- **No per-window style setting:** The style is app-wide; all windows see the same choice.
- **No per-file style override:** Users cannot choose a style per note or vault.
- **No migration timer or forced deprecation:** We are not scheduling an end-of-life date for Legacy style.
- **No animation between style switches:** Style changes are instant (no fade/dissolve effect).
- **No undo/redo of style changes:** Toggling is immediate and final until the next toggle.

## 5. Affected surfaces

Based on the redesign branch (`feat/redesign-shell-sidebar`), the following surfaces must render correctly in both Modern and Legacy styles:

### 5.1 Shell & layout

- **App wrapper:** Roundedness, padding, shadows (3-card layout in Modern; flat/simple in Legacy)
- **Sidebar:** Styling, border, background (no avatar in Modern; search moved into header in Modern)
- **Editor pane:** Styling, border, spacing
- **Claude pane (agents panel):** Styling, border, spacing
- **Splitter bars:** Visibility, color, hover state

### 5.2 Sidebar

- **Header section:** Project name display, git branch chip styling, spacing
- **Search input:** Position (sidebar header in Modern; legacy position in Legacy), styling
- **File tree:** Icons, hover states, selection highlight, nesting indents, fonts
- **Footer buttons:** Styling, hover states, icon size

### 5.3 Tabs & tab bar

- **Tab styling:** Font weight (medium in Modern; legacy in Legacy), active text color (neutral in Modern; legacy in Legacy), borders, background
- **Tab bar:** Spacing, background, border
- **New tab button & close button:** Styling, hit target

### 5.4 Editor

- **Markdown editor:** Font (mono at 13px for code in Modern; legacy in Legacy), heading styles, list styling
- **Code block syntax highlighting:** Color tokens (may differ between light/dark only; style toggle should not affect)
- **Edit/Preview toggle:** Position (segmented in Modern; inline in Legacy), styling
- **Back/forward buttons:** Presence (removed in Modern; present in Legacy)

### 5.5 Properties panel

- **Type picker (ContextMenu):** Styling, Codicon vs. legacy icon rendering
- **Spacing inside type picker:** Using `--space-0` in Modern; legacy spacing in Legacy

### 5.6 Path suggest dropdown

- **Backdrop blur:** Enabled in Modern; disabled in Legacy
- **Shadow:** `--shadow-lg` in Modern; lighter shadow in Legacy
- **Width:** Exact-width match to input in Modern; legacy behavior in Legacy
- **Text rendering:** Highlighted match syntax

### 5.7 Color theme

- **Dark mode tokens:** Tuned to Apple HIG in Modern; legacy palette in Legacy
- **Light mode tokens:** Unchanged between Modern and Legacy (same base palette)
- **System theme detection:** Works the same in both styles

## 6. Technical approach

### 6.1 Settings layer

- Add `visualStyle: 'modern' | 'legacy'` to `Settings` type in `src/types.ts`
- Extend `src/lib/settingsStore.ts` to read/write `visualStyle` from localStorage and IPC
- Default to `'modern'` if missing or invalid

### 6.2 Attribute-driven styling

- Wire `visualStyle` setting to a `data-style="modern"|"legacy"` attribute on the document root (`<html>`)
- All CSS overrides keyed to `html[data-style='legacy'] .component-class { ... }`
- Modern styles are the default `:root` and baseline; Legacy styles are the overrides

### 6.3 JSX conditionals

- Components that need structural changes (e.g., back/forward buttons) read `visualStyle` via a custom hook `useVisualStyle()`
- Conditionally render or omit JSX based on style
- Example: `{visualStyle === 'legacy' && <BackForwardButtons />}`

### 6.4 Settings UI

- Add a new section in `SettingsModal` under Appearance (after Color theme):
  - Label: "Visual style"
  - Hint: "Modern is the redesigned look. Legacy is the previous design."
  - Options: "Modern" (recommended), "Legacy"
  - Segmented control (consistent with other settings)

## 7. Success criteria

- Users can toggle between Modern and Legacy in Settings without a reload
- Preference persists across restarts
- All UI surfaces render cleanly in both styles
- No console errors or warnings when switching styles
- E2E smoke tests pass for all 4 color theme × visual style combinations
- Performance is unaffected (no flash of unstyled content, no layout thrashing)

---

## Addendum — CSS override strategy

**Decision: single `src/styles/legacy.css` file (option a)**

All `[data-style='legacy']` overrides will live in one dedicated file rather than inline blocks scattered alongside modern rules in `App.css`.

**Rationale:**

1. **Separability.** When legacy support is retired, the entire file is deleted in one commit. Inline blocks scattered through `App.css` require surgical diff-hunting to remove, with high risk of leaving orphaned rules.
2. **Legibility.** `App.css` stays clean and expresses the canonical Modern design. `legacy.css` is a clearly labelled exception layer — reviewers and future contributors know exactly where legacy overrides live.
3. **Cascade control.** The file is imported at the very end of `App.css` via `@import './styles/legacy.css'`. This places the override rules after all Modern declarations in source order. Because every legacy selector is prefixed with `[data-style='legacy']`, it carries one extra attribute selector worth of specificity over the equivalent unscoped Modern rule — so it wins on specificity alone, regardless of source order. The end-of-file import is belt-and-suspenders for any equal-specificity edge cases.

**Import placement:**

```css
/* Bottom of src/App.css */
@import './styles/legacy.css';
```

Every rule in `legacy.css` starts with `[data-style='legacy']`:

```css
[data-style='legacy'] .shell { ... }
[data-style='legacy'] .tab-bar { ... }
```

**Retirement path:** When the team decides to drop legacy support, delete `src/styles/legacy.css`, remove the `@import` from `App.css`, and strip all `visualStyle` branches from JSX. No other files need touching.
