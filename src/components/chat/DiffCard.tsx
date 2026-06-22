import { memo, useEffect, useRef, useState } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { MergeView } from '@codemirror/merge'

type Props = {
  /**
   * When true, the MergeView is not mounted (or is unmounted) — keeps the
   * timeline cheap until the user explicitly expands the inline diff.
   */
  collapsed?: boolean
  /** Snapshot content (pre-edit). Empty string is rendered as empty. */
  oldText: string
  /** New content the agent wrote / proposes. */
  newText: string
  /** Display label for the file (basename); shown above the merge view. */
  fileName?: string
  /** Optional handler when the user chooses to open the diff in the editor. */
  onOpenInEditor?: () => void
}

const COMPACT_HEIGHT = '200px'
const FULL_HEIGHT = '480px'

/**
 * Inline diff for the EditCard. Wraps CodeMirror's MergeView, mounted
 * lazily — the heavy editor is constructed only when `collapsed === false`
 * and destroyed cleanly when the parent collapses it again.
 *
 * The container is scrollable up to `COMPACT_HEIGHT` by default; the "Show
 * full diff" button expands to `FULL_HEIGHT` or, if `onOpenInEditor` is
 * provided, delegates to the parent to open the file in the main editor.
 */
function DiffCardImpl({ collapsed = false, oldText, newText, fileName, onOpenInEditor }: Props) {
  if (collapsed) return null

  return (
    <DiffCardMounted
      oldText={oldText}
      newText={newText}
      fileName={fileName}
      onOpenInEditor={onOpenInEditor}
    />
  )
}

type MountedProps = Omit<Props, 'collapsed'>

function DiffCardMounted({ oldText, newText, fileName, onOpenInEditor }: MountedProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<MergeView | null>(null)
  const [fullHeight, setFullHeight] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const extensions: Extension[] = [
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      EditorView.lineWrapping,
    ]

    const view = new MergeView({
      a: { doc: oldText, extensions },
      b: { doc: newText, extensions },
      parent: host,
      collapseUnchanged: { margin: 2, minSize: 4 },
      highlightChanges: true,
      gutter: true,
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [oldText, newText])

  return (
    <div
      className="chat-diff-card"
      role="region"
      aria-label={fileName ? `Diff for ${fileName}` : 'Diff preview'}
    >
      <div
        ref={hostRef}
        className="chat-diff-card-view"
        style={{ maxHeight: fullHeight ? FULL_HEIGHT : COMPACT_HEIGHT }}
      />
      <div className="chat-diff-card-actions">
        {onOpenInEditor ? (
          <button type="button" className="chat-tool-expand" onClick={onOpenInEditor}>
            Open in editor
          </button>
        ) : (
          <button
            type="button"
            className="chat-tool-expand"
            onClick={() => setFullHeight((v) => !v)}
            aria-expanded={fullHeight}
          >
            {fullHeight ? 'Collapse' : 'Show full diff'}
          </button>
        )}
      </div>
    </div>
  )
}

export const DiffCard = memo(DiffCardImpl)
