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

type ImageTab = {
  type: 'image'
  id: string
  path: string
}

type Tab = NoteTab | BrowserTab | ImageTab

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

function basename(p: string): string {
  return p.split('/').pop() ?? p
}

export function TabBar({ tabs, activeId, onActivate, onClose, onNewBrowserTab }: Props) {
  return (
    <div className="tab-bar">
      {tabs.map((t) => {
        const active = t.id === activeId
        const kind: 'note' | 'browser' | 'image' = t.type
        const label =
          t.type === 'browser'
            ? browserLabel(t)
            : t.type === 'image'
              ? basename(t.path)
              : noteLabel(t.path)
        const tooltip = t.type === 'browser' ? t.url : t.path
        return (
          <div
            key={t.id}
            className={`tab${active ? ' active' : ''} tab-${kind}`}
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
              kind={kind}
              loading={t.type === 'browser' ? t.loading : false}
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

function TabIcon({ kind, loading }: { kind: 'note' | 'browser' | 'image'; loading: boolean }) {
  if (kind === 'image') {
    return (
      <svg className="tab-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden>
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
        <circle cx="5.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
        <path d="M2 12 L6 8 L9 11 L11 9 L14 12" />
      </svg>
    )
  }
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
