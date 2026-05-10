type NoteTab = {
  type: 'note'
  id: string
  path: string
}

type BrowserTab = {
  type: 'browser'
  id: string
  url: string
  title: string
  loading: boolean
}

type Tab = NoteTab | BrowserTab

type Props = {
  tabs: Tab[]
  activeId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onNewBrowserTab: () => void
}

function noteLabel(p: string): string {
  const base = p.split('/').pop() ?? p
  return base.replace(/\.(md|markdown)$/i, '')
}

function browserLabel(t: BrowserTab): string {
  if (t.title) return t.title
  if (t.url && t.url !== 'about:blank') {
    try {
      return new URL(t.url).hostname
    } catch {
      return t.url
    }
  }
  return 'New tab'
}

export function TabBar({ tabs, activeId, onActivate, onClose, onNewBrowserTab }: Props) {
  return (
    <div className="tab-bar">
      {tabs.map((t) => {
        const active = t.id === activeId
        const isBrowser = t.type === 'browser'
        const label = isBrowser ? browserLabel(t) : noteLabel(t.path)
        const tooltip = isBrowser ? t.url : t.path
        return (
          <div
            key={t.id}
            className={`tab${active ? ' active' : ''}${isBrowser ? ' browser' : ''}`}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                onClose(t.id)
              } else if (e.button === 0) {
                onActivate(t.id)
              }
            }}
            title={tooltip}
          >
            <TabIcon
              kind={isBrowser ? 'browser' : 'note'}
              loading={isBrowser ? t.loading : false}
            />
            <span className="tab-title">{label}</span>
            <button
              type="button"
              className="tab-close"
              aria-label="Close tab"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onClose(t.id)
              }}
            >
              ×
            </button>
          </div>
        )
      })}
      <button
        type="button"
        className="tab-new"
        onClick={onNewBrowserTab}
        title="New browser tab (⌘T)"
        aria-label="New browser tab"
      >
        +
      </button>
    </div>
  )
}

function TabIcon({ kind, loading }: { kind: 'note' | 'browser'; loading: boolean }) {
  if (kind === 'browser') {
    if (loading) {
      return <span className="tab-icon spinner" aria-hidden />
    }
    return (
      <svg className="tab-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
        <circle cx="8" cy="8" r="6.5" />
        <ellipse cx="8" cy="8" rx="3" ry="6.5" />
        <path d="M1.5 8 L14.5 8" />
      </svg>
    )
  }
  return (
    <svg className="tab-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden>
      <path d="M3 1.5 L9 1.5 L13 5.5 L13 14.5 L3 14.5 Z" />
      <path d="M9 1.5 L9 5.5 L13 5.5" />
    </svg>
  )
}
