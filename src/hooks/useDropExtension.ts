import { useEffect, useMemo, useRef } from 'react'
import { EditorView } from '@codemirror/view'
import { EditorSelection, type Extension } from '@codemirror/state'
import { clearInsertedFlashes, flashInserted } from '../lib/cmJustInsertedHighlight'
import {
  MARVIN_PATH_MIME,
  MARVIN_PATHS_MIME,
  collectFiles,
  emitSummaryToast,
  internalDragMarkdown,
  persistDroppedFiles,
  readDraggedPaths,
} from '../lib/dropAttachments'
import { marvin } from '../lib/marvinApi'
import type { ImportToastState } from '../components/ImportToast'

/**
 * CodeMirror drag/drop extension for the note editor: inserts internal vault
 * paths as markdown or persists external file drops, with a flash-highlight on
 * the inserted text. Extracted from Editor.tsx (#590) with no behavior change;
 * the memo deps match the original so the extension (and thus the CodeMirror
 * state) is never needlessly rebuilt.
 */
export function useDropExtension({
  vaultPath,
  filePath,
  onImportToast,
}: {
  vaultPath: string
  filePath: string
  onImportToast?: (toast: { state: ImportToastState; message: string }) => void
}): Extension {
  // Tracks the pending flash-clear timer so it can be cancelled before a fresh
  // drop reschedules it, and on unmount/file-swap so the delayed dispatch never
  // lands on a torn-down view (#594).
  const flashTimerRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current)
    },
    []
  )

  return useMemo(() => {
    const insertAt = (view: EditorView, event: DragEvent, text: string): void => {
      const pos =
        view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head
      const to = pos + text.length
      view.dispatch({
        changes: { from: pos, insert: text },
        selection: EditorSelection.cursor(to),
        effects: flashInserted.of([{ from: pos, to }]),
      })
      // One-shot entrance animation; clear the decoration once it's done so
      // subsequent drops re-trigger the animation cleanly.
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current)
      flashTimerRef.current = window.setTimeout(() => {
        flashTimerRef.current = null
        view.dispatch({ effects: clearInsertedFlashes.of(null) })
      }, 500)
    }

    const handleInternalDrop = (view: EditorView, event: DragEvent, paths: string[]): void => {
      // Multi-drag: produce one markdown line per path and insert them all in
      // a single dispatch so undo reverts the whole drop atomically.
      const markdown = paths.map((p) => internalDragMarkdown(filePath, p)).join('\n')
      insertAt(view, event, markdown)
    }

    const handleExternalDrop = async (
      view: EditorView,
      event: DragEvent,
      files: File[]
    ): Promise<void> => {
      const outcome = await persistDroppedFiles({
        files,
        vaultPath,
        notePath: filePath,
        writeBinary: (p) => marvin.file.writeBinary(p),
        onToast: onImportToast,
      })
      if (outcome.inserts.length > 0) insertAt(view, event, outcome.inserts.join('\n'))
      emitSummaryToast(outcome, onImportToast)
    }

    return EditorView.domEventHandlers({
      dragover(event) {
        const types = event.dataTransfer?.types ?? []
        if (
          !types.includes('Files') &&
          !types.includes(MARVIN_PATH_MIME) &&
          !types.includes(MARVIN_PATHS_MIME)
        )
          return false
        event.preventDefault()
        // 'move' suppresses the macOS green-plus copy badge while staying
        // compatible with the file tree's effectAllowed.
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
        return true
      },
      drop(event, view) {
        const dt = event.dataTransfer
        if (!dt) return false
        const internalPaths = readDraggedPaths(dt)
        const files = collectFiles(dt)
        if (internalPaths.length > 0) {
          event.preventDefault()
          event.stopPropagation()
          handleInternalDrop(view, event, internalPaths)
          return true
        }
        if (files.length > 0) {
          event.preventDefault()
          event.stopPropagation()
          void handleExternalDrop(view, event, files)
          return true
        }
        return false
      },
    })
  }, [vaultPath, filePath, onImportToast])
}
