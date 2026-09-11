/**
 * Regression tests for issue #571 — this exercises the REAL watcher wiring in
 * electron/main.ts, not just the standalone debounce utility (debounce.spec.ts).
 * Without this, reverting the notifyTree debounce wrap in main.ts would leave
 * the whole suite green.
 *
 * Same technique as watcher-snapshot-content-guard.spec.ts (#536): mock
 * 'electron' and 'chokidar', side-effect-import electron/main.ts so
 * `ipcMain.handle` captures the REAL handler implementations, and pull the
 * chokidar event listeners registered by the real `vault:watch` handler off a
 * fake watcher we control.
 *
 * Additionally (needed here, not in #536): BrowserWindow returns a full stub
 * instance so `createWindow()` (called from the real `app.whenReady().then()`
 * callback, which this mock actually invokes) succeeds and sets the module's
 * `win`, making `win.webContents.send` spy-able — that's the channel
 * notifyTree pushes 'vault:changed' through.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing electron/main.ts
// ---------------------------------------------------------------------------

const { winStub, webContentsStub } = vi.hoisted(() => {
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
  return { winStub, webContentsStub }
})

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(),
    on: vi.fn(),
    // Real .then(cb) invocation (unlike other main.ts specs, which stub this
    // as a no-op) — createWindow() must actually run so `win` gets set.
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

// Fake chokidar watcher: `.on(event, cb)` records `cb` and returns `this` so
// the real `.on(...).on(...)` chaining in vault:watch keeps working. Tests
// pull a recorded listener out and invoke it directly.
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
import '../main.js' // side-effect import — registers the real ipcMain.handle callbacks + runs app.whenReady()

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

type WatcherMock = { on: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }

// Pulls a listener registered on the most recently created fake watcher (i.e.
// the one created by the vault:watch call in this test's setup).
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

function treeChangedEmissions(): number {
  return webContentsStub.send.mock.calls.filter(([channel]) => channel === 'vault:changed').length
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let vaultDir: string
let userDataDir: string

async function setup(): Promise<void> {
  vaultDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-tree-debounce-')))
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-tree-debounce-userdata-'))

  vi.mocked(app.getPath).mockReturnValue(userDataDir)
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({
    canceled: false,
    filePaths: [vaultDir],
  } as Electron.OpenDialogReturnValue)

  await vaultPick(undefined)
  await vaultWatch(undefined, vaultDir)
  webContentsStub.send.mockClear() // drop any noise from setup itself
}

async function teardown(): Promise<void> {
  vi.useRealTimers()
  await vaultWatch(undefined, null)
  await fs.rm(vaultDir, { recursive: true, force: true })
  await fs.rm(userDataDir, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('watcher wiring — notifyTree debounce (#571)', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('collapses a burst of structural events into a single vault:changed emission', () => {
    vi.useFakeTimers()
    const addListener = getListener('add')

    // Simulate a burst of 50 structural fs events (e.g. a `git checkout`),
    // each one resetting the trailing-edge timer.
    for (let i = 0; i < 50; i++) {
      addListener(path.join(vaultDir, `file-${i}.md`))
      vi.advanceTimersByTime(10) // well under the debounce window
    }
    expect(treeChangedEmissions()).toBe(0)

    // Burst settles.
    vi.advanceTimersByTime(250)

    expect(treeChangedEmissions()).toBe(1)
  })

  it('a mixed burst of add/unlink/addDir/unlinkDir events still collapses to one emission', () => {
    vi.useFakeTimers()
    const addListener = getListener('add')
    const unlinkListener = getListener('unlink')
    const addDirListener = getListener('addDir')
    const unlinkDirListener = getListener('unlinkDir')

    addListener(path.join(vaultDir, 'a.md'))
    vi.advanceTimersByTime(20)
    unlinkListener(path.join(vaultDir, 'b.md'))
    vi.advanceTimersByTime(20)
    addDirListener(path.join(vaultDir, 'sub'))
    vi.advanceTimersByTime(20)
    unlinkDirListener(path.join(vaultDir, 'old'))
    expect(treeChangedEmissions()).toBe(0)

    vi.advanceTimersByTime(250)

    expect(treeChangedEmissions()).toBe(1)
  })

  it('a single isolated structural event still updates the tree within the debounce window', () => {
    vi.useFakeTimers()
    const unlinkListener = getListener('unlink')

    unlinkListener(path.join(vaultDir, 'solo.md'))
    vi.advanceTimersByTime(250)

    expect(treeChangedEmissions()).toBe(1)
  })

  it('notifyTree.cancel() on watcher teardown suppresses a pending emission', async () => {
    vi.useFakeTimers()
    const addDirListener = getListener('addDir')

    addDirListener(path.join(vaultDir, 'newdir'))
    vi.advanceTimersByTime(50) // well inside the window — nothing fired yet
    expect(treeChangedEmissions()).toBe(0)

    // Switch away from the vault before the debounce settles.
    await vaultWatch(undefined, null)

    vi.advanceTimersByTime(500) // plenty of time for the original timer to have fired if not cancelled

    expect(treeChangedEmissions()).toBe(0)
  })
})
