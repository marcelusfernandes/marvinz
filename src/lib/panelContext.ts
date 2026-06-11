/**
 * Focus detector for Cmd+Z routing (U4, issue #150).
 *
 * Reports which panel currently owns keyboard focus so the global keydown
 * handler can route Cmd+Z to the right place:
 *   - 'editor'    → CodeMirror handles undo natively (do not intercept).
 *   - 'file-tree' → trigger the file-ops undo stack (U3).
 *   - 'other'     → no-op in V1.
 *
 * Editor wins over file-tree when both ancestors are present (an editor can
 * never be a *child* of the tree in practice, but the precedence is explicit).
 */
export type PanelContext = 'editor' | 'file-tree' | 'other'

export function getActivePanelContext(): PanelContext {
  const el = document.activeElement
  if (!el) return 'other'
  if (el.closest('.cm-editor')) return 'editor'
  // A focused plain text input/textarea owns its own undo. The inline
  // rename/create field lives *inside* the file tree, so without this guard
  // Cmd+Z while typing a filename would route to the file-ops undo stack and
  // revert an unrelated previous op instead of undoing the typed text.
  if (el.matches('input, textarea')) return 'other'
  if (el.closest('[data-panel="file-tree"]')) return 'file-tree'
  return 'other'
}

/**
 * Decide what a Cmd/Ctrl+Z keystroke should undo, given the focused panel.
 * Pure so it can be unit-tested without the App tree (mirrors
 * resolveAppFindShortcut). Returns the target the global handler should act
 * on, or null to let the key pass through untouched.
 *
 * - editor focus → null (CodeMirror's keymap owns undo/redo natively).
 * - file-tree focus + Cmd+Z (no Shift) → 'file-tree' (run the file-ops undo).
 * - anything else (Cmd+Shift+Z, 'other' panel, non-Z) → null (no-op in V1).
 */
export function resolveUndoTarget(
  e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey'>,
  context: PanelContext,
): 'file-tree' | null {
  const isCmd = e.metaKey || e.ctrlKey
  if (!isCmd) return null
  if (e.key !== 'z' && e.key !== 'Z') return null
  if (context === 'editor') return null
  if (!e.shiftKey && context === 'file-tree') return 'file-tree'
  return null
}
