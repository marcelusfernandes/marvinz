import { useState } from 'react'
import { Icon } from '../Icon'
import { useChatStore } from '../../lib/chat/store'
import type { MenuItemSpec } from '../../types'
import type { SessionId } from '../../lib/chat/types'

type Props = {
  text: string
  /** Snapshot turn id, used as the argument to onRewind. */
  turnId?: string
  /**
   * Click handler for the Rewind icon — opens SnapshotPanel pre-selected to
   * this turn. Disabled when no turnId is known yet (turn still in-flight).
   */
  onRewind?: (turnId: string) => void
  /** Session id, used by the context menu to dispatch composer/clipboard actions. */
  sessionId?: SessionId
}

const COLLAPSE_THRESHOLD_LINES = 5

function lineCount(text: string): number {
  let n = 1
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++
  }
  return n
}

/**
 * Full-width user bubble — the ONLY container in the chat (per
 * chat-design-v1.md §6.2 asymmetric pattern). Assistant content lives in
 * the timeline without any container.
 */
export function UserBubble({ text, turnId, onRewind, sessionId }: Props) {
  const overflows = lineCount(text) > COLLAPSE_THRESHOLD_LINES
  const [expanded, setExpanded] = useState(false)
  const showToggle = overflows
  const collapsed = overflows && !expanded
  const canRewind = !!onRewind && !!turnId

  const handleRewind = () => {
    if (canRewind && turnId) onRewind!(turnId)
  }

  const handleContextMenu = async (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const selection = window.getSelection()?.toString() ?? ''
    const hasSelection = selection.length > 0
    const items: MenuItemSpec[] = [
      {
        kind: 'item',
        id: 'copy',
        label: hasSelection ? 'Copy Selection' : 'Copy Message',
      },
      { kind: 'item', id: 'quote', label: 'Quote in Reply' },
      { kind: 'separator' },
      {
        kind: 'item',
        id: 'rewind',
        label: 'Rewind to Here',
        enabled: canRewind,
      },
    ]
    const action = await window.marvin.app.showContextMenu(items)
    if (!action) return
    const payload = hasSelection ? selection : text
    switch (action) {
      case 'copy':
        await window.marvin.editor.writeClipboard(payload)
        break
      case 'quote': {
        if (!sessionId) break
        const quoted = payload
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n')
        const store = useChatStore.getState()
        const current = store.sessions[sessionId]?.composer.draft ?? ''
        const next = current ? `${quoted}\n\n${current}` : `${quoted}\n\n`
        store.setComposerDraft(sessionId, next)
        break
      }
      case 'rewind':
        if (canRewind && turnId) onRewind!(turnId)
        break
    }
  }

  return (
    <div className="chat-bubble-user" onContextMenu={handleContextMenu}>
      <button
        type="button"
        className="chat-bubble-rewind"
        aria-label="Rewind to this message"
        onClick={handleRewind}
        disabled={!canRewind}
        title="Rewind to this message"
      >
        <Icon name="history" size={14} />
      </button>
      <div
        className={`chat-bubble-body${collapsed ? ' collapsed' : ''}`}
        style={
          collapsed
            ? {
                display: '-webkit-box',
                WebkitLineClamp: COLLAPSE_THRESHOLD_LINES,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }
            : undefined
        }
      >
        {text}
      </div>
      {showToggle && (
        <button
          type="button"
          className="chat-bubble-toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}
