import { useState } from 'react'
import { Icon } from '../Icon'

type Props = {
  text: string
  /** Snapshot turn id, used as the argument to onRewind. */
  turnId?: string
  /**
   * Click handler for the Rewind icon — opens SnapshotPanel pre-selected to
   * this turn. Disabled when no turnId is known yet (turn still in-flight).
   */
  onRewind?: (turnId: string) => void
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
export function UserBubble({ text, turnId, onRewind }: Props) {
  const overflows = lineCount(text) > COLLAPSE_THRESHOLD_LINES
  const [expanded, setExpanded] = useState(false)
  const showToggle = overflows
  const collapsed = overflows && !expanded
  const canRewind = !!onRewind && !!turnId

  const handleRewind = () => {
    if (canRewind && turnId) onRewind!(turnId)
  }

  return (
    <div className="chat-bubble-user">
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
