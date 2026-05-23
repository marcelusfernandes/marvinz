import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { Icon } from './Icon'
import { useColorTheme } from '../lib/colorTheme'

function readCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function xtermThemeFromCss() {
  return {
    // Transparent so the terminal inherits the claude-pane surface.
    background: 'rgba(0, 0, 0, 0)',
    foreground: readCssVar('--text-primary'),
    cursor: readCssVar('--text-primary'),
    black: readCssVar('--surface-1'),
    brightBlack: readCssVar('--text-tertiary'),
  }
}

export type AgentDef = {
  /** Stable identifier (`'claude'`, `'codex'`, …). */
  id: string
  /** Display name shown in the tab. */
  name: string
  /** Resolved binary path, or null when the CLI isn't installed. */
  binaryPath: string | null
  /** Optional install hints printed when binaryPath is null. */
  installInstructions?: string[]
}

type Status = 'starting' | 'running' | 'exited' | 'error'

type Props = {
  agent: AgentDef
  /** Unique PTY identifier for this terminal instance. Distinct per tab so
   * multiple tabs of the same agent each get their own backing process. */
  ptyId: string
  vaultPath: string
  /** Whether this terminal is currently visible. Hidden terminals keep
   * their PTY and xterm instance alive in the background. */
  isActive: boolean
  /** Notifies the parent when this terminal's status changes (used to
   * paint the tab dot). */
  onStatusChange?: (ptyId: string, status: Status, exitCode: number | null) => void
}

export function AgentTerminal({ agent, ptyId, vaultPath, isActive, onStatusChange }: Props) {
  const resolvedTheme = useColorTheme()
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [status, setStatus] = useState<Status>('starting')
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [restartTick, setRestartTick] = useState(0)

  // Notify parent whenever status changes.
  useEffect(() => {
    onStatusChange?.(ptyId, status, exitCode)
  }, [status, exitCode, ptyId, onStatusChange])

  useEffect(() => {
    if (!hostRef.current) return

    const term = new Terminal({
      fontFamily: 'ui-monospace, SF Mono, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: xtermThemeFromCss(),
      allowTransparency: true,
      convertEol: true,
      scrollback: 5000,
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(hostRef.current)

    termRef.current = term
    fitRef.current = fit

    const disposers: Array<() => void> = []
    let killed = false

    const start = async () => {
      if (!agent.binaryPath) {
        term.writeln(`\x1b[31m${agent.name} CLI not found.\x1b[0m`)
        if (agent.installInstructions?.length) {
          term.writeln('Install with one of:')
          for (const line of agent.installInstructions) term.writeln(`  ${line}`)
        }
        setStatus('error')
        return
      }

      // Wait two frames so layout settles and FitAddon can read real dims.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
      if (killed) return

      try {
        fit.fit()
      } catch {
        // ignore — may not have dims yet
      }

      const offData = window.marvin.pty.onData(ptyId, (data) => {
        term.write(data)
      })
      const offExit = window.marvin.pty.onExit(ptyId, (code) => {
        term.writeln(`\r\n\x1b[33m[${agent.name} exited with code ${code}]\x1b[0m`)
        setStatus('exited')
        setExitCode(code)
      })
      disposers.push(offData, offExit)

      try {
        const { cols, rows } = term
        await window.marvin.pty.spawn({
          id: ptyId,
          shell: agent.binaryPath,
          cwd: vaultPath,
          cols,
          rows,
          args: [],
        })
        setStatus('running')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        term.writeln(`\r\n\x1b[31mFailed to start ${agent.name}: ${msg}\x1b[0m`)
        term.writeln('Press the Restart button above to try again.')
        setStatus('error')
        return
      }

      const onTermData = term.onData((data) => {
        window.marvin.pty.write(ptyId, data)
      })
      const onResize = term.onResize(({ cols, rows }) => {
        window.marvin.pty.resize(ptyId, cols, rows)
      })
      disposers.push(() => onTermData.dispose(), () => onResize.dispose())
    }

    void start()

    const handleResize = () => {
      try {
        fit.fit()
      } catch {
        // ignore
      }
    }
    const observer = new ResizeObserver(handleResize)
    observer.observe(hostRef.current)

    return () => {
      killed = true
      observer.disconnect()
      for (const dispose of disposers) dispose()
      window.marvin.pty.kill(ptyId)
      term.dispose()
    }
  }, [vaultPath, agent.binaryPath, agent.name, agent.installInstructions, ptyId, restartTick])

  // Refit when becoming active again — the terminal's container may have
  // had display:none and reported zero dimensions.
  useEffect(() => {
    if (!isActive) return
    requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
      } catch {
        // ignore
      }
    })
  }, [isActive])

  // Re-read theme colors from CSS vars when the user switches color theme.
  useEffect(() => {
    if (!termRef.current) return
    termRef.current.options.theme = xtermThemeFromCss()
  }, [resolvedTheme])

  const handleRestart = useCallback(() => {
    setStatus('starting')
    setExitCode(null)
    setRestartTick((t) => t + 1)
  }, [])

  const showRestart = status === 'exited' || status === 'error'

  return (
    <div className={`agent-terminal${isActive ? ' active' : ''}`}>
      {showRestart && (
        <div className="agent-restart-bar">
          <button type="button" className="claude-restart" onClick={handleRestart}>
            <Icon name="debug-restart" size={14} />
            Restart {agent.name}
          </button>
        </div>
      )}
      <div ref={hostRef} className="claude-host" />
    </div>
  )
}

export type { Status as AgentStatus }
