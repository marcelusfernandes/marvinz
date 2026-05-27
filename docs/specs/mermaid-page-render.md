# PRD: Render Mermaid Diagrams in Page Mode

**Issue**: [#353](https://github.com/marcelusfernandes/marvinz/issues/353)  
**Owner**: gustavo-pm (Product), react (Engineering), lipe-ui (Design)  
**Status**: Awaiting approval  
**Date**: 2026-05-27

---

## 1. User Story & Problem Statement

**As a** user managing architecture diagrams, flowcharts, or decision trees in Marvinz,  
**I want** mermaid code fences to render as actual diagrams in Page mode,  
**So that** I can read and review visual content without switching to a separate tool or manually rendering diagrams.

### The Gap

Today in Marvinz:
- **Page mode** (Milkdown WYSIWYG) shows ` ```mermaid` blocks as raw syntax text, identical to code blocks.
- **Source mode** correctly preserves the raw mermaid syntax for editing.
- Users cannot see diagram previews until they export or use an external renderer.

Competing editors (**Obsidian**, **Typora**, **Notion**) render mermaid diagrams inline within their WYSIWYG editors, making diagram-heavy documents readable on-screen.

### Impact

- Users with diagram-heavy workflows (architecture docs, process flows, decision matrices) currently need external tools to preview their work, breaking the note-taking flow in Marvinz.
- Adoption barrier for teams using flowcharts as first-class content in knowledge bases.

---

## 2. User Journey

1. User opens a note with a mermaid diagram in Page mode.
2. Instead of seeing `~~~mermaid ... ~~~`, they see the rendered diagram (flowchart, sequence, state chart, etc.).
3. User can edit the mermaid source in Source mode; switching back to Page mode re-renders the diagram.
4. Diagram scales responsively, respects light/dark theme, and fails gracefully if syntax is invalid.
5. User can still use wikilinks, images, @-mentions, and find/replace in the same document.

---

## 3. Acceptance Criteria

### Core Rendering
- [ ] Valid `~~~mermaid ... ~~~` code blocks render as diagrams in Page mode only.
- [ ] Source mode preserves raw mermaid text unchanged (no visual editor or inline code generation).
- [ ] Editing mermaid source in Source mode triggers diagram re-render when switching back to Page mode.
- [ ] Diagrams are responsive and scale within the editor container.

### Content Integrity
- [ ] Markdown round-trips correctly: save → reload → Page mode shows diagram, Source mode shows raw mermaid.
- [ ] Existing wikilinks, images, @-mention triggers, and find/replace continue to work alongside diagrams.
- [ ] Drag-drop attachments (files, images, internal links) work in documents containing diagrams.

### Visual Consistency
- [ ] Diagrams respect the current theme (light/dark mode) at render time.
- [ ] Diagram colors and fonts integrate visually with Marvinz's design tokens.
- [ ] No layout shift when diagram renders.
- [ ] When theme toggles (light ↔ dark), re-render diagrams with new theme immediately (MutationObserver on data-theme).

### Error Handling & Graceful Degradation
- [ ] Invalid mermaid syntax shows a friendly error message (e.g., "Diagram rendering failed") instead of crashing.
- [ ] Syntax errors include a hint to check mermaid syntax documentation.
- [ ] Empty ` ```mermaid ``` ` blocks render as empty container without error.
- [ ] Very large/complex diagrams render without hanging the editor (performance threshold to be determined by engineering).

### Testing & Quality
- [ ] Unit tests cover valid diagram types (flowchart, sequence, state, class, er, pie, gantt).
- [ ] Unit tests cover error cases (invalid syntax, empty blocks, malformed JSON in diagram config).
- [ ] Integration tests verify markdown serialization (save → load → content match).
- [ ] Regression tests confirm image rendering, @-mentions, find/replace, and drag-drop are unaffected.
- [ ] Test coverage ≥ 80%.

---

## 4. Why This Matters

### User Value
- **Completes the editing experience**: Marvinz already handles wikilinks, images, and code blocks well. Adding diagram rendering removes the last friction point for visual content workflows.
- **Reduces tool-switching**: Users can view and edit diagrams without leaving Marvinz.
- **Competitive parity**: Obsidian and Typora are ahead here; closing the gap improves market positioning.

### Business Impact
- **Unlock use cases**: Teams using diagram-heavy processes (architecture, compliance, product workflows) can standardize on Marvinz instead of splitting between markdown editor and diagramming tools.
- **Differentiation**: A fully embedded, theme-aware diagram editor signals completeness and polish.

### Technical Validation
- **Low-risk integration**: Mermaid is widely adopted (npm). We implement a minimal custom `code_block` NodeView (same pattern as imageNodeView) — zero schema mutation, guaranteed round-trip serialization.
- **Scoped scope**: Render-only; no visual editing, no exports, no custom diagram languages.

---

## 5. Scope Boundaries

### In Scope
- Rendering mermaid diagrams in Page mode via a custom `code_block` NodeView.
- Light/dark theme support (mermaid natively supports theme switching via `mermaid.initialize()`).
- Friendly error messages for invalid syntax (no crashes).
- Markdown round-trip integrity — code_block node unchanged, guaranteed lossless serialization.
- Lazy-loaded mermaid library (via dynamic import, avoiding bundle bloat on startup).

### Out of Scope
- **Visual diagram editing** (e.g., drag nodes, edit connections in-canvas).
- **Separate preview pane** (diagrams render inline in Page mode only).
- **Diagram export** (PNG, SVG — handled by mermaid if needed later).
- **Alternative diagram syntaxes** (PlantUML, Graphviz, etc.).
- **Custom theme colors** beyond what mermaid's built-in theme picker provides.

---

## 6. Risk Assessment & Regression Prevention

### Risk Matrix

| Risk | Severity | Mitigation | Owner |
|------|----------|-----------|-------|
| **Plugin compatibility** | HIGH → **RESOLVED** | Custom code_block NodeView (no external plugin). Avoids @milkdown/plugin-diagram@7.7.0 unmaintained status + instance-dup risk (similar to plugin-history bug). See Technical Findings. | react |
| **Bundle size: mermaid weight** | **HIGH → MANAGED** | Mermaid is large (~500KB–1MB depending on version; bundles d3, dagre, cytoscape). **MITIGATION**: Lazy-load via dynamic `import()` only when first diagram is encountered. Notes without diagrams pay zero cost. Acceptance criterion: confirm lazy-load is implemented. | react |
| **Find/replace limitation** | MEDIUM | Diagram source hidden behind rendered SVG in Page mode (not searchable visually). **Known limitation, not regression** — source text is in the model but obscured by rendering. Users search in Source mode. Acceptable for render-only scope; document in release notes. | react |
| **Theme toggle while open** | LOW → **RESOLVED** | Implement live re-theming via MutationObserver on data-theme. When theme toggles, re-render all mermaid blocks with new theme immediately. Low-cost feature, fully aligned with v1 scope. | lipe-ui + react |
| **Performance: mermaid render** | MEDIUM | `mermaid.render()` is async + CPU-heavy (dagre/d3 layout can take 100s of ms to seconds on large graphs). May jank editor during render. **MITIGATIONS**: (a) render async + show placeholder; (b) debounce re-render during editing; (c) cache by source hash; (d) try/catch + friendly error (never crash). | react |
| **Markdown serialization** | MEDIUM | Code_block node structure unchanged → guaranteed lossless round-trip. Comprehensive save/load tests in task #6. | react |

### Existing Page-Mode Capabilities at Risk

The following features are active in LiveMarkdown and must remain unaffected:

1. **Image rendering** (`src/lib/imageNodeView.ts`): Custom node view for vault-aware image resolution. Risk: NodeView collision if mermaid and image nodes overlap. **Mitigation**: Mermaid uses a separate `code_block` node — no collision. No schema change.

2. **@-mention trigger** (`src/lib/pmMentionTrigger.ts`): Overlay picker for wikilinks. Risk: Mermaid NodeView may interfere with keystroke handling. **Mitigation**: Custom NodeView registers no keystroke handlers; keystrokes pass through to normal code_block editing. Keystroke handling unaffected.

3. **Find/Replace** (`prosemirror-search`): Built into the editor via keymap. Risk: Diagram source in Page mode is not searchable. **Mitigation**: This is a known limitation, not a regression — users edit source text in Source mode, which is searchable. Acceptable for render-only scope.

4. **Drag-drop attachments** (`src/lib/dropAttachments.ts`): File and internal link drop handler. Risk: Mermaid NodeView may consume drag events. **Mitigation**: Custom NodeView registers no drop handlers and falls through to normal code_block drop behavior. Drop events propagate normally. No event consumption.

5. **Markdown serialization** (`src/lib/wikilinks.ts`): Bi-directional wikilink parsing (e.g., `[[X]]` ↔ `wikilink:X`). Risk: Mermaid blocks may mutate during round-trip. **Mitigation**: Code_block node structure unchanged — serialized by untouched commonmark serializer. Guaranteed lossless.

6. **Undo/Redo** (`prosemirror-history`): Document history tracking. Risk: Mermaid node insert/delete may not integrate with transaction history. **Mitigation**: Atom node insert/delete is normal ProseMirror behavior — no special transaction metadata needed. No risk.

### Technical Findings (Task #2 — Complete)

**Decision: Custom Code-Block NodeView**

We implement a **minimal custom `code_block` NodeView** targeting `language === "mermaid"` (same pattern as `imageNodeView`). This approach:
- **Zero schema mutation**: Code_block node structure unchanged — the fence is serialized by the untouched commonmark serializer, byte-stable and lossless. The NodeView changes only RENDERING (how the diagram appears), never the model. This guarantees round-trip integrity: save → reload preserves the exact ` ```mermaid ... ``` ` syntax.
- **No plugin risks**: Avoids `@milkdown/plugin-diagram@7.7.0` (frozen, unmaintained since Milkdown 7.8.0, hard-pins `@milkdown/utils@7.7.0` + `@milkdown/exception@7.7.0` with instance-dup risk — similar to plugin-history bug at LiveMarkdown.tsx:411-413).
- **Smallest blast radius**: Pure render-view logic, fully aligned with repo's "surgical changes" rule.
- **Render**: When lang === "mermaid", call `mermaid.render()` into the node-view DOM; otherwise fall through to default code rendering. User can edit the mermaid source in Source mode or via click-to-edit affordance in Page mode (UX detail, task #5).

**Plugin Stability Analysis**
- @milkdown/plugin-diagram@7.7.0 is the last published version; it was dropped from the Milkdown monorepo while core/preset/utils advanced to 7.21.x. We'd run plugin@7.7.0 against editor@7.20.0 — growing version gap.
- Plugin hard-pins @milkdown/utils@7.7.0 + @milkdown/exception@7.7.0 as DIRECT dependencies → duplicate Milkdown instance risk. This repo already experienced this class of bug: @milkdown/plugin-history broke the SchemaReady timer (see LiveMarkdown.tsx:411-413) and had to be dropped in favor of raw prosemirror-history.
- Plugin ships NO render view itself — only schema + remark + input rule + command. We'd write the render view either way.
- **Conclusion**: Low confidence in the official plugin. Custom NodeView is the recommended PRIMARY path.

**Implementation Details**
- **Lazy-load mermaid**: Import via dynamic `import()` only when the first ```mermaid fence is encountered in a note. Mermaid's gzipped runtime is ~500KB (bundles d3, dagre, cytoscape). **Lazy-loading is critical**: this 500KB is deferred from app startup; only notes with diagrams load it, on demand. Notes without any mermaid blocks pay zero cost.
  - **Acceptance criterion**: Confirm lazy-load via dynamic import is implemented (task #5).
- **Dark theme support**: Wire `mermaid.initialize({ theme: ... })` to Marvinz's existing `data-theme='dark'` attribute. Implement MutationObserver on `document.documentElement` watching `data-theme` changes; re-call `mermaid.render()` on theme toggle.
  - Mermaid does NOT read CSS variables; theme must be set at initialize() and bakes into the rendered SVG.
  - **Live re-theming**: When user toggles theme, diagrams re-render immediately with new colors (v1 feature, not a limitation).
- **Async rendering**: `mermaid.render()` is async and CPU-heavy (layout via dagre/d3 can take 100s of ms to seconds on large graphs). Runs on main thread → can jank editor during render.
  - **Acceptance criteria for task #5**: (a) render async + show placeholder; (b) debounce re-render during editing; (c) cache by source hash; (d) try/catch error + friendly message (never crash).
- **Error handling**: Catch `mermaid.render()` errors and show friendly inline message. Mermaid injects its own error SVG on parse failure — suppress it to control our own error UI. Empty blocks are valid (render as empty container).
- **Source editing**: Mermaid source is edited in Source mode (always available). Page mode is render-only in v1 — no inline/click-to-edit affordance in the NodeView. Inline source editing in Page mode is a future enhancement (separate scope addition; would require lipe-ui affordance spec + implementation).

**Bundle Impact**
- **mermaid** (~500KB gzipped): Non-negotiable for diagram rendering. **Lazy-loaded on-demand** — NOT added to initial app startup. Only loads when first ```mermaid fence is encountered. Notes without diagrams pay zero cost.
- **Custom view code**: ~5KB (node-view + CSS).
- **No external plugin**: ~0KB (avoids plugin-diagram@7.7.0 overhead).

**Known Limitations & Trade-offs**
1. **Find/Replace in Page mode**: Diagram source is hidden behind the rendered SVG in Page mode, so `prosemirror-search` (Cmd+F) won't visually locate matches within diagrams. Source text IS in the document model (not removed), so users can find/edit it by switching to Source mode. Acceptable for render-only scope; document in release notes.
2. **Theme toggle while open**: If user toggles light/dark theme while editing, live re-rendering via MutationObserver on data-theme is the v1 approach (per §8.2 spec). Already-rendered diagrams will re-theme immediately when data-theme changes. If MutationObserver is deferred to v1.1, document as known limitation (re-render on note reload). Decision: v1 ships with live re-theme (recommendation: low-cost feature).

---

## 7. Edge Cases & Error Handling

### Valid Edge Cases

1. **Empty mermaid block**  
   ```markdown
   ```mermaid
   ```
   ```
   Renders as empty container without error.

2. **Unsupported mermaid type**  
   ```markdown
   ```mermaid
   unsupportedDiagramType:
   ```
   ```
   Shows error banner: "Unsupported diagram type. Mermaid supports: flowchart, sequence, state, class, er, pie, gantt, etc."

3. **Invalid syntax**  
   ```markdown
   ```mermaid
   flowchart LR
     A --> B
     C ]] D (missing quote)
   ```
   ```
   Shows error banner: "Diagram syntax error: Expected closing bracket. [Link to mermaid docs]"

4. **Very large/complex diagram** (e.g., 100+ nodes, 500+ connections)  
   Renders without hanging the editor. If rendering is slow, the diagram paints after completion — no spinner or timeout warning in v1. Optimization (loading states, render timeouts) can be added later if needed.

5. **Theme toggle while editing** (light ↔ dark)  
   Diagram re-renders with new theme colors immediately via MutationObserver on data-theme (no flicker, no manual reload needed).

### Invalid Edge Cases (Not Handled)

- Interactive diagram editing (out of scope).
- Diagram export or printing (handled separately if needed).
- Custom mermaid config per document (use default mermaid theme).

---

## 8. Visual Direction

### 8.1 Diagram Container

The mermaid NodeView renders a block-level `div.mermaid-diagram`. The container:

- **Background**: `var(--surface-2)` — one step below the editor surface (`--surface-1`) to give the diagram a subtle inset-card feel without competing with text content.
- **Border**: `1px solid var(--border)` — default divider weight, not `--border-subtle` (which would disappear on `--surface-2`).
- **Border radius**: `var(--radius-lg)` (12px) — matches card-level affordances (modals, popovers). Panel-level `--radius-xl` (16px) would be too large for inline block content.
- **Padding**: `var(--space-5)` (24px) on all sides — generous enough for diagram labels not to clip against the edge, but tighter than layout-panel spacing.
- **Margin**: `var(--space-4)` (16px) top and bottom relative to prose — keeps it breathing room from surrounding paragraphs.
- **Max-width**: `100%` of the editor column. No explicit `max-width` cap — diagrams are often wide and constraining them hides content.
- **Centering**: `margin-left: auto; margin-right: auto` — diagrams center within the editor prose column.
- **Shadow**: `var(--shadow-sm)` in light mode — very light lift off `--bg-app`. No shadow in dark mode (shadows are already heavier in `[data-theme='dark']` via token override and add unnecessary noise on dark surfaces).

CSS summary for the implementer:

```css
.mermaid-diagram {
  display: block;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  margin-top: var(--space-4);
  margin-bottom: var(--space-4);
  box-shadow: var(--shadow-sm);
  overflow-x: auto; /* see §9.4 */
  max-width: 100%;
}
```

**DOM structure** (confirmed with react — NodeView uses same pattern as `imageNodeView.ts:38-40`):

```
div.mermaid-diagram           <- NodeView root (ProseMirror-owned)
  div.mermaid-diagram__canvas <- inner container; SVG rendered here
    svg ...                   <- produced by mermaid.render()
```

Style `.mermaid-diagram` for block layout and card treatment. Style `.mermaid-diagram__canvas` for the SVG host:

```css
.mermaid-diagram__canvas {
  display: flex;
  justify-content: center;
}

.mermaid-diagram__canvas svg {
  max-width: 100%;
  height: auto;
}
```

---

### 8.2 Light vs Dark Theme

Mermaid themes at `mermaid.initialize({ theme, themeVariables })` time — it does not read CSS custom properties. The engineer reads `data-theme` on `<html>` (set by `src/lib/colorTheme.ts`) and passes the appropriate config.

**v1 recommendation: use mermaid `'base'` theme in both modes with `themeVariables` overrides mapped to Marvinz token computed values.** This gives palette-matched diagrams without mermaid's default color scheme clashing with the brand.

`themeVariables` mapping for the engineer:

| mermaid variable | Light (token) | Dark (token) |
|---|---|---|
| `background` | `#f4f4f5` (`--surface-2`) | `#262626` (`--surface-2`) |
| `mainBkg` | `#ffffff` (`--surface-1`) | `#1f1f1f` (`--surface-1`) |
| `nodeBorder` | `#e8e8ea` (`--border`) | `#2e2e2e` (`--border`) |
| `lineColor` | `#656565` (`--text-secondary`) | `#aeaeb2` (`--text-secondary`) |
| `textColor` | `#2c2c2b` (`--text-primary`) | `#f2f2f7` (`--text-primary`) |
| `primaryColor` | `#f4f4f5` (`--surface-2`) | `#262626` (`--surface-2`) |
| `primaryBorderColor` | `#e8e8ea` (`--border`) | `#2e2e2e` (`--border`) |
| `primaryTextColor` | `#2c2c2b` (`--text-primary`) | `#f2f2f7` (`--text-primary`) |
| `edgeLabelBackground` | `#ffffff` (`--surface-1`) | `#1f1f1f` (`--surface-1`) |
| `clusterBkg` | `#efeff1` (`--surface-3`) | `#2e2e2e` (`--surface-3`) |

Node fills follow surface tokens, not `--accent` — diagrams are content, not brand assets. Result: flowchart boxes look like cards in the current theme.

**Implementation note**: `themeVariables` accepts resolved color strings, not `var(--token)` references (mermaid renders its SVG outside our CSS cascade). The engineer reads computed values via `getComputedStyle(document.documentElement).getPropertyValue('--surface-2')` at `mermaid.initialize()` time — this means future token value changes are picked up automatically without touching the NodeView code.

**Theme switching**: Re-render on `data-theme` change. Use a `MutationObserver` on `document.documentElement`, then re-call `mermaid.render()` with the matching themeVariables object. SVG color bakes in at render — the swap happens on re-render, no animation required.

---

### 8.3 Syntax Error State

When mermaid throws a parse error, the NodeView replaces the diagram SVG with an inline error banner. The error state must read as a calm informational message — not a crash, not an alert box.

**Structure**:
```
┌──────────────────────────────────────────────────┐
│  Diagram syntax error                             │
│  <error message from mermaid>                     │
└──────────────────────────────────────────────────┘
```

**Styling**:
- **Container**: same `.mermaid-diagram` wrapper (no change in border-radius or padding). The border color switches to `var(--border-error)` to signal problem state — a single CSS class swap (`.mermaid-diagram--error`).
- **Background**: `var(--bg-error-subtle)` — very faint error wash (`rgba(192, 57, 43, 0.08)` in light, `rgba(224, 123, 110, 0.08)` in dark). Visible but not alarming.
- **Label**: "Diagram syntax error" — `var(--font-size-sm)` (12px), `var(--font-weight-semibold)`, `var(--text-error)`.
- **Detail text**: the raw mermaid error message truncated to 200 chars — `var(--font-size-sm)`, `var(--font-weight-regular)`, `var(--text-secondary)`. Monospace font (`var(--font-family-mono)`) for parse errors (they contain token names, line numbers).
- **No icon**: consistent with Marvinz's text-first approach (no icon sprinkle in chat banners either). If the team has an established error icon, it can be added, but the label text carries the meaning.

Error element DOM (confirmed with react — engineer renders `.mermaid-diagram__error` inside `.mermaid-diagram__canvas`):

```
div.mermaid-diagram.mermaid-diagram--error
  div.mermaid-diagram__canvas
    div.mermaid-diagram__error
      span.mermaid-diagram__error-label   "Diagram syntax error"
      span.mermaid-diagram__error-detail  <truncated mermaid error string>
```

CSS:

```css
.mermaid-diagram--error {
  border-color: var(--border-error);
  background: var(--bg-error-subtle);
}

.mermaid-diagram__error {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.mermaid-diagram__error-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-error);
}

.mermaid-diagram__error-detail {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-regular);
  color: var(--text-secondary);
  font-family: var(--font-family-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

Empty blocks (`~~~mermaid\n~~~`) are treated as valid with no error. The container renders empty — consistent padding, default border — as if the diagram content simply hasn't been added yet.

---

### 8.5 Loading State

React confirmed that lazy-importing mermaid means the first diagram in a session has a brief render gap before the SVG appears. The `.mermaid-diagram--loading` modifier covers this.

**Appearance**: a low-contrast skeleton pulse — same container geometry, border stays default (no color change), background animates between `--surface-2` and `--surface-3` in a horizontal shimmer. No spinner icon; the shimmer signals "in progress" without implying an action the user must wait for.

**Minimum height**: `80px` — prevents the container collapsing to zero while loading, which would cause a layout jump when the SVG renders.

```css
.mermaid-diagram--loading .mermaid-diagram__canvas {
  min-height: 80px;
  background: linear-gradient(
    90deg,
    var(--surface-2) 25%,
    var(--surface-3) 50%,
    var(--surface-2) 75%
  );
  background-size: 200% 100%;
  animation: mermaid-shimmer var(--duration-slow) ease-in-out infinite;
  border-radius: var(--radius-md);
}

@keyframes mermaid-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

The `--loading` class is removed and `__canvas.innerHTML` is replaced with the SVG in a single synchronous DOM operation — the browser never paints an empty canvas between states. However, if the rendered SVG is shorter than 80px, the canvas height will snap down in that same tick. To smooth this, add a height transition on `__canvas`:

```css
.mermaid-diagram__canvas {
  transition: min-height var(--duration-fast) var(--ease-out);
}
```

This is optional — correctness is unaffected either way. If a layout animation feels distracting in the editor context, omit it.

---

### 8.4 Overflow for Wide Diagrams

Sequence diagrams and large flowcharts routinely exceed the editor column width (typically 680–720px in Marvinz's prose column).

**v1 behavior: horizontal scroll on the container.**

- `.mermaid-diagram` gets `overflow-x: auto` (already in the CSS above).
- The SVG inside is allowed to be its natural width — mermaid sets `width` and `height` on the SVG element.
- The container scrolls horizontally without disturbing the surrounding prose layout.
- Scroll bar uses the app's themed scrollbar (`--radius-sm` thumb, `--border` track — consistent with the rest of Marvinz).

**Why scroll over scale**: scaling (CSS `transform: scale()` or `viewBox` manipulation) shrinks text inside the diagram to illegibility for wide charts. Scroll is predictable, accessible (keyboard-scrollable inside the container), and preserves label readability.

**Note for the engineer**: set `width="100%"` on the SVG if mermaid does not do so by default — this allows narrow diagrams to stretch to fill the container width while wide ones overflow and scroll. Some mermaid diagram types (`pie`, `gantt`) set fixed widths; leaving `overflow-x: auto` handles both cases.

**Very tall diagrams** (rare, e.g., large state machines in TD layout): no max-height clamp in v1. Clamping would hide diagram content with no clear affordance. If this becomes a complaint, a future iteration can add `max-height: 600px; overflow-y: auto` with a visible "show more" indicator.

---

## 9. Blockers & Unblocking Sequence

| Item | Owner | Status | Notes |
|------|-------|--------|-------|
| **Design direction** (task #3) | lipe-ui | ✅ Complete | Visual spec (§8) finalized; ready for implementation. |
| **Founder approval** | team-lead | ⏳ Gate | PRD + visual direction + regression plan → founder sign-off required before task #5 starts. |
| **Regression test plan** (task #4) | qa | 🔄 In progress | Unblocks after founder gate; finalizes test cases for task #6. |
| **Implementation** (task #5) | react | ⏳ Pending | Starts after founder approval. Custom code_block NodeView + mermaid lazy-load. |
| **Tests** (task #6) | qa | ⏳ Pending | Starts after task #5; covers render, error, round-trip, and regression (image, @-mention, find/replace, etc.). |

---

## 10. Approval Gate

**This PRD requires founder approval before implementation begins.**

Sign-off checklist:
- [ ] Founder reviews risk assessment and regression plan.
- [ ] Founder approves visual direction (from lipe-ui).
- [ ] PM confirms scope boundaries are acceptable.
- [ ] Engineering confirms feasibility (from react).
- [ ] QA signs off on regression test approach (from qa).

---

## Appendix: Mermaid Diagram Types Supported

Mermaid supports:
- **Flowchart / Graph** (LR, TD, BT, RL, RAD layouts)
- **Sequence Diagram** (actors, interactions, alt/else/par blocks)
- **State Diagram** (states, transitions)
- **Class Diagram** (entities, relationships)
- **ER Diagram** (entities, attributes, cardinality)
- **Pie Chart**
- **Gantt Chart**
- **Git Graph**
- **Requirement Diagram**

All diagram types are render-only in this implementation (no visual editing, no exports).
