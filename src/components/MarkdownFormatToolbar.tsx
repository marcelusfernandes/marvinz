import { useCallback, useEffect, useState } from 'react'
import type { Command } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'
import {
  ITEMS,
  commandFor,
  isItemActive,
  isToggleKind,
  titleFor,
  type ToolbarButton,
} from '../lib/markdownFormatCommands'
import { InputDialog } from './InputDialog'

/**
 * Formatting bar for Rendered mode (#636).
 *
 * Drives the ProseMirror view that Editor.tsx already holds in `pmView`
 * (published by LiveMarkdown's `onViewReady`), so LiveMarkdown itself is not
 * involved. Dispatching PM commands against `pmView` is the same pattern
 * `editorHandle` uses for undo/redo in Editor.tsx.
 *
 * Command semantics live in `../lib/markdownFormatCommands`.
 */

// Matches the debounce the selection chip uses in LiveMarkdown, for the same
// reason: keeps the bar steady while dragging a selection.
const SELECTION_DEBOUNCE_MS = 50

/**
 * The EditorView is a stable object reference, so React never re-renders when
 * its internal state changes. This returns a `repaint` callback and subscribes
 * to the three ways the active format can change out from under us. All three
 * are needed; each covers a case the others miss.
 *
 *  1. `selectionchange` — the caret moving, and any command that mutates the
 *     document. Verified in Chromium: a `setBlockType` from Mod-Alt-2 does fire
 *     it, because PM replaces the block element and restores the selection into
 *     the new one. Note the dispatch is async — it can land a tick later.
 *
 *  2. `keydown` on the editor element — a collapsed-caret `toggleMark` (Mod-b,
 *     Mod-i, Mod-e, Mod-Alt-x with nothing selected) writes ONLY
 *     `state.storedMarks`: no document change, no DOM mutation, no selection
 *     movement, therefore no `selectionchange` at all. Measured: zero events at
 *     0ms, 100ms and 300ms. Without this the user presses Mod-b to stop bolding
 *     and the button stays lit. Registered after the view exists, so it runs
 *     after ProseMirror's own handler and observes post-command state.
 *
 *  3. The returned `repaint`, called by the toolbar's own click handler —
 *     `onMouseDown` calls `preventDefault`, so a button press moves nothing and
 *     emits no event, and the debounce would land after the user looked away.
 *
 * Polling a fingerprint of [from, to, storedMarks] instead of (2) looks
 * equivalent and is not: turning a mark OFF replaces `null` with `[]`, which
 * serialises identically, so the un-bold case is silently missed.
 */
function useRepaint(view: EditorView | null): () => void {
  const [, setTick] = useState(0)
  const repaint = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    if (!view) return
    let timer: number | null = null
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        repaint()
      }, SELECTION_DEBOUNCE_MS)
    }
    const editorDom = view.dom
    // `selectionchange` is document-wide: a selection made in the chat panel
    // or sidebar says nothing about the editor, so skip the repaint unless the
    // editor owns the focus.
    const onSelectionChange = () => {
      if (view.hasFocus()) schedule()
    }
    document.addEventListener('selectionchange', onSelectionChange)
    editorDom.addEventListener('keydown', schedule)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      editorDom.removeEventListener('keydown', schedule)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [view, repaint])

  return repaint
}

type Props = {
  /** Live ProseMirror view, or null while the editor is still mounting. */
  view: EditorView | null
}

export function MarkdownFormatToolbar({ view }: Props) {
  const repaint = useRepaint(view)
  // Adding a link is the one action a single click cannot finish — it needs a
  // URL. Opens when the user adds; never when removing.
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const state = view?.state ?? null

  const run = useCallback(
    (command: Command | null) => {
      // After an external-change accept, LiveMarkdown remounts and briefly
      // republishes the OLD, destroyed view before the new one exists;
      // dispatching into it throws from a null docView.
      if (!view || view.isDestroyed || !command) return
      command(view.state, view.dispatch, view)
      // Put the caret back in the document so typing continues where the user
      // left off instead of staying on the button.
      view.focus()
      repaint()
    },
    [view, repaint]
  )

  /**
   * Resolve the command from the LIVE state, not from whatever the last render
   * captured. The repaint is debounced 50ms, so a keyboard shortcut followed by
   * a fast click was dispatching the pre-flip command — turning a just-created
   * H2 into another H2 instead of back into a paragraph.
   */
  const runItem = useCallback(
    (item: ToolbarButton) => {
      if (!view) return
      const liveActive = isItemActive(view.state, item)
      if (item.kind === 'link' && !liveActive) {
        setLinkDialogOpen(true)
        return
      }
      run(commandFor(view.state, item, liveActive))
    },
    [view, run]
  )

  const applyLink = useCallback(
    (href: string) => {
      setLinkDialogOpen(false)
      if (!view) return
      const linkItem = ITEMS.find((item) => item.kind === 'link')
      if (!linkItem) return
      run(commandFor(view.state, linkItem, false, { href }))
    },
    [view, run]
  )

  return (
    <div className="md-toolbar" role="toolbar" aria-label="Formatting">
      {ITEMS.map((item) => {
        if (item.kind === 'separator') {
          return <span key={item.id} className="md-toolbar__sep" aria-hidden="true" />
        }

        const active = state ? isItemActive(state, item) : false
        const command = state ? commandFor(state, item, active) : null
        // Running the command without a dispatch is ProseMirror's own
        // "would this apply?" check — surface it as a disabled button rather
        // than a click that silently does nothing.
        const enabled = Boolean(view && state && command && command(state))
        // Never both pressed and disabled: `.is-on` and `:disabled` have equal
        // CSS specificity, so that combination shipped an accent-washed grey
        // button, and it is contradictory for screen readers besides. The
        // highlight only ever means "clicking un-applies this".
        const pressed = active && enabled

        return (
          <button
            key={item.id}
            type="button"
            data-testid={`md-toolbar-btn-${item.id}`}
            className={`md-toolbar__btn${pressed ? ' is-on' : ''}`}
            title={titleFor(item)}
            aria-label={titleFor(item)}
            // Insertions have no pressed state; a permanent aria-pressed="false"
            // would announce them as toggles they are not.
            aria-pressed={isToggleKind(item) ? pressed : undefined}
            disabled={!enabled}
            // Without this, mousedown blurs the EditorView and collapses the
            // selection BEFORE onClick runs, so the command lands on an empty
            // cursor. Has to be per-button: focus events do not delegate.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runItem(item)}
          >
            {item.label}
          </button>
        )
      })}

      {linkDialogOpen && (
        <div data-testid="md-toolbar-link-dialog">
          <InputDialog
            title="Link URL"
            placeholder="https://example.com"
            submitLabel="Add link"
            onSubmit={applyLink}
            onCancel={() => setLinkDialogOpen(false)}
          />
        </div>
      )}
    </div>
  )
}
