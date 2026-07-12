/**
 * Regression tests for issue #568 — exercises the REAL vault:watch/file:read/
 * file:write/pty:write wiring in electron/main.ts, not just the standalone
 * BoundedCache utility (bounded-cache.spec.ts). Without this, reverting
 * resetVaultSessionState's call sites or the BoundedCache wiring in main.ts
 * would leave the rest of the suite green.
 *
 * Same technique as watcher-tree-notify-debounce.spec.ts (#571) and
 * watcher-snapshot-content-guard.spec.ts (#536): mock 'electron'/'chokidar',
 * side-effect-import electron/main.ts to capture the real ipcMain.handle
 * callbacks, and drive them directly. BrowserWindow returns a full stub
 * instance and app.whenReady().then(cb) actually invokes cb, so `win` gets
 * set and webContents.send is observable.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing electron/main.ts
// ---------------------------------------------------------------------------

const { winStub } = vi.hoisted(() => {
  const webContentsStub = {
    send: vi.fn(),
    openDevTools: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    session: {
      setSpellCheckerEnabled: vi.fn(),
      setSpellCheckerLanguages: vi.fn(),
    },
    on: vi.fn(),
  }
  const winStub = {
    webContents: webContentsStub,
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn(),
    isDestroyed: vi.fn(() => false),
  }
  return { winStub }
})

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(),
    on: vi.fn(),
    whenReady: vi.fn(() => ({
      then: (cb: () => void) => {
        cb()
        return Promise.resolve()
      },
    })),
  },
  BrowserWindow: vi.fn(function () {
    return winStub
  }),
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  MenuItem: vi.fn(),
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  shell: { trashItem: vi.fn(), openExternal: vi.fn() },
  clipboard: {},
  WebContentsView: vi.fn(),
}))

vi.mock('chokidar', () => {
  function makeWatcher() {
    const watcher = {
      on: vi.fn((_event: string, _cb: (p: string) => void) => watcher),
      close: vi.fn(),
    }
    return watcher
  }
  return { default: { watch: vi.fn(() => makeWatcher()) } }
})

import { app, dialog, ipcMain } from 'electron'
import chokidar from 'chokidar'
import { listTurns, listForFile } from '../snapshot.js'
import '../main.js' // side-effect import — registers the real ipcMain.handle callbacks + runs app.whenReady()
import { FILE_CONTENT_CACHE_MAX_ENTRIES } from '../main.js'

// ---------------------------------------------------------------------------
// Capture the real handlers registered by electron/main.ts at import time.
// ---------------------------------------------------------------------------

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

function getHandler(channel: string): IpcHandler {
  const calls = vi.mocked(ipcMain.handle).mock.calls
  const found = calls.find(([ch]) => ch === channel)
  if (!found) throw new Error(`ipcMain.handle was never called for channel "${channel}"`)
  return found[1] as IpcHandler
}

const vaultPick = getHandler('vault:pick')
const vaultWatch = getHandler('vault:watch')
const ptyWrite = getHandler('pty:write')
const fileRead = getHandler('file:read')
const fileWrite = getHandler('file:write')

type WatcherMock = { on: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }

// Pulls a listener registered on the most recently created fake watcher.
function getListener(event: string): (p: string) => void {
  const watchMock = vi.mocked(chokidar.watch)
  const results = watchMock.mock.results
  const last = results[results.length - 1]
  if (!last || last.type !== 'return') throw new Error('chokidar.watch was never called')
  const watcher = last.value as unknown as WatcherMock
  const call = watcher.on.mock.calls.find(([e]) => e === event)
  if (!call) throw new Error(`watcher.on('${event}', ...) was never registered`)
  return call[1] as (p: string) => void
}

// Picks vaultDir via the mocked dialog, then watches it — mirrors the
// renderer's real vault-open flow (vault:pick populates the allowlist that
// vault:watch's assertAllowedVault requires).
async function pickAndWatch(vaultDir: string): Promise<void> {
  vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
    canceled: false,
    filePaths: [vaultDir],
  } as Electron.OpenDialogReturnValue)
  await vaultPick(undefined)
  await vaultWatch(undefined, vaultDir)
}

// Stamps lastPtyWriteAt = Date.now() (and arms turn-tracking) via the real
// pty:write handler. ptyProcesses has no entry for this id, so the
// optional-chained `.write()` call inside it is a no-op.
async function stampAiTurnActive(id: string): Promise<void> {
  await ptyWrite(undefined, id, '')
}

async function waitForSnapshotEntry(vaultDir: string, relPath: string, timeout = 2000) {
  await vi.waitFor(
    async () => {
      const turns = await listForFile(vaultDir, relPath)
      expect(turns.length).toBeGreaterThan(0)
    },
    { timeout, interval: 20 }
  )
  return listForFile(vaultDir, relPath)
}

async function expectNoSnapshotEntry(vaultDir: string, relPath: string, timeout = 400) {
  let appeared: boolean
  try {
    await vi.waitFor(
      async () => {
        const turns = await listForFile(vaultDir, relPath)
        if (turns.length === 0) throw new Error('no snapshot entry yet')
      },
      { timeout, interval: 20 }
    )
    appeared = true
  } catch {
    appeared = false
  }
  expect(appeared, `expected no snapshot entry for "${relPath}", but one was created`).toBe(false)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let userDataDir: string

beforeEach(async () => {
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-vault-switch-userdata-'))
  vi.mocked(app.getPath).mockReturnValue(userDataDir)
})

afterEach(async () => {
  await vaultWatch(undefined, null)
  await fs.rm(userDataDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('vault:watch — resets turn-tracking state on switch (#568)', () => {
  it('finalizes the old vault’s in-flight turn and does not reuse its turnId in the new vault', async () => {
    const vaultA = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-vault-switch-a-'))
    )
    const vaultB = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-vault-switch-b-'))
    )
    try {
      await pickAndWatch(vaultA)

      await fs.writeFile(path.join(vaultA, 'note.md'), 'before', 'utf8')
      await stampAiTurnActive('switch-spec-pty-a')
      await fileWrite(undefined, path.join(vaultA, 'note.md'), 'after')

      const beforeSwitch = await listTurns(vaultA)
      expect(beforeSwitch).toHaveLength(1)
      expect(beforeSwitch[0].status).toBe('active')
      const oldTurnId = beforeSwitch[0].turnId

      // Switch to a different vault while the turn above is still in-flight.
      await pickAndWatch(vaultB)

      const afterSwitch = await listTurns(vaultA)
      expect(afterSwitch).toHaveLength(1)
      expect(afterSwitch[0].turnId).toBe(oldTurnId)
      // finalizeTurn ran against the OLD vault before the switch completed.
      expect(afterSwitch[0].status).toBe('completed')

      // A file:write in the newly-adopted vault must not reuse oldTurnId.
      await fs.writeFile(path.join(vaultB, 'other.md'), 'foo', 'utf8')
      await stampAiTurnActive('switch-spec-pty-b')
      await fileWrite(undefined, path.join(vaultB, 'other.md'), 'bar')

      const turnsB = await listTurns(vaultB)
      expect(turnsB).toHaveLength(1)
      expect(turnsB[0].turnId).not.toBe(oldTurnId)
    } finally {
      await fs.rm(vaultA, { recursive: true, force: true })
      await fs.rm(vaultB, { recursive: true, force: true })
    }
  })
})

describe('vault:watch — clears fileContentCache on every switch (#568)', () => {
  it('clears the cache on re-watching the same vault path', async () => {
    const vaultDir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-vault-switch-cache-'))
    )
    try {
      await pickAndWatch(vaultDir)

      const filePath = path.join(vaultDir, 'note.md')
      await fs.writeFile(filePath, 'cached-before', 'utf8')
      await fileRead(undefined, filePath) // populates fileContentCache[filePath]

      // Re-watch the SAME vault path — this is the only black-box way to
      // observe cache-clear: the cache is keyed by absolute path, so a real
      // A→B switch can't distinguish "cleared" from "just a different key"
      // (vaultB has no file sharing vaultA's absolute path). Re-opening the
      // same path keeps the key identical across the reset, isolating the
      // clear itself.
      await pickAndWatch(vaultDir)

      // Stamp AI-turn-active AFTER the re-watch, not before: resetVaultSessionState
      // zeroes lastPtyWriteAt, so stamping first would make aiActive false and
      // snapshotExternalChange would early-return regardless of cache state,
      // making this assertion pass whether or not the cache was actually cleared.
      await stampAiTurnActive('switch-spec-cache-pty')

      await fs.writeFile(filePath, 'changed-after-rewatch', 'utf8')
      getListener('change')(filePath)

      // A still-cached 'cached-before' would diff against the new content and
      // write a snapshot. A cleared cache means a miss — no snapshot, just a
      // re-seed (see snapshotExternalChange's cache-miss branch).
      await expectNoSnapshotEntry(vaultDir, 'note.md')
    } finally {
      await fs.rm(vaultDir, { recursive: true, force: true })
    }
  })
})

describe('fileContentCache — bounded via LRU under real file:read calls (#568)', () => {
  it('evicts the least-recently-read file once the cap is exceeded, keeping the most recent', async () => {
    const vaultDir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-vault-switch-lru-'))
    )
    try {
      await pickAndWatch(vaultDir)

      // Read FILE_CONTENT_CACHE_MAX_ENTRIES + 1 distinct files through the
      // REAL file:read handler — proves the production wiring (not just the
      // standalone BoundedCache class) actually bounds the cache.
      const filePaths: string[] = []
      for (let i = 0; i <= FILE_CONTENT_CACHE_MAX_ENTRIES; i++) {
        const p = path.join(vaultDir, `file-${i}.md`)
        await fs.writeFile(p, `content-${i}`, 'utf8')
        filePaths.push(p)
      }
      for (const p of filePaths) {
        await fileRead(undefined, p)
      }

      await stampAiTurnActive('switch-spec-lru-pty')

      // file-0 was read first — it must have been evicted (LRU) once the
      // cap-th read (file-N) pushed the cache past its limit.
      const evictedPath = filePaths[0]
      await fs.writeFile(evictedPath, 'file-0-changed', 'utf8')
      getListener('change')(evictedPath)
      await expectNoSnapshotEntry(vaultDir, 'file-0.md')

      // The most-recently-read file must still be cached.
      const retainedPath = filePaths[filePaths.length - 1]
      const retainedRel = `file-${FILE_CONTENT_CACHE_MAX_ENTRIES}.md`
      await fs.writeFile(retainedPath, 'last-file-changed', 'utf8')
      getListener('change')(retainedPath)
      const turns = await waitForSnapshotEntry(vaultDir, retainedRel)
      expect(turns).toHaveLength(1)
    } finally {
      await fs.rm(vaultDir, { recursive: true, force: true })
    }
  }, 20000)
})
