import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgentTerminal, type AgentDef, type AgentStatus } from './AgentTerminal'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { Icon } from './Icon'
import { ChatPanel, type TurnSummary } from './chat/ChatPanel'
import { useSetting } from '../lib/settingsStore'
import type { Provider } from '../lib/chat/types'

type Props = {
  agents: AgentDef[]
  vaultPath: string
  /** Increments to request opening a new tab (Cmd+Shift+T from App). */
  newTabTick: number
  /** Open the SnapshotPanel pre-selected to this turn id (from UserBubble). */
  onRewind?: (turnId: string) => void
  /** Fires when a chat turn finishes with >=1 Edit/Write — drives SnapshotToast. */
  onTurnSummary?: (summary: TurnSummary) => void
}

type TabMode = 'chat' | 'terminal'
type AgentTab = { id: string; agentId: string; num: number; mode: TabMode }
type CtxState = { x: number; y: number; items: MenuItem[] } | null
type StatusEntry = { status: AgentStatus; exitCode: number | null }

const DEFAULT_AGENT_KEY = 'marvin:defaultAgent'

function isChatProvider(id: string): id is Provider {
  return id === 'claude' || id === 'codex'
}

function readStoredDefault(agents: AgentDef[]): string | null {
  try {
    const v = window.localStorage.getItem(DEFAULT_AGENT_KEY)
    if (v && agents.some((a) => a.id === v && a.binaryPath != null)) return v
  } catch {
    // ignore
  }
  return null
}

export function AgentsPane({
  agents,
  vaultPath,
  newTabTick,
  onRewind,
  onTurnSummary,
}: Props) {
  const installed = useMemo(
    () => agents.filter((a) => a.binaryPath != null),
    [agents],
  )
  const terminalModeDefault = useSetting('terminalModeEnabled') ?? false
  const [tabs, setTabs] = useState<AgentTab[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const [defaultAgentId, setDefaultAgentId] = useState<string | null>(() =>
    readStoredDefault(agents),
  )
  const [statuses, setStatuses] = useState<Record<string, StatusEntry>>({})
  const [ctxMenu, setCtxMenu] = useState<CtxState>(null)
  const counterRef = useRef<Record<string, number>>({})
  const newButtonRef = useRef<HTMLDivElement>(null)

  // Persist default agent.
  useEffect(() => {
    try {
      if (defaultAgentId) window.localStorage.setItem(DEFAULT_AGENT_KEY, defaultAgentId)
    } catch {
      // ignore
    }
  }, [defaultAgentId])

  // Auto-select default when only one agent is installed.
  useEffect(() => {
    if (defaultAgentId == null && installed.length === 1) {
      setDefaultAgentId(installed[0].id)
    }
  }, [installed, defaultAgentId])

  const findAgent = useCallback(
    (id: string) => agents.find((a) => a.id === id),
    [agents],
  )

  const addTab = useCallback(
    (agentId: string) => {
      const a = findAgent(agentId)
      if (!a || a.binaryPath == null) return
      // Monotonic counter for the PTY/session id so killed/spawned PTYs
      // never share a backing id (avoids races in the main-process pty map
      // and gives chat sessions a stable Zustand key).
      const ptySeq = (counterRef.current[agentId] ?? 0) + 1
      counterRef.current[agentId] = ptySeq
      // Display number reuses the lowest free slot — closing tab N frees N
      // for the next new tab of the same agent.
      const used = new Set(
        tabs.filter((t) => t.agentId === agentId).map((t) => t.num),
      )
      let num = 1
      while (used.has(num)) num++
      // Default to chat for native-chat-eligible providers unless the user
      // opted into terminal mode.
      const mode: TabMode =
        !terminalModeDefault && isChatProvider(agentId) ? 'chat' : 'terminal'
      const tab: AgentTab = {
        id: `${agentId}-${ptySeq}`,
        agentId,
        num,
        mode,
      }
      setTabs((prev) => [...prev, tab])
      setActiveId(tab.id)
    },
    [findAgent, tabs, terminalModeDefault],
  )

  const removeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id)
        if (idx === -1) return prev
        const next = prev.filter((t) => t.id !== id)
        if (activeId === id) {
          const neighbor = next[idx] ?? next[idx - 1] ?? null
          setActiveId(neighbor?.id ?? '')
        }
        return next
      })
      setStatuses((prev) => {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
    },
    [activeId],
  )

  const pickAndOpen = useCallback(
    (agentId: string) => {
      setDefaultAgentId(agentId)
      addTab(agentId)
    },
    [addTab],
  )

  const buildMenu = useCallback(
    (): MenuItem[] =>
      installed.map((a) => ({
        kind: 'item' as const,
        label: a.name,
        onClick: () => pickAndOpen(a.id),
      })),
    [installed, pickAndOpen],
  )

  const openMenuAtRect = useCallback(
    (rect: DOMRect) => {
      setCtxMenu({ x: rect.left, y: rect.bottom + 4, items: buildMenu() })
    },
    [buildMenu],
  )

  const handlePlus = useCallback(() => {
    if (installed.length === 0) return
    if (defaultAgentId) {
      addTab(defaultAgentId)
      return
    }
    if (installed.length === 1) {
      pickAndOpen(installed[0].id)
      return
    }
    if (newButtonRef.current) {
      openMenuAtRect(newButtonRef.current.getBoundingClientRect())
    }
  }, [installed, defaultAgentId, addTab, pickAndOpen, openMenuAtRect])

  const handleChevron = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault()
      e.stopPropagation()
      if (installed.length === 0) return
      openMenuAtRect(e.currentTarget.getBoundingClientRect())
    },
    [installed, openMenuAtRect],
  )

  // React to Cmd+Shift+T from the App-level shortcut.
  const handlePlusRef = useRef(handlePlus)
  useEffect(() => {
    handlePlusRef.current = handlePlus
  }, [handlePlus])
  useEffect(() => {
    if (newTabTick === 0) return
    handlePlusRef.current()
  }, [newTabTick])

  const handleStatusChange = useCallback(
    (ptyId: string, status: AgentStatus, exitCode: number | null) => {
      setStatuses((prev) => {
        const c = prev[ptyId]
        if (c && c.status === status && c.exitCode === exitCode) return prev
        return { ...prev, [ptyId]: { status, exitCode } }
      })
    },
    [],
  )

  const tabLabel = (t: AgentTab) => {
    const a = findAgent(t.agentId)
    return a ? `${a.name} ${t.num}` : t.agentId
  }

  return (
    <div className="agents-pane-inner">
      <div className="agent-tabs" role="tablist">
        {tabs.map((t) => {
          const s = statuses[t.id]?.status
          const label = tabLabel(t)
          return (
            <div
              key={t.id}
              className={`agent-tab${activeId === t.id ? ' active' : ''}`}
            >
              <button
                type="button"
                role="tab"
                className="agent-tab-main"
                aria-selected={activeId === t.id}
                onClick={() => setActiveId(t.id)}
                title={label}
              >
                <span className={`agent-tab-dot ${s ?? 'idle'}`} />
                <span className="agent-tab-name">{label}</span>
              </button>
              <button
                type="button"
                className="agent-tab-close"
                title="Close terminal"
                aria-label={`Close ${label}`}
                onClick={(e) => {
                  e.stopPropagation()
                  removeTab(t.id)
                }}
              >
                <Icon name="close"/>
              </button>
            </div>
          )
        })}
        <NewTabButton
          buttonRef={newButtonRef}
          installedCount={installed.length}
          onPlus={handlePlus}
          onChevron={handleChevron}
        />
      </div>
      <div className="agent-stack">
        {tabs.length === 0 ? (
          <EmptyState agents={agents} installed={installed} onNew={handlePlus} />
        ) : (
          tabs.map((t) => {
            const a = findAgent(t.agentId)
            if (!a) return null
            const isActive = activeId === t.id
            if (t.mode === 'chat' && isChatProvider(t.agentId)) {
              // Keep mounted but hidden when inactive so streaming state and
              // composer drafts survive tab switches.
              return (
                <div
                  key={t.id}
                  className="agent-stack-pane"
                  style={{ display: isActive ? 'flex' : 'none' }}
                >
                  <ChatPanel
                    sessionId={t.id}
                    provider={t.agentId}
                    vaultPath={vaultPath}
                    onRewind={onRewind}
                    onTurnSummary={onTurnSummary}
                  />
                </div>
              )
            }
            return (
              <AgentTerminal
                key={t.id}
                agent={a}
                ptyId={t.id}
                vaultPath={vaultPath}
                isActive={isActive}
                onStatusChange={handleStatusChange}
              />
            )
          })
        )}
      </div>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  )
}

