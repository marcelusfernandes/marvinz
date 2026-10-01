/**
 * Recoverable error surface for a chat turn (C1-4). Rendered above the composer
 * when the session's turnState is 'error'. Without this, an errored/crashed turn
 * is a dead end for a terminal-free user — here they get the reason and a Retry.
 */
type Props = {
  message: string
  code?: string
  onRetry: () => void
}

export function ChatErrorBanner({ message, code, onRetry }: Props) {
  const isAuth = code === 'AGENT_NOT_AUTHENTICATED'
  return (
    <div className="chat-error-banner" role="alert">
      <div className="chat-error-banner-body">
        <span className="chat-error-banner-icon" aria-hidden="true">
          ⚠
        </span>
        <div className="chat-error-banner-text">
          <span className="chat-error-banner-message">{message}</span>
          {isAuth && (
            <span className="chat-error-banner-hint">
              Run <code>claude login</code> in a terminal, then retry.
            </span>
          )}
        </div>
      </div>
      <button type="button" className="chat-error-banner-retry" onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}
