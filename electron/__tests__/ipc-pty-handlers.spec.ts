/**
 * Characterization tests for electron/ipc/pty.ts (#570).
 *
 * Before this refactor, the pty:* IPC handlers lived inline in main.ts and had
 * zero direct test coverage: pty-spawn.spec.ts only exercises the standalone
 * guard functions (assertPtySpawnAllowed, registerDynamicShell), never the
 * actual pty:spawn/write/resize/kill handlers or the AI-turn-tracking side
 * effects they trigger. These tests pin that behavior against the extracted
 * module directly (registerPtyHandlers(deps) + a mocked node-pty), so a
 * future edit to electron/ipc/pty.ts that changes turn-tracking, event
 * forwarding, or the spawn-replacement/kill semantics fails here —
 * independent of the real-wiring proof already provided by main.ts's
 * snapshot integration suites, which drive pty:write through the real ctx
 * built in main.ts.
 *
 * Each test calls registerPtyHandlers() fresh against the mocked ipcMain
 * (cleared in beforeEach), so getHandler always resolves the current test's
 * own registration despite ptyProcesses being a module-level map shared
 * across tests; killAllPty() in afterEach clears it between tests.
 *
 * Deliberately NOT covered here (unchanged, out of scope for #570): the
 * pty-spawn-guard allowlist matrix (pty-spawn.spec.ts) and detectBinary/
 * agent:detect/claude:detect (still in main.ts).
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { registerPtyHandlers, killAllPty, type PtyDeps } from '../ipc/pty.js'
import { ipcMain } from 'electron'
import type { PtySpawnOpts } from '../pty-spawn-guard.js'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { fakePtys, fakeSpawn } = vi.hoisted(() => {
  const fakePtys: Array<ReturnType<typeof makeFakePty>> = []
  function makeFakePty(pid: number) {
    return {
      pid,
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    }
  }
  const fakeSpawn = vi.fn(() => {
    const inst = makeFakePty(1000 + fakePtys.length)
    fakePtys.push(inst)
    return inst
  })
  return { fakePtys, fakeSpawn }
})

vi.mock('node-pty', () => ({ spawn: fakeSpawn }))
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

// A generic shell guaranteed to exist and resolve into the guard's allowlist
// on both macOS and Ubuntu CI (see pty-spawn.spec.ts for why /bin/bash, not
// /bin/sh or /bin/zsh).
const GENERIC_SHELL = '/bin/bash'

let vault: string

function opts(overrides: Partial<PtySpawnOpts> = {}): PtySpawnOpts {
  return {
    id: 'term-1',
    shell: GENERIC_SHELL,
    cwd: vault,
    cols: 80,
    rows: 24,
    args: [],
    ...overrides,
  }
}

function makeDeps(overrides: Partial<PtyDeps> = {}): PtyDeps {
  return {
    getActiveVaultPath: () => vault,
    getShellEnv: () => ({ PATH: process.env.PATH ?? '' }),
    getActiveTurnId: () => null,
    setActiveTurnId: vi.fn(),
    setLastPtyWriteAt: vi.fn(),
    scheduleTurnEnd: vi.fn(),
    cancelScheduledTurnEnd: vi.fn(),
    finalizeTurn: vi.fn(async () => {}),
    sendToRenderer: vi.fn(),
    ...overrides,
  }
}

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const calls = (ipcMain.handle as Mock).mock.calls
  const call = calls.find((c: unknown[]) => c[0] === channel)
  if (!call) throw new Error(`handler not registered: ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

beforeEach(async () => {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-pty-ipc-'))
  vault = await fs.realpath(raw)
  fakePtys.length = 0
  fakeSpawn.mockClear()
  ;(ipcMain.handle as Mock).mockClear()
})

afterEach(async () => {
  killAllPty()
  await fs.rm(vault, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// pty:spawn
// ---------------------------------------------------------------------------

describe('pty:spawn', () => {
  it('spawns via node-pty and returns the pid', async () => {
    registerPtyHandlers(makeDeps())

    const result = await getHandler('pty:spawn')(null, opts())

    expect(fakeSpawn).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ pid: fakePtys[0].pid })
  })

  it('throws MARVIN_OUTSIDE_VAULT when there is no active vault', async () => {
    registerPtyHandlers(makeDeps({ getActiveVaultPath: () => null }))

    await expect(getHandler('pty:spawn')(null, opts())).rejects.toThrow('MARVIN_OUTSIDE_VAULT')
    expect(fakeSpawn).not.toHaveBeenCalled()
  })

  it('replaces an existing pty for the same id via .kill(), NOT killProcessTree', async () => {
    // Pinned per #570: #561 (spawn-replacement should use killProcessTree) is
    // still open, so this call site's behavior is preserved unchanged, not fixed.
    registerPtyHandlers(makeDeps())
    const handler = getHandler('pty:spawn')

    await handler(null, opts({ id: 'term-1' }))
    const first = fakePtys[0]
    await handler(null, opts({ id: 'term-1' }))

    expect(first.kill).toHaveBeenCalledTimes(1)
    expect(fakeSpawn).toHaveBeenCalledTimes(2)
  })

  it('wraps a generic spawn failure in MARVIN_PTY_SPAWN_FAILED', async () => {
    fakeSpawn.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    registerPtyHandlers(makeDeps())

    await expect(getHandler('pty:spawn')(null, opts())).rejects.toThrow('MARVIN_PTY_SPAWN_FAILED')
  })

  it('onData stamps AI turn activity, mints a turn id if none active, and forwards data', async () => {
    const deps = makeDeps({ getActiveTurnId: () => null })
    registerPtyHandlers(deps)
    await getHandler('pty:spawn')(null, opts({ id: 'term-1' }))
    const [onDataCb] = fakePtys[0].onData.mock.calls[0]

    onDataCb('hello')

    expect(deps.setLastPtyWriteAt).toHaveBeenCalledWith(expect.any(Number))
    expect(deps.setActiveTurnId).toHaveBeenCalledWith(expect.any(String))
    const mintedTurnId = (deps.setActiveTurnId as Mock).mock.calls[0][0]
    expect(deps.scheduleTurnEnd).toHaveBeenCalledWith(vault, mintedTurnId)
    expect(deps.sendToRenderer).toHaveBeenCalledWith('pty:data:term-1', 'hello')
  })

  it('onData reuses the already-active turn id without minting a new one', async () => {
    const deps = makeDeps({ getActiveTurnId: () => 'turn-existing' })
    registerPtyHandlers(deps)
    await getHandler('pty:spawn')(null, opts({ id: 'term-1' }))
    const [onDataCb] = fakePtys[0].onData.mock.calls[0]

    onDataCb('hello')

    expect(deps.setActiveTurnId).not.toHaveBeenCalled()
    expect(deps.scheduleTurnEnd).toHaveBeenCalledWith(vault, 'turn-existing')
  })

  it('onExit forwards the exit code and, as the last pty with an active turn, finalizes immediately', async () => {
    const deps = makeDeps({ getActiveTurnId: () => 'turn-existing' })
    registerPtyHandlers(deps)
    await getHandler('pty:spawn')(null, opts({ id: 'term-1' }))
    const [onExitCb] = fakePtys[0].onExit.mock.calls[0]

    onExitCb({ exitCode: 0 })

    expect(deps.sendToRenderer).toHaveBeenCalledWith('pty:exit:term-1', 0)
    expect(deps.cancelScheduledTurnEnd).toHaveBeenCalledTimes(1)
    expect(deps.setActiveTurnId).toHaveBeenCalledWith(null)
    expect(deps.finalizeTurn).toHaveBeenCalledWith(vault, 'turn-existing')
  })

  it('onExit does not finalize when there is no active turn', async () => {
    const deps = makeDeps({ getActiveTurnId: () => null })
    registerPtyHandlers(deps)
    await getHandler('pty:spawn')(null, opts({ id: 'term-1' }))
    const [onExitCb] = fakePtys[0].onExit.mock.calls[0]

    onExitCb({ exitCode: 0 })

    expect(deps.finalizeTurn).not.toHaveBeenCalled()
    expect(deps.setActiveTurnId).toHaveBeenCalledWith(null)
  })

  it('onExit removes the pty from tracking so a later write/resize/kill for that id is a no-op', async () => {
    registerPtyHandlers(makeDeps())
    await getHandler('pty:spawn')(null, opts({ id: 'term-1' }))
    const [onExitCb] = fakePtys[0].onExit.mock.calls[0]
    onExitCb({ exitCode: 0 })

    const writeHandler = getHandler('pty:write')
    expect(() => writeHandler(null, 'term-1', 'data')).not.toThrow()
    expect(fakePtys[0].write).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// pty:write / pty:resize / pty:kill
// ---------------------------------------------------------------------------

describe('pty:write', () => {
  it('stamps turn activity, adopts/mints a turn id, and forwards the write', async () => {
    const deps = makeDeps({ getActiveTurnId: () => null })
    registerPtyHandlers(deps)
    await getHandler('pty:spawn')(null, opts({ id: 'term-1' }))

    getHandler('pty:write')(null, 'term-1', 'ls\n')

    expect(deps.setLastPtyWriteAt).toHaveBeenCalledWith(expect.any(Number))
    expect(deps.setActiveTurnId).toHaveBeenCalledWith(expect.any(String))
    expect(deps.scheduleTurnEnd).toHaveBeenCalled()
    expect(fakePtys[0].write).toHaveBeenCalledWith('ls\n')
  })
})

describe('pty:resize', () => {
  it('forwards cols/rows to the tracked pty', async () => {
    registerPtyHandlers(makeDeps())
    await getHandler('pty:spawn')(null, opts({ id: 'term-1' }))

    getHandler('pty:resize')(null, 'term-1', 100, 40)

    expect(fakePtys[0].resize).toHaveBeenCalledWith(100, 40)
  })
})

describe('pty:kill', () => {
  it('kills via .kill(), NOT killProcessTree, and untracks the id', async () => {
    // Pinned per #570: #561 (pty:kill should use killProcessTree) is still
    // open, so this handler's behavior is preserved unchanged, not fixed.
    registerPtyHandlers(makeDeps())
    await getHandler('pty:spawn')(null, opts({ id: 'term-1' }))

    getHandler('pty:kill')(null, 'term-1')

    expect(fakePtys[0].kill).toHaveBeenCalledTimes(1)
    getHandler('pty:resize')(null, 'term-1', 10, 10)
    expect(fakePtys[0].resize).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// killAllPty (teardownChildren's app-quit hook)
// ---------------------------------------------------------------------------

describe('killAllPty', () => {
  it('signals every tracked pty (process-tree kill) and clears tracking', async () => {
    registerPtyHandlers(makeDeps())
    await getHandler('pty:spawn')(null, opts({ id: 'term-1' }))
    await getHandler('pty:spawn')(null, opts({ id: 'term-2' }))
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)

    killAllPty()

    // killProcessTree signals each tracked pid directly via process.kill —
    // the process-tree-aware path teardownChildren relies on, distinct from
    // pty:kill's plain .kill() above.
    expect(killSpy).toHaveBeenCalledWith(fakePtys[0].pid, 'SIGKILL')
    expect(killSpy).toHaveBeenCalledWith(fakePtys[1].pid, 'SIGKILL')
    killSpy.mockRestore()

    getHandler('pty:resize')(null, 'term-1', 10, 10)
    expect(fakePtys[0].resize).not.toHaveBeenCalled()
  })
})