function NewTabButton({
  buttonRef,
  installedCount,
  onPlus,
  onChevron,
}: {
  buttonRef: React.RefObject<HTMLDivElement | null>
  installedCount: number
  onPlus: () => void
  onChevron: (e: React.MouseEvent<HTMLButtonElement>) => void
}) {
  const disabled = installedCount === 0
  const showChevron = installedCount >= 2
  return (
    <div ref={buttonRef} className="agent-new">
      <button
        type="button"
        className="agent-new-plus"
        onClick={onPlus}
        disabled={disabled}
        title={disabled ? 'No agent installed' : 'New terminal'}
        aria-label="New terminal"
      >
        <Icon name="add"/>
      </button>
      {showChevron && (
        <button
          type="button"
          className="agent-new-chevron"
          onClick={onChevron}
          title="Choose agent"
          aria-label="Choose agent"
        >
          <Icon name="chevron-down"/>
        </button>
      )}
    </div>
  )
}

function EmptyState({
  agents,
  installed,
  onNew,
}: {
  agents: AgentDef[]
  installed: AgentDef[]
  onNew: () => void
}) {
  if (installed.length === 0) {
    return (
      <div className="agent-empty">
        <p>No agent CLI detected.</p>
        <ul className="agent-install-hints">
          {agents.map((a) => (
            <li key={a.id}>
              <strong>{a.name}:</strong>{' '}
              <code>{a.installInstructions?.[0] ?? '—'}</code>
            </li>
          ))}
        </ul>
      </div>
    )
  }
  return (
    <div className="agent-empty">
      <p>No terminal open.</p>
      <button type="button" className="agent-empty-cta" onClick={onNew}>
        + New terminal
      </button>
    </div>
  )
}
