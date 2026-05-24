import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgentTerminal, type AgentDef, type AgentStatus } from './AgentTerminal'
import { Icon } from './Icon'
import { InputDialog } from './InputDialog'
import { ChatPanel, type TurnSummary } from './chat/ChatPanel'
import { useSetting } from '../lib/settingsStore'
import type { Provider } from '../lib/chat/types'
import {
  clearTabLabel,
  readTabLabels,
  writeTabLabels,
} from '../lib/chat/tabLabels'
import { CHAT_UI_ENABLED, resolveTabMode, type TabMode } from '../lib/featureFlags'
import type { MenuItemSpec } from '../types'

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

type AgentTab = {
  id: string
  agentId: string
  num: number
  mode: TabMode
  /** User-supplied label from the Rename action. Falls back to "<agent> <num>". */
  displayLabel?: string
}
type StatusEntry = { status: AgentStatus; exitCode: number | null }

const PICKER_ITEMS: MenuItemSpec[] = [
  { kind: 'item', id: 'claude', label: 'Claude Code' },
  { kind: 'item', id: 'codex', label: 'Codex' },
]

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
  const [renameTarget, setRenameTarget] = useState<AgentTab | null>(null)
  const counterRef = useRef<Record<string, number>>({})
  const newButtonRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<AgentTab[]>(tabs)
  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  // Hydrate displayLabel from localStorage on mount and GC orphan entries.
  useEffect(() => {
    const stored = readTabLabels()
    if (Object.keys(stored).length === 0) return
    setTabs((prev) => {
      const ids = new Set(prev.map((t) => t.id))
      const cleaned: Record<string, string> = {}
      for (const [id, label] of Object.entries(stored)) {
        if (ids.has(id)) cleaned[id] = label
      }
      writeTabLabels(cleaned)
      if (prev.length === 0) return prev
      let changed = false
      const next = prev.map((t) => {
        const label = cleaned[t.id]
        if (label && label !== t.displayLabel) {
          changed = true
          return { ...t, displayLabel: label }
        }
        return t
      })
      return changed ? next : prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const tabLabel = useCallback(
    (t: AgentTab) => {
      if (t.displayLabel) return t.displayLabel
      const a = findAgent(t.agentId)
      return a ? `${a.name} ${t.num}` : t.agentId
    },
    [findAgent],
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
      // opted into terminal mode. Gated entirely off in release builds via
      // CHAT_UI_ENABLED (see featureFlags.ts).
      const mode: TabMode = resolveTabMode(
        CHAT_UI_ENABLED,
        terminalModeDefault,
        isChatProvider(agentId),
      )
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
      clearTabLabel(id)
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

  const renameTab = useCallback((id: string, label: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      if (idx === -1) return prev
      const trimmed = label.trim()
      const next = prev.slice()
      // Empty label clears the override → fall back to default "<agent> <num>".
      next[idx] = { ...next[idx], displayLabel: trimmed || undefined }
      return next
    })
    const trimmed = label.trim()
    if (trimmed) {
      const stored = readTabLabels()
      stored[id] = trimmed
      writeTabLabels(stored)
    } else {
      clearTabLabel(id)
    }
  }, [])

  const restartTab = useCallback(
    (id: string) => {
      const target = tabsRef.current.find((t) => t.id === id)
      if (!target) return
      const savedLabel = target.displayLabel
      removeTab(id)
      addTab(target.agentId)
      if (!savedLabel) return
      // addTab synchronously bumped counterRef and queued a setTabs with id
      // `${agentId}-<new ptySeq>`. Compute that id and reapply the label.
      const newPtySeq = counterRef.current[target.agentId]
      const newId = `${target.agentId}-${newPtySeq}`
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === newId)
        if (idx === -1) return prev
        if (prev[idx].displayLabel === savedLabel) return prev
        const next = prev.slice()
        next[idx] = { ...next[idx], displayLabel: savedLabel }
        return next
      })
      clearTabLabel(id)
      const stored = readTabLabels()
      stored[newId] = savedLabel
      writeTabLabels(stored)
    },
    [removeTab, addTab],
  )

  const closeOthers = useCallback(
    (keepId: string) => {
      const droppedIds = tabsRef.current
        .filter((t) => t.id !== keepId)
        .map((t) => t.id)
      setTabs((prev) => {
        const keep = prev.find((t) => t.id === keepId)
        if (!keep) return prev
        return [keep]
      })
      setActiveId(keepId)
      setStatuses((prev) => {
        if (keepId in prev) return { [keepId]: prev[keepId] }
        return {}
      })
      if (droppedIds.length > 0) {
        const stored = readTabLabels()
        let changed = false
        for (const id of droppedIds) {
          if (id in stored) {
            delete stored[id]
            changed = true
          }
        }
        if (changed) writeTabLabels(stored)
      }
    },
    [],
  )

  const handleTabContextMenu = useCallback(
    async (e: React.MouseEvent, tabId: string) => {
      e.preventDefault()
      e.stopPropagation()
      const otherCount = tabs.filter((t) => t.id !== tabId).length
      const items: MenuItemSpec[] = [
        { kind: 'item', id: 'close', label: 'Close' },
        {
          kind: 'item',
          id: 'closeOthers',
          label: 'Close Others',
          enabled: otherCount > 0,
        },
        { kind: 'separator' },
        { kind: 'item', id: 'restart', label: 'Restart' },
        { kind: 'item', id: 'rename', label: 'Rename…' },
      ]
      const action = await window.marvin.app.showContextMenu(items)
      if (!action) return
      switch (action) {
        case 'close':
          removeTab(tabId)
          break
        case 'closeOthers':
          closeOthers(tabId)
          break
        case 'restart':
          restartTab(tabId)
          break
        case 'rename': {
          const target = tabs.find((t) => t.id === tabId)
          if (target) setRenameTarget(target)
          break
        }
      }
    },
    [tabs, removeTab, closeOthers, restartTab],
  )

  const handlePlus = useCallback(async () => {
    if (installed.length === 0) return
    if (defaultAgentId) {
      addTab(defaultAgentId)
      return
    }
    if (installed.length === 1) {
      pickAndOpen(installed[0].id)
      return
    }
    const action = await window.marvin.app.showContextMenu(PICKER_ITEMS)
    if (action === 'claude' || action === 'codex') pickAndOpen(action)
  }, [installed, defaultAgentId, addTab, pickAndOpen])

  const handleChevron = useCallback(
    async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault()
      e.stopPropagation()
      if (installed.length === 0) return
      const action = await window.marvin.app.showContextMenu(PICKER_ITEMS)
      if (action === 'claude' || action === 'codex') addTab(action)
    },
    [installed, addTab],
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
              data-agent={t.agentId}
              onContextMenu={(e) => handleTabContextMenu(e, t.id)}
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
                <Icon name="close" size={14}/>
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
            if (CHAT_UI_ENABLED && t.mode === 'chat' && isChatProvider(t.agentId)) {
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
      {renameTarget && (
        <InputDialog
          title="Rename tab"
          initialValue={tabLabel(renameTarget)}
          submitLabel="Rename"
          onSubmit={(value) => {
            renameTab(renameTarget.id, value)
            setRenameTarget(null)
          }}
          onCancel={() => setRenameTarget(null)}
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
