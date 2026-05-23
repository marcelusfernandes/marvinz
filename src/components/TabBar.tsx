import { useCallback } from 'react'
import { Icon } from './Icon'
import { fileIconFor } from '../lib/fileIcons'
import type { MenuItemSpec } from '../types'

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
  const handleContextMenu = useCallback(
    async (e: React.MouseEvent, tabId: string) => {
      e.preventDefault()
      e.stopPropagation()
      const idx = tabs.findIndex((t) => t.id === tabId)
      if (idx === -1) return
      const target = tabs[idx]
      const others = tabs.filter((t) => t.id !== tabId)
      const toRight = tabs.slice(idx + 1)
      const revealPath = target.type === 'browser' ? null : target.path
      const items: MenuItemSpec[] = [
        { kind: 'item', id: 'close', label: 'Close' },
        { kind: 'item', id: 'closeOthers', label: 'Close Others', enabled: others.length > 0 },
        { kind: 'item', id: 'closeRight', label: 'Close to the Right', enabled: toRight.length > 0 },
        { kind: 'item', id: 'closeAll', label: 'Close All' },
        { kind: 'separator' },
        { kind: 'item', id: 'reveal', label: 'Reveal in Finder', enabled: revealPath !== null },
      ]
      const action = await window.marvin.app.showContextMenu(items)
      if (!action) return
      switch (action) {
        case 'close':
          onClose(tabId)
          break
        case 'closeOthers':
          for (const t of others) onClose(t.id)
          break
        case 'closeRight':
          for (const t of toRight) onClose(t.id)
          break
        case 'closeAll':
          for (const t of tabs) onClose(t.id)
          break
        case 'reveal':
          if (revealPath) void window.marvin.shell.reveal(revealPath)
          break
      }
    },
    [tabs, onClose],
  )

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
            onContextMenu={(e) => handleContextMenu(e, t.id)}
            title={tooltip}
          >
            <TabIcon
              tab={t}
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
              <Icon name="close" size={14}/>
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
        <Icon name="add"/>
      </button>
    </div>
  )
}

function TabIcon({ tab, loading }: { tab: Tab; loading: boolean }) {
  if (tab.type === 'browser') {
    if (loading) return <span className="tab-icon spinner" aria-hidden />
    return <Icon name="globe" className="tab-icon" size={12} />
  }
  // note & image both have a path → use file-type icon based on extension
  return <Icon name={fileIconFor(basename(tab.path))} className="tab-icon" size={12} />
}
