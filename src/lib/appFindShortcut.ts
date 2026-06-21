/**
 * Window-level Cmd+F / Cmd+Alt+F predicate.
 *
 * Returns the find-bar variant that should open ('find' or 'replace'),
 * or `null` when the event must not be intercepted. The caller is
 * responsible for `event.preventDefault()` and for actually toggling
 * the bar (typically via a tick prop on the active <Editor>).
 *
 * Lives in its own module so the lightweight predicate can be unit
 * tested without rendering the full App tree.
 */
export type FindShortcutContext = {
  /** True when a modal/dialog/palette is open. The shortcut must defer
   * to whatever has focus inside the modal. */
  modalOpen: boolean
  /** Path of the active markdown editor tab, or null when the active
   * tab is not a markdown note (browser, image, PDF, no tab, etc.). */
  activeMarkdownPath: string | null
}

export function resolveAppFindShortcut(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'target'>,
  ctx: FindShortcutContext
): 'find' | 'replace' | null {
  const isCmd = event.metaKey || event.ctrlKey
  if (!isCmd) return null
  if (event.shiftKey) return null
  if (event.key !== 'f' && event.key !== 'F') return null
  if (ctx.modalOpen) return null
  if (!ctx.activeMarkdownPath) return null
  // Defer to the in-editor keymaps (CM searchKeymap / PM keymap) when the
  // keystroke originated inside the editor surface. The `.editor` root
  // class wraps both the header and body of the active editor.
  const target = event.target as Element | null
  if (target?.closest?.('.editor')) return null
  return event.altKey ? 'replace' : 'find'
}
