/**
 * Regression tests for issue #536 (sub-issue 2/3 of #531).
 *
 * Bug: `snapshotExternalChange` (electron/main.ts ~748-786), invoked from the
 * chokidar `change` listener registered in `vault:watch`, snapshots the
 * pre-change content unconditionally whenever an AI turn is active:
 *   1. `if (!before)` treats a cached EMPTY STRING the same as a cache miss,
 *      so an empty-file baseline is wrongly discarded.
 *   2. On a real cache miss it falls back to reading the file from disk —
 *      but the watcher fires AFTER the write lands, so that read already
 *      returns post-change content (the code's own warning says so).
 *   3. `writeSnapshot` is called regardless of whether content actually
 *      changed, so a spurious `change` event (e.g. an editor save with no
 *      diff) still creates a turn manifest entry and would surface as
 *      "Claude modified <file>" toast evidence.
 *
 * Same technique as file-write-noop-snapshot.spec.ts (#535): mock 'electron'
 * and side-effect-import electron/main.ts so `ipcMain.handle` captures the
 * REAL handler implementations. Additionally mock 'chokidar' so `vault:watch`
 * registers its `change` listener on a fake watcher we control — this lets
 * tests invoke that listener directly and deterministically instead of
 * waiting on real filesystem watch events (which are inherently racy).
 *
 * The listener itself is fire-and-forget (`snapshotExternalChange(p).catch(...)`
 * is not awaited by the caller), so there's no promise to await after invoking
 * it. Tests use `vi.waitFor` to poll for the resulting snapshot state:
 *   - positive tests (B, D) poll until the expected manifest entry appears
 *   - negative tests (A, C) poll a bounded window and expect the poll to
 *     time out, proving the entry never appears — real fs I/O here settles
 *     in low single-digit ms, so a few-hundred-ms window is generous, not a
 *     bare sleep.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing electron/main.ts
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: { getPath: vi.fn(), on: vi.fn(), whenReady: vi.fn(() => ({ then: vi.fn() })) },
  BrowserWindow: vi.fn(),
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
// pull the recorded 'change' callback out and invoke it directly.
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
import { listTurns, listForFile, readSnapshot } from '../snapshot.js'
import '../main.js' // side-effect import — registers the real ipcMain.handle callbacks

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

type WatcherMock = { on: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }

// Pulls the 'change' listener registered on the most recently created fake
// watcher (i.e. the one created by the vault:watch call in this test's setup).
function getChangeListener(): (p: string) => void {
  const watchMock = vi.mocked(chokidar.watch)
  const results = watchMock.mock.results
  const last = results[results.length - 1]
  if (!last || last.type !== 'return') throw new Error('chokidar.watch was never called')
  const watcher = last.value as unknown as WatcherMock
  const call = watcher.on.mock.calls.find(([event]) => event === 'change')
  if (!call) throw new Error("watcher.on('change', ...) was never registered")
  return call[1] as (p: string) => void
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let vaultDir: string
let userDataDir: string

async function setup(): Promise<void> {
  vaultDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-watcher-guard-')))
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-watcher-guard-userdata-'))

  vi.mocked(app.getPath).mockReturnValue(userDataDir)
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({
    canceled: false,
    filePaths: [vaultDir],
  } as Electron.OpenDialogReturnValue)

  await vaultPick(undefined)
  await vaultWatch(undefined, vaultDir)
}

async function teardown(): Promise<void> {
  await vaultWatch(undefined, null)
  await fs.rm(vaultDir, { recursive: true, force: true })
  await fs.rm(userDataDir, { recursive: true, force: true })
}

async function writeVaultFile(relPath: string, content: string): Promise<void> {
  await fs.writeFile(path.join(vaultDir, relPath), content, 'utf8')
}

// Stamps lastPtyWriteAt = Date.now() via the real pty:write handler so the
// watcher's `aiActive` check reads true. ptyProcesses has no entry for this
// id, so the optional-chained `.write()` call inside it is a no-op.
async function stampAiTurnActive(): Promise<void> {
  await ptyWrite(undefined, 'watcher-guard-spec-pty', '')
}

// Populates fileContentCache[absPath] = content via the real file:read handler.
async function primeCache(relPath: string): Promise<void> {
  await fileRead(undefined, path.join(vaultDir, relPath))
}

// Waits until a manifest entry for relPath appears (positive assertion).
async function waitForSnapshotEntry(relPath: string, timeout = 2000) {
  await vi.waitFor(
    async () => {
      const turns = await listForFile(vaultDir, relPath)
      expect(turns.length).toBeGreaterThan(0)
    },
    { timeout, interval: 20 }
  )
  return listForFile(vaultDir, relPath)
}

// Proves NO manifest entry ever appears for relPath within a bounded window.
async function expectNoSnapshotEntry(relPath: string, timeout = 400) {
  let appeared = false
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
// Tests
// ---------------------------------------------------------------------------

describe('watcher change — snapshot content guard (#536)', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('RED: unchanged content (cache hit) during an AI turn creates no snapshot', async () => {
    await writeVaultFile('note.md', 'stable content')
    await primeCache('note.md')
    await stampAiTurnActive()

    // Simulate a spurious editor save / mtime-only touch: same bytes rewritten.
    await writeVaultFile('note.md', 'stable content')

    getChangeListener()(path.join(vaultDir, 'note.md'))

    await expectNoSnapshotEntry('note.md')
    // No turn manifest should materialize at all for a no-op change.
    expect(await listTurns(vaultDir)).toHaveLength(0)
  })

  it('GREEN (regression): real content change (cache hit) still snapshots the cached before-content', async () => {
    await writeVaultFile('note.md', 'before content')
    await primeCache('note.md')
    await stampAiTurnActive()

    await writeVaultFile('note.md', 'after content')

    getChangeListener()(path.join(vaultDir, 'note.md'))

    const turns = await waitForSnapshotEntry('note.md')
    expect(turns).toHaveLength(1)
    expect(turns[0].trigger).toBe('watcher')

    const snapped = await readSnapshot(vaultDir, turns[0].turnId, 'note.md')
    expect(snapped).toBe('before content')
  })

  it('RED: cache miss does not surface as turn-toast evidence (no manifest entry)', async () => {
    // Never primed via file:read — a genuine cache miss, e.g. a file Claude
    // created and edited entirely through the PTY without ever being opened
    // in the editor.
    await writeVaultFile('external.md', 'content written without a prior file:read')
    await stampAiTurnActive()

    getChangeListener()(path.join(vaultDir, 'external.md'))

    await expectNoSnapshotEntry('external.md')
    expect(await listTurns(vaultDir)).toHaveLength(0)
  })

  it('RED: a cached EMPTY STRING is a valid baseline, not a cache miss', async () => {
    await writeVaultFile('empty.md', '')
    await primeCache('empty.md') // caches '' — must NOT be treated as a cache miss
    await stampAiTurnActive()

    await writeVaultFile('empty.md', 'now has content')

    getChangeListener()(path.join(vaultDir, 'empty.md'))

    const turns = await waitForSnapshotEntry('empty.md')
    expect(turns).toHaveLength(1)

    // Desired: the true empty-string baseline from the cache.
    // Today (buggy): `if (!before)` treats '' as a cache miss and falls back
    // to a post-write disk read, so this reads back 'now has content' instead.
    const snapped = await readSnapshot(vaultDir, turns[0].turnId, 'empty.md')
    expect(snapped).toBe('')
  })
})
