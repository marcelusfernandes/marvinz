import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { Icon } from './Icon'
import { useColorTheme } from '../lib/colorTheme'
import { createTerminalLinkProvider, createOsc8LinkHandler } from '../lib/terminalLinkProvider'
import { MARVIN_PATH_MIME, MARVIN_PATHS_MIME, readDraggedPaths } from '../lib/dropAttachments'
import { formatPathsForAgent, type AgentKind } from '../lib/agent-drop-format'

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
  /** Opens a vault file when the user Cmd/Ctrl+Clicks a path in the output. */
  onOpenFile?: (absolutePath: string) => void
}

export function AgentTerminal({
  agent,
  ptyId,
  vaultPath,
  isActive,
  onStatusChange,
  onOpenFile,
}: Props) {
  const resolvedTheme = useColorTheme()
  // Keep the latest callback in a ref so changing its identity doesn't tear
  // down and rebuild the terminal (which would kill the PTY).
  const onOpenFileRef = useRef(onOpenFile)
  useEffect(() => {
    onOpenFileRef.current = onOpenFile
  }, [onOpenFile])
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [status, setStatus] = useState<Status>('starting')
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [restartTick, setRestartTick] = useState(0)
  const [dragOver, setDragOver] = useState(false)

  // Notify parent whenever status changes.
  useEffect(() => {
    onStatusChange?.(ptyId, status, exitCode)
  }, [status, exitCode, ptyId, onStatusChange])

  useEffect(() => {
    if (!hostRef.current) return

    const term = new Terminal({
      fontFamily: 'ui-monospace, SF Mono, Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      theme: xtermThemeFromCss(),
      allowTransparency: true,
      convertEol: true,
      scrollback: 5000,
      allowProposedApi: true,
      // Routes OSC 8 hyperlinks (Claude Code marks file references this way) to
      // our editor on Cmd/Ctrl+Click instead of xterm's default confirm().
      linkHandler: createOsc8LinkHandler({
        vaultPath,
        onOpenFile: (p) => onOpenFileRef.current?.(p),
      }),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(hostRef.current)

    termRef.current = term
    fitRef.current = fit

    const disposers: Array<() => void> = []
    let killed = false

    // Cmd/Ctrl+Click on a relative file path in the output opens it in the
    // editor pane. The resolver guards against paths outside the vault.
    const linkProvider = term.registerLinkProvider(
      createTerminalLinkProvider(term, {
        vaultPath,
        onOpenFile: (p) => onOpenFileRef.current?.(p),
      })
    )
    disposers.push(() => linkProvider.dispose())

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
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
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
      disposers.push(
        () => onTermData.dispose(),
        () => onResize.dispose()
      )
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

  const agentKind: AgentKind = agent.id === 'codex' ? 'codex' : 'claude-code'

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    const types = e.dataTransfer.types
    if (!types.includes(MARVIN_PATH_MIME) && !types.includes(MARVIN_PATHS_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    // dragleave fires on child-element transitions (xterm rows, restart bar).
    // Only clear when the pointer actually leaves the terminal.
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      const paths = readDraggedPaths(e.dataTransfer)
      setDragOver(false)
      if (paths.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      if (!vaultPath) return
      // Pass '' so the helper keeps paths absolute — the PTY may have a
      // different cwd than the vault root, so the agent needs the full path
      // to actually find the file.
      const text = formatPathsForAgent(paths, agentKind, '') + ' '
      void window.marvin.pty.write(ptyId, text)
      // Focus xterm so the user can keep typing immediately after the drop
      // without an extra click.
      termRef.current?.focus()
    },
    [agentKind, ptyId, vaultPath]
  )

  return (
    <div
      className={`agent-terminal${isActive ? ' active' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {showRestart && (
        <div className="agent-restart-bar">
          <button type="button" className="claude-restart" onClick={handleRestart}>
            <Icon name="debug-restart" size={14} />
            Restart {agent.name}
          </button>
        </div>
      )}
      <div ref={hostRef} className="claude-host" />
      {dragOver && (
        <div
          className="agent-terminal-drop-overlay"
          aria-hidden="true"
          data-testid="agent-terminal-drop-overlay"
        />
      )}
    </div>
  )
}

export type { Status as AgentStatus }
