import { useCallback, useEffect, useState } from 'react'
import { AgentTerminal, type AgentDef, type AgentStatus } from './AgentTerminal'

type Props = {
  agents: AgentDef[]
  vaultPath: string
}

const ACTIVE_AGENT_KEY = 'marvin:activeAgent'

function readStoredAgent(agents: AgentDef[]): string {
  try {
    const v = window.localStorage.getItem(ACTIVE_AGENT_KEY)
    if (v && agents.some((a) => a.id === v)) return v
  } catch {
    // ignore
  }
  return agents[0]?.id ?? ''
}

export function AgentsPane({ agents, vaultPath }: Props) {
  const [activeId, setActiveId] = useState<string>(() => readStoredAgent(agents))
  // Lazy mount: only spawn the PTY when the user has activated the tab at
  // least once. After that the terminal stays mounted (and its PTY alive)
  // even when the tab is hidden.
  const [mounted, setMounted] = useState<Set<string>>(() => new Set([readStoredAgent(agents)]))
  const [statuses, setStatuses] = useState<Record<string, { status: AgentStatus; exitCode: number | null }>>({})

  useEffect(() => {
    try {
      window.localStorage.setItem(ACTIVE_AGENT_KEY, activeId)
    } catch {
      // ignore
    }
  }, [activeId])

  const activate = useCallback((id: string) => {
    setActiveId(id)
    setMounted((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  const handleStatusChange = useCallback(
    (id: string, status: AgentStatus, exitCode: number | null) => {
      setStatuses((prev) => {
        const curr = prev[id]
        if (curr && curr.status === status && curr.exitCode === exitCode) return prev
        return { ...prev, [id]: { status, exitCode } }
      })
    },
    [],
  )

  return (
    <div className="agents-pane-inner">
      <div className="agent-tabs" role="tablist">
        {agents.map((agent) => {
          const s = statuses[agent.id]?.status
          const installed = agent.binaryPath != null
          return (
            <button
              type="button"
              key={agent.id}
              role="tab"
              className={`agent-tab${activeId === agent.id ? ' active' : ''}`}
              aria-selected={activeId === agent.id}
              onClick={() => activate(agent.id)}
              title={installed ? agent.name : `${agent.name} — not installed`}
            >
              <span className={`agent-tab-dot ${s ?? (installed ? 'idle' : 'idle')}${installed ? '' : ' uninstalled'}`} />
              <span className="agent-tab-name">{agent.name}</span>
            </button>
          )
        })}
      </div>
      <div className="agent-stack">
        {agents.map(
          (agent) =>
            mounted.has(agent.id) && (
              <AgentTerminal
                key={agent.id}
                agent={agent}
                vaultPath={vaultPath}
                isActive={agent.id === activeId}
                onStatusChange={handleStatusChange}
              />
            ),
        )}
      </div>
    </div>
  )
}
