import { useCallback, useEffect, useState } from 'react'
import type { Command } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'
import { ITEMS, commandFor, isItemActive, titleFor } from '../lib/markdownFormatCommands'
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
 * its internal state changes. This returns a `repaint` callback and also keeps
 * the bar in sync with the caret.
 *
 * BOTH triggers are needed. `selectionchange` covers the user moving the caret,
 * but it cannot cover our own clicks: `onMouseDown` calls `preventDefault`, so
 * the DOM selection never moves on a button press and the event may not fire at
 * all — and the debounce would land after the user stopped looking anyway.
 */
function useRepaint(view: EditorView | null): () => void {
  const [, setTick] = useState(0)
  const repaint = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    if (!view) return
    let timer: number | null = null
    const onSelectionChange = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        repaint()
      }, SELECTION_DEBOUNCE_MS)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
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
      if (!view || !command) return
      command(view.state, view.dispatch, view)
      // Put the caret back in the document so typing continues where the user
      // left off instead of staying on the button.
      view.focus()
      repaint()
    },
    [view, repaint]
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

        return (
          <button
            key={item.id}
            type="button"
            data-testid={`md-toolbar-btn-${item.id}`}
            className={`md-toolbar__btn${active ? ' is-on' : ''}`}
            title={titleFor(item)}
            aria-label={titleFor(item)}
            aria-pressed={active}
            disabled={!enabled}
            // Without this, mousedown blurs the EditorView and collapses the
            // selection BEFORE onClick runs, so the command lands on an empty
            // cursor. Has to be per-button: focus events do not delegate.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (item.kind === 'link' && !active) {
                setLinkDialogOpen(true)
                return
              }
              run(command)
            }}
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
