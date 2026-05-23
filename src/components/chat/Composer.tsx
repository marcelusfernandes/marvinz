import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '../Icon'
import { useChatStore } from '../../lib/chat/store'
import type { SessionId } from '../../lib/chat/types'

type Props = {
  sessionId: SessionId
  onSend: (text: string) => void | Promise<void>
  onCancel?: () => void | Promise<void>
  /** When true, switch the send button into stop (e.g., during a stream). */
  isStreaming?: boolean
  disabled?: boolean
}

/**
 * Base composer (Sprint 2): textarea + send button + mic placeholder. Mode
 * pill, @-mention picker and slash menu ship in Sprint 5.
 *
 * Keyboard: Enter sends, Shift+Enter inserts newline (per design doc TBD-1).
 */
export function Composer({
  sessionId,
  onSend,
  onCancel,
  isStreaming = false,
  disabled = false,
}: Props) {
  const draft = useChatStore((s) => s.sessions[sessionId]?.composer.draft ?? '')
  const setDraft = useChatStore((s) => s.setComposerDraft)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [composing, setComposing] = useState(false)

  // Auto-grow textarea: clamp to a max of ~200px (design spec).
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [draft])

  const submit = useCallback(() => {
    const text = draft.trim()
    if (!text || disabled) return
    setDraft(sessionId, '')
    Promise.resolve(onSend(text)).catch(() => {
      // Restore the draft so the user doesn't lose their text on transport failure.
      setDraft(sessionId, text)
    })
  }, [draft, disabled, onSend, sessionId, setDraft])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !composing) {
        e.preventDefault()
        submit()
      }
    },
    [composing, submit],
  )

  const empty = draft.trim().length === 0
  const sendDisabled = disabled || (empty && !isStreaming)

  return (
    <div className={`chat-composer${disabled ? ' disabled' : ''}`}>
      <div className="chat-composer-input-row">
        <textarea
          ref={textareaRef}
          className="chat-composer-textarea"
          placeholder="Ask Marvin..."
          value={draft}
          onChange={(e) => setDraft(sessionId, e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          disabled={disabled}
          rows={1}
        />
        <button
          type="button"
          className="chat-composer-mic"
          aria-label="Dictate"
          title="Dictate (coming soon)"
          disabled
        >
          <Icon name="mic" size={14} />
        </button>
      </div>
      <div className="chat-composer-toolbar">
        <div className="left">
          <button
            type="button"
            className="icon-btn"
            aria-label="Attach"
            title="Attach (coming soon)"
            disabled
          >
            <Icon name="add" size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Slash commands"
            title="Slash commands (coming soon)"
            disabled
          >
            <Icon name="circle-slash" size={14} />
          </button>
        </div>
        <div className="right">
          <button
            type="button"
            className="chat-composer-send"
            aria-label={isStreaming ? 'Stop' : 'Send'}
            title={isStreaming ? 'Stop' : 'Send'}
            disabled={sendDisabled}
            onClick={isStreaming ? () => onCancel?.() : submit}
            data-state={isStreaming ? 'stop' : empty ? 'idle' : 'ready'}
          >
            <Icon name={isStreaming ? 'debug-stop' : 'arrow-up'} size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
