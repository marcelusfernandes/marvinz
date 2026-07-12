/**
 * Regression tests for issue #535 (sub-issue 1/3 of #531).
 *
 * Bug: the `file:write` IPC handler (electron/main.ts ~855-874) snapshots the
 * pre-write disk content whenever an AI turn is active, unconditionally — with
 * no `before === content` comparison. A no-op write (identical content) still
 * creates a snapshot, which makes the turn manifest non-empty and fires the
 * "Claude modified <file>" toast (finalizeTurn, electron/main.ts:122-137) even
 * though nothing actually changed.
 *
 * `file:write` is not exported, so — same technique as fs-error-sanitize.spec.ts
 * and app-menu-template.spec.ts — 'electron' is mocked and electron/main.ts is
 * imported for its side effects. Every `ipcMain.handle(channel, fn)` call at
 * module scope registers `fn` on the mocked `ipcMain.handle`, so the REAL
 * handler implementations are captured and invoked directly below (no
 * hand-copied mirror of the handler logic).
 *
 * To reach the "AI turn active" branch we drive the real handlers that back
 * the module-private state the bug depends on:
 *   - vault:pick + vault:watch → activeVaultPath
 *   - pty:write                → lastPtyWriteAt (stamped synchronously; the
 *     Map lookup for the pty id is empty, so no real pty is spawned/touched)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

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

// Chokidar is mocked so vault:watch registers listeners on an inert fake
// watcher: these tests target the file:write handler only, and a REAL watcher
// races with them — its 'change' event for the test's own write lands
// asynchronously and (via snapshotExternalChange) can record a second,
// post-write snapshot for the same file, flaking the regression assertion on
// fast CI runners (observed on ubuntu-latest). Same pattern as
// watcher-snapshot-content-guard.spec.ts (#536).
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
const fileWrite = getHandler('file:write')

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let vaultDir: string
let userDataDir: string

async function setup(): Promise<void> {
  vaultDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-noop-write-')))
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-noop-write-userdata-'))

  vi.mocked(app.getPath).mockReturnValue(userDataDir)
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({
    canceled: false,
    filePaths: [vaultDir],
  } as Electron.OpenDialogReturnValue)

  // vault:pick adds vaultDir to the in-process allowlist (required by vault:watch).
  await vaultPick(undefined)
  // vault:watch sets activeVaultPath (the chokidar watcher is a mock — inert).
  await vaultWatch(undefined, vaultDir)
}

async function teardown(): Promise<void> {
  // Closes the (mock) watcher started above and resets activeVaultPath.
  await vaultWatch(undefined, null)
  await fs.rm(vaultDir, { recursive: true, force: true })
  await fs.rm(userDataDir, { recursive: true, force: true })
}

async function writeVaultFile(relPath: string, content: string): Promise<void> {
  await fs.writeFile(path.join(vaultDir, relPath), content, 'utf8')
}

// Stamps lastPtyWriteAt = Date.now() via the real pty:write handler, so the
// handler's `aiActive` check reads true. ptyProcesses has no entry for this id,
// so the optional-chained `.write()` call is a no-op — no real pty involved.
async function stampAiTurnActive(): Promise<void> {
  await ptyWrite(undefined, 'noop-write-spec-pty', '')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('file:write — snapshot skip on no-op write during an AI turn (#535)', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('RED: a write with content identical to disk creates no snapshot', async () => {
    await writeVaultFile('note.md', 'unchanged content')
    await stampAiTurnActive()

    const absPath = path.join(vaultDir, 'note.md')
    await fileWrite(undefined, absPath, 'unchanged content')

    // Desired (post-fix) contract: no snapshot recorded for this file...
    // this is the deterministic revert-guard for this test — it fails today
    // (RED) and flips green once the handler skips the snapshot.
    expect(await listForFile(vaultDir, 'note.md')).toHaveLength(0)
    // ...and no turn manifest materializes at all — the handler shouldn't
    // create a turn directory just to record a no-op (this is also the
    // "toast evidence stays empty" acceptance criterion: finalizeTurn sends
    // manifest.files to the renderer, and an empty listTurns means no files).
    // Note: this assertion does NOT cover the watcher path (#536) — chokidar
    // events land asynchronously, after these assertions run, so a spurious
    // mtime-triggered snapshot from snapshotExternalChange wouldn't show up
    // here even if it existed.
    expect(await listTurns(vaultDir)).toHaveLength(0)

    expect(await fs.readFile(absPath, 'utf8')).toBe('unchanged content')
  })

  it('GREEN (regression): a write with different content still snapshots the pre-write content', async () => {
    await writeVaultFile('note.md', 'before content')
    await stampAiTurnActive()

    const absPath = path.join(vaultDir, 'note.md')
    await fileWrite(undefined, absPath, 'after content')

    const turnsForFile = await listForFile(vaultDir, 'note.md')
    expect(turnsForFile).toHaveLength(1)
    expect(turnsForFile[0].trigger).toBe('file:write')

    const snapped = await readSnapshot(vaultDir, turnsForFile[0].turnId, 'note.md')
    expect(snapped).toBe('before content')

    expect(await fs.readFile(absPath, 'utf8')).toBe('after content')
  })

  it('CHARACTERIZATION (net for #569 refactor): a no-op write never calls fs.writeFile', async () => {
    // The existing no-op test above only checks the file's final content,
    // which reads the same whether fs.writeFile ran with identical content or
    // was skipped entirely — it can't distinguish the two. This spies on the
    // real fs.writeFile directly, pinning the "skip the write itself" half of
    // the no-op contract that #569's refactor must not regress.
    await writeVaultFile('note.md', 'stable content')
    await stampAiTurnActive()

    const absPath = path.join(vaultDir, 'note.md')
    const writeFileSpy = vi.spyOn(fs, 'writeFile')
    try {
      await fileWrite(undefined, absPath, 'stable content')
      expect(writeFileSpy).not.toHaveBeenCalled()
    } finally {
      writeFileSpy.mockRestore()
    }
  })
})
