import { useCallback, useMemo, useState, type RefObject } from 'react'
import type { EditorView } from '@codemirror/view'
import { EditorSelection, type Extension } from '@codemirror/state'
import { mentionTrigger } from '../lib/cmMentionTrigger'
import { mentionInsertText } from '../lib/mentionInsert'
import type { PaletteItem } from '../lib/paletteRanker'

type Mention = { from: number; query: string; anchor: { x: number; y: number } }

/**
 * `@`-mention trigger + picker state for the CodeMirror editor. Owns the
 * `mention` state, builds the `mentionTrigger` extension once per mount (so the
 * CodeMirror state is never torn down by an extension rebuild), and dispatches
 * the type-specific insert back through the passed `viewRef`. Extracted from
 * Editor.tsx (#590) with no behavior change.
 *
 * Not shared with LiveMarkdown: that surface uses `pmMentionTrigger` (a
 * ProseMirror plugin) with its own insert dispatch — genuinely different
 * mechanics, so no unification is forced here.
 */
export function useMentionPicker({
  filePath,
  viewRef,
}: {
  filePath: string
  viewRef: RefObject<EditorView | null>
}): {
  mention: Mention | null
  mentionExt: Extension
  handleMentionSelect: (item: PaletteItem) => void
  handleMentionDismiss: () => void
} {
  // `from` is the doc offset of the `@` sigil; `query` is the text typed after
  // it; `anchor` is the viewport coord the picker pins to. `null` while
  // inactive. The mentionTrigger extension owns the lifecycle.
  const [mention, setMention] = useState<Mention | null>(null)

  // Built once per mount. Callbacks are stable setState invocations, so the
  // extension never has to rebuild — that matters because rebuilding extensions
  // tears the CodeMirror state down.
  const mentionExt = useMemo(
    () =>
      mentionTrigger({
        onOpen: (from, anchor) => setMention({ from, query: '', anchor }),
        onUpdate: (query, anchor) =>
          setMention((prev) => (prev ? { ...prev, query, anchor } : prev)),
        onClose: () => setMention(null),
      }),
    []
  )

  // Replace the `@`+query span with the type-specific insert text (wikilink,
  // image embed, or markdown link). We use the current selection head as the
  // upper bound because the user may have typed beyond what onUpdate last
  // reported (CodeMirror state lags React state by one render tick).
  const handleMentionSelect = useCallback(
    (item: PaletteItem) => {
      const view = viewRef.current
      if (!view || !mention) {
        setMention(null)
        return
      }
      const to = view.state.selection.main.head
      const insert = mentionInsertText(item, filePath)
      view.dispatch({
        changes: { from: mention.from, to, insert },
        selection: EditorSelection.cursor(mention.from + insert.length),
      })
      setMention(null)
      view.focus()
    },
    [mention, filePath, viewRef]
  )
  const handleMentionDismiss = useCallback(() => setMention(null), [])

  return { mention, mentionExt, handleMentionSelect, handleMentionDismiss }
}
