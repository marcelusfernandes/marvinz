import { Icon } from '../Icon'
import type { Provider } from '../../lib/chat/types'

type Props = {
  provider: Provider
  sessionTitle?: string
  onOpenHistory?: () => void
  onNewSession?: () => void
  onExpand?: () => void
}

/**
 * Two-row header (per chat-design-v1.md §6.2 "Header"):
 *   Row 1: MARVIN brand + expand icon
 *   Row 2: provider pill + session title + history/new-session icons
 */
export function ChatHeader({
  provider,
  sessionTitle,
  onOpenHistory,
  onNewSession,
  onExpand,
}: Props) {
  const providerLabel = provider === 'claude' ? 'Claude' : 'Codex'

  return (
    <header className="chat-header">
      <div className="chat-header-top-row">
        <span className="chat-brand">MARVIN</span>
        <button
          type="button"
          className="icon-btn"
          aria-label="Expand panel"
          title="Expand panel"
          onClick={onExpand}
          disabled={!onExpand}
        >
          <Icon name="expand-all" size={14} />
        </button>
      </div>
      <div className="chat-header-session-row">
        <span className="chat-provider-pill" data-provider={provider}>
          {providerLabel}
        </span>
        <span className="chat-session-title" title={sessionTitle ?? 'New session'}>
          {sessionTitle ?? 'New session'}
        </span>
        <div className="chat-header-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label="Session history"
            title="Session history"
            onClick={onOpenHistory}
            disabled={!onOpenHistory}
          >
            <Icon name="history" size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="New session"
            title="New session"
            onClick={onNewSession}
            disabled={!onNewSession}
          >
            <Icon name="new-file" size={14} />
          </button>
        </div>
      </div>
    </header>
  )
}
