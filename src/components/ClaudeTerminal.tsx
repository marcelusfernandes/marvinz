import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

type Props = {
  vaultPath: string
  claudePath: string | null
}

const PTY_ID = 'claude-main'

type Status = 'starting' | 'running' | 'exited' | 'error'

export function ClaudeTerminal({ vaultPath, claudePath }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [status, setStatus] = useState<Status>('starting')
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [restartTick, setRestartTick] = useState(0)

  useEffect(() => {
    if (!hostRef.current) return

    const term = new Terminal({
      fontFamily: 'ui-monospace, SF Mono, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: '#181818',
        foreground: '#e6e6e6',
        cursor: '#e6e6e6',
        black: '#1e1e1e',
        brightBlack: '#5c5c5c',
      },
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
      if (!claudePath) {
        term.writeln('\x1b[31mClaude CLI not found.\x1b[0m')
        term.writeln('Install with one of:')
        term.writeln('  npm i -g @anthropic-ai/claude-code')
        term.writeln('  curl -fsSL https://claude.ai/install.sh | bash')
        setStatus('error')
        return
      }

      // 1. Wait two frames so the layout settles and FitAddon can read real dims.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
      if (killed) return

      try {
        fit.fit()
      } catch {
        // ignore — may not have dims yet
      }

      // 2. Register listeners FIRST so we don't miss the first bytes.
      const offData = window.marvin.pty.onData(PTY_ID, (data) => {
        term.write(data)
      })
      const offExit = window.marvin.pty.onExit(PTY_ID, (code) => {
        term.writeln(`\r\n\x1b[33m[claude exited with code ${code}]\x1b[0m`)
        setStatus('exited')
        setExitCode(code)
      })
      disposers.push(offData, offExit)

      // 3. Spawn — only after listeners are armed.
      try {
        const { cols, rows } = term
        await window.marvin.pty.spawn({
          id: PTY_ID,
          shell: claudePath,
          cwd: vaultPath,
          cols,
          rows,
          args: [],
        })
        setStatus('running')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        term.writeln(`\r\n\x1b[31mFailed to start Claude: ${msg}\x1b[0m`)
        term.writeln('Press the Restart button above to try again.')
        setStatus('error')
        return
      }

      // 4. Pipe input & resize.
      const onTermData = term.onData((data) => {
        window.marvin.pty.write(PTY_ID, data)
      })
      const onResize = term.onResize(({ cols, rows }) => {
        window.marvin.pty.resize(PTY_ID, cols, rows)
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
      window.marvin.pty.kill(PTY_ID)
      term.dispose()
    }
  }, [vaultPath, claudePath, restartTick])

  const handleRestart = useCallback(() => {
    setStatus('starting')
    setExitCode(null)
    setRestartTick((t) => t + 1)
  }, [])

  const showRestart = status === 'exited' || status === 'error'

  return (
    <div className="claude-terminal">
      <div className="claude-header">
        <span className={`dot ${status}`} />
        <span className="claude-title">Claude Code</span>
        {status === 'exited' && (
          <span className="claude-status-text">exited ({exitCode})</span>
        )}
        {status === 'error' && <span className="claude-status-text">error</span>}
        {showRestart && (
          <button type="button" className="claude-restart" onClick={handleRestart}>
            Restart
          </button>
        )}
      </div>
      <div ref={hostRef} className="claude-host" />
    </div>
  )
}
