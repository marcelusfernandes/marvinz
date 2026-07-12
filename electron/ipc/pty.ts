// pty:* IPC handlers — PTY lifecycle (spawn/write/resize/kill) and the AI-turn
// tracking side effects they trigger. Extracted from main.ts (#570); shared
// state main.ts still owns (activeVaultPath, win, turn tracking, getShellEnv)
// flows in via `PtyDeps` rather than a circular import of main.js.
import { ipcMain } from 'electron'
import * as pty from 'node-pty'
import { newTurnId } from '../snapshot.js'
import { assertPtySpawnAllowed, type PtySpawnOpts } from '../pty-spawn-guard.js'
import { killProcessTree } from '../proc-group.js'
import { IPC_CHANNELS } from '../../src/shared/ipc-channels.js'

export type PtyDeps = {
  getActiveVaultPath: () => string | null
  getShellEnv: () => NodeJS.ProcessEnv
  getActiveTurnId: () => string | null
  setActiveTurnId: (id: string | null) => void
  setLastPtyWriteAt: (timestamp: number) => void
  scheduleTurnEnd: (vaultRoot: string, turnId: string) => void
  cancelScheduledTurnEnd: () => void
  finalizeTurn: (vaultRoot: string, turnId: string) => Promise<void>
  sendToRenderer: (channel: string, payload: unknown) => void
}

const ptyProcesses = new Map<string, pty.IPty>()

// Called from main.ts's teardownChildren() on app quit — kills every tracked
// pty's full process tree (unlike the interactive pty:kill handler below,
// which stays a direct .kill() per #570's out-of-scope note on #561).
export function killAllPty(): void {
  for (const p of ptyProcesses.values()) killProcessTree(p.pid, 'SIGKILL')
  ptyProcesses.clear()
}

export function registerPtyHandlers(deps: PtyDeps): void {
  ipcMain.handle(IPC_CHANNELS.pty.spawn, async (_e, opts: PtySpawnOpts) => {
    const activeVaultPath = deps.getActiveVaultPath()
    if (!activeVaultPath) throw new Error('MARVIN_OUTSIDE_VAULT')
    const { shell: resolvedShell, cwd: safeCwd } = await assertPtySpawnAllowed(
      activeVaultPath,
      opts
    )

    const existing = ptyProcesses.get(opts.id)
    // Spawn-replacement kill stays .kill() (not killProcessTree) — #561's fix
    // for this call site isn't merged yet; out of scope for this relocation.
    if (existing) existing.kill()

    const shellEnv = deps.getShellEnv()
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(shellEnv)) {
      if (v != null) env[k] = v
    }
    delete env.ELECTRON_RUN_AS_NODE
    env.TERM = 'xterm-256color'
    env.COLORTERM = 'truecolor'
    env.FORCE_COLOR = '1'

    const cols = Math.max(opts.cols || 80, 20)
    const rows = Math.max(opts.rows || 24, 5)

    try {
      const ptyProcess = pty.spawn(resolvedShell, opts.args ?? [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: safeCwd,
        env,
      })
      ptyProcesses.set(opts.id, ptyProcess)

      ptyProcess.onData((data) => {
        // Stamp AI turn activity on every data chunk — Claude streams output
        // continuously, so the 2s window stays open while it's responding.
        deps.setLastPtyWriteAt(Date.now())
        let turnId = deps.getActiveTurnId()
        if (!turnId) {
          turnId = newTurnId()
          deps.setActiveTurnId(turnId)
        }
        const vaultRoot = deps.getActiveVaultPath()
        if (vaultRoot) deps.scheduleTurnEnd(vaultRoot, turnId)
        deps.sendToRenderer(IPC_CHANNELS.pty.data(opts.id), data)
      })
      ptyProcess.onExit(({ exitCode }) => {
        deps.sendToRenderer(IPC_CHANNELS.pty.exit(opts.id), exitCode)
        ptyProcesses.delete(opts.id)
        const turnId = deps.getActiveTurnId()
        const vaultRoot = deps.getActiveVaultPath()
        // When last PTY exits, fire turn-end immediately rather than waiting the timer
        if (ptyProcesses.size === 0 && turnId && vaultRoot) {
          deps.cancelScheduledTurnEnd()
          deps.setActiveTurnId(null)
          deps.finalizeTurn(vaultRoot, turnId).catch(() => {})
        } else if (ptyProcesses.size === 0) {
          deps.setActiveTurnId(null)
        }
      })
      return { pid: ptyProcess.pid }
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err)
      if (/^(MARVIN|SNAPSHOT)_[A-Z_]+$/.test(code)) throw err
      console.error('[pty:spawn] spawn failed', { id: opts.id, shell: opts.shell, err })
      throw new Error('MARVIN_PTY_SPAWN_FAILED', { cause: err })
    }
  })

  ipcMain.handle(IPC_CHANNELS.pty.write, (_e, id: string, data: string) => {
    deps.setLastPtyWriteAt(Date.now())
    let turnId = deps.getActiveTurnId()
    if (!turnId) {
      turnId = newTurnId()
      deps.setActiveTurnId(turnId)
    }
    const vaultRoot = deps.getActiveVaultPath()
    if (vaultRoot) deps.scheduleTurnEnd(vaultRoot, turnId)
    ptyProcesses.get(id)?.write(data)
  })

  ipcMain.handle(IPC_CHANNELS.pty.resize, (_e, id: string, cols: number, rows: number) => {
    ptyProcesses.get(id)?.resize(cols, rows)
  })

  ipcMain.handle(IPC_CHANNELS.pty.kill, (_e, id: string) => {
    // Stays .kill() (not killProcessTree) — same #561 out-of-scope note as
    // the spawn-replacement kill above.
    ptyProcesses.get(id)?.kill()
    ptyProcesses.delete(id)
  })
}
