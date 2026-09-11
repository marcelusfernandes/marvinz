import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { Icon } from '../Icon'
import { useChatStore } from '../../lib/chat/store'
import type { PermissionMode, SessionId } from '../../lib/chat/types'
import { ModePill, MODE_OPTIONS } from './ModePill'
import { ModesPicker } from './ModesPicker'
import { MARVIN_PATH_MIME, MARVIN_PATHS_MIME, readDraggedPaths } from '../../lib/dropAttachments'
import { formatPathsForAgent } from '../../lib/agent-drop-format'
import { useAppContext } from '../../context/AppContext'

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
  const vaultPath = useAppContext().vaultPath ?? ''
  const draft = useChatStore((s) => s.sessions[sessionId]?.composer.draft ?? '')
  const permissionMode = useChatStore((s) => s.sessions[sessionId]?.permissionMode ?? 'default')
  const setDraft = useChatStore((s) => s.setComposerDraft)
  const setPermissionMode = useChatStore((s) => s.setPermissionMode)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const modePillRef = useRef<HTMLButtonElement>(null)
  const [composing, setComposing] = useState(false)
  const [modesOpen, setModesOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)

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

  const cyclePermissionMode = useCallback(() => {
    const ix = MODE_OPTIONS.findIndex((m) => m.value === permissionMode)
    const next = MODE_OPTIONS[(ix + 1) % MODE_OPTIONS.length]
    if (next) setPermissionMode(sessionId, next.value)
  }, [permissionMode, sessionId, setPermissionMode])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault()
        cyclePermissionMode()
        return
      }
      if (e.key === 'Enter' && !e.shiftKey && !composing) {
        e.preventDefault()
        submit()
      }
    },
    [composing, cyclePermissionMode, submit]
  )

  const handleSelectMode = useCallback(
    (mode: PermissionMode) => setPermissionMode(sessionId, mode),
    [sessionId, setPermissionMode]
  )

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    const types = e.dataTransfer.types
    if (!types.includes(MARVIN_PATH_MIME) && !types.includes(MARVIN_PATHS_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    // dragleave fires on every child-element transition (textarea, mode pill).
    // Only clear when the pointer actually leaves the composer.
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      const paths = readDraggedPaths(e.dataTransfer)
      setDragOver(false)
      if (paths.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      if (!vaultPath) return
      // Pass '' so the helper keeps paths absolute — Claude Code's cwd may
      // differ from the vault root, so a relative path could miss the file.
      const text = formatPathsForAgent(paths, 'claude-code', '') + ' '
      const textarea = textareaRef.current
      const start = textarea?.selectionStart ?? draft.length
      const end = textarea?.selectionEnd ?? draft.length
      const next = draft.slice(0, start) + text + draft.slice(end)
      setDraft(sessionId, next)
      // Restore focus and advance the caret after React commits the
      // controlled re-render — defer via rAF so the DOM reflects the new value.
      const caret = start + text.length
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(caret, caret)
      })
    },
    [draft, sessionId, setDraft, vaultPath]
  )

  const empty = draft.trim().length === 0
  const sendDisabled = disabled || (empty && !isStreaming)

  return (
    <div
      className={`chat-composer${disabled ? ' disabled' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div
          className="chat-composer-drop-overlay"
          aria-hidden="true"
          data-testid="chat-composer-drop-overlay"
        />
      )}
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
          <div className="chat-composer-mode">
            <ModePill
              ref={modePillRef}
              mode={permissionMode}
              expanded={modesOpen}
              disabled={disabled}
              onClick={() => setModesOpen((v) => !v)}
            />
            {modesOpen && (
              <ModesPicker
                mode={permissionMode}
                anchorRef={modePillRef}
                onSelect={handleSelectMode}
                onClose={() => setModesOpen(false)}
              />
            )}
          </div>
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
