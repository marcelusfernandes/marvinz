/**
 * Focus-routed Cmd+Z chain (U4 #150 → V2 #456).
 *
 * Mirrors VSCode's priority chain: the global keydown handler asks which
 * surface owns focus, then resolves the keystroke into an UndoRoute:
 *   - 'editor'    → CodeMirror (Source) or ProseMirror (Page) handles undo
 *                   natively. Do not intercept; let the surface keymap run.
 *   - 'editable'  → a plain input/textarea/select/contentEditable control owns
 *                   its own native undo (inline rename field, path input, find
 *                   bars, chat textarea, …). Do not intercept.
 *   - 'file-tree' → run the file-ops undo stack (U3).
 *   - 'neutral'   → nothing specific is focused; fall back to the active
 *                   editor's text undo so Cmd+Z is never a dead key.
 *
 * Editor wins over file-tree when both ancestors are present, and editable is
 * checked only after editor so the ProseMirror/CodeMirror contentEditable
 * surfaces are classified as 'editor', not 'editable'.
 */
export type PanelContext = 'editor' | 'editable' | 'file-tree' | 'neutral'

export function getActivePanelContext(): PanelContext {
  const el = document.activeElement
  if (!el) return 'neutral'
  // CodeMirror (Source) and ProseMirror/Milkdown (Page) are both real editor
  // surfaces — their own keymaps own undo/redo.
  if (el.closest('.cm-editor') || el.closest('.ProseMirror')) return 'editor'
  // Any other editable control keeps its native text undo. Checked after the
  // editor surfaces above (which are also contentEditable). Without this the
  // inline rename field would route Cmd+Z to the file-ops undo and revert an
  // unrelated previous op instead of undoing the typed filename.
  // `isContentEditable` honours inherited editability but needs layout (absent
  // under jsdom), so also match the attribute directly for testability.
  if (
    el.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]') ||
    (el instanceof HTMLElement && el.isContentEditable)
  ) {
    return 'editable'
  }
  if (el.closest('[data-panel="file-tree"]')) return 'file-tree'
  return 'neutral'
}

/**
 * What the global handler should dispatch for a Cmd/Ctrl+Z keystroke:
 *   - { target: 'file-tree' }                       → run the file-ops undo.
 *   - { target: 'fallback-editor', direction }      → focus the active editor
 *                                                     and undo/redo its text.
 *   - null                                          → let the key pass through.
 */
export type UndoRoute =
  | { target: 'file-tree' }
  | { target: 'fallback-editor'; direction: 'undo' | 'redo' }
  | null

/**
 * Decide what a Cmd/Ctrl+Z keystroke should undo, given the focused surface.
 * Pure so it can be unit-tested without the App tree (mirrors
 * resolveAppFindShortcut).
 *
 * - editor focus    → null (the surface keymap owns undo/redo natively).
 * - editable focus  → null (the control's native undo owns it).
 * - file-tree focus → 'file-tree' on Cmd+Z (no Shift); null on Cmd+Shift+Z
 *                     (file-op redo is deferred to the engine, #454).
 * - neutral focus   → 'fallback-editor' (undo, or redo with Shift) when an
 *                     editable note is active; null when there is nothing to
 *                     fall back to.
 */
export function resolveUndoTarget(
  e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey'>,
  context: PanelContext,
  hasEditableActiveTab: boolean
): UndoRoute {
  const isCmd = e.metaKey || e.ctrlKey
  if (!isCmd) return null
  if (e.key !== 'z' && e.key !== 'Z') return null
  if (context === 'editor') return null
  if (context === 'editable') return null
  if (context === 'file-tree') return e.shiftKey ? null : { target: 'file-tree' }
  // neutral
  if (hasEditableActiveTab) {
    return { target: 'fallback-editor', direction: e.shiftKey ? 'redo' : 'undo' }
  }
  return null
}
