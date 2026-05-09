type Tab = {
  id: string
  path: string
}

type Props = {
  tabs: Tab[]
  activeId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
}

function tabLabel(p: string): string {
  const base = p.split('/').pop() ?? p
  return base.replace(/\.(md|markdown)$/i, '')
}

export function TabBar({ tabs, activeId, onActivate, onClose }: Props) {
  if (tabs.length === 0) return null
  return (
    <div className="tab-bar">
      {tabs.map((t) => {
        const active = t.id === activeId
        return (
          <div
            key={t.id}
            className={`tab${active ? ' active' : ''}`}
            onMouseDown={(e) => {
              if (e.button === 1) {
                // middle-click closes
                e.preventDefault()
                onClose(t.id)
              } else if (e.button === 0) {
                onActivate(t.id)
              }
            }}
            title={t.path}
          >
            <span className="tab-title">{tabLabel(t.path)}</span>
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
    </div>
  )
}
