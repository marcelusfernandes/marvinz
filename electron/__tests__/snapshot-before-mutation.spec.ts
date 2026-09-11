/**
 * Direct unit coverage for the snapshotBeforeMutation helper extracted in
 * #569 — complements the existing integration coverage for its three call
 * sites (file:write, path:rename, the watcher's snapshotExternalChange) in
 * snapshot.spec.ts, snapshot-user-integration.spec.ts, and
 * watcher-snapshot-content-guard.spec.ts, which continue to pass unmodified
 * and are the primary regression net for this refactor (see #569 issue AC).
 *
 * Same technique as file-write-noop-snapshot.spec.ts: mock 'electron', side-
 * effect-import electron/main.ts, and drive the real vault:pick/vault:watch/
 * pty:write handlers to control the module-private activeVaultPath/
 * lastPtyWriteAt state that snapshotBeforeMutation reads.
 *
 * NOT covered here: whether a no-op call (readBefore resolving to null)
 * silently adopts activeTurnId when none was active yet. That quirk is
 * preserved deliberately (turnId adoption happens before readBefore() runs,
 * matching every original call site — see the comment on
 * snapshotBeforeMutation in electron/main.ts), but it has no on-disk
 * footprint by itself (a no-op call never writes a manifest either way), so
 * it can't be discriminated by a black-box test against listTurns/
 * listForFile — asserting it here would be test theater. The verification
 * for that specific ordering is the code itself: adoption textually precedes
 * the readBefore() call in the helper, structurally identical to all three
 * original inlined copies.
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
import { snapshotBeforeMutation } from '../main.js'
import '../main.js' // side-effect import — registers the real ipcMain.handle callbacks

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

let vaultDir: string
let userDataDir: string

async function setup(): Promise<void> {
  vaultDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-snap-helper-')))
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-snap-helper-userdata-'))

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

// Stamps lastPtyWriteAt via the real pty:write handler — same technique as
// file-write-noop-snapshot.spec.ts. ptyProcesses has no entry for this id, so
// the optional-chained `.write()` inside it is a no-op.
async function stampAiTurnActive(): Promise<void> {
  await ptyWrite(undefined, 'snap-helper-spec-pty', '')
}

describe('snapshotBeforeMutation — direct unit coverage (#569)', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('does nothing when no AI turn is active (readBefore is never called, no snapshot)', async () => {
    const absPath = path.join(vaultDir, 'note.md')
    const readBefore = vi.fn(async () => 'should never be read')

    await snapshotBeforeMutation(absPath, 'file:write', () => true, readBefore)

    expect(readBefore).not.toHaveBeenCalled()
    expect(await listTurns(vaultDir)).toHaveLength(0)
  })

  it('does nothing when the precondition fails, even with an AI turn active', async () => {
    await stampAiTurnActive()
    const absPath = path.join(vaultDir, 'note.md')
    const readBefore = vi.fn(async () => 'should never be read')

    await snapshotBeforeMutation(absPath, 'file:write', () => false, readBefore)

    expect(readBefore).not.toHaveBeenCalled()
    expect(await listTurns(vaultDir)).toHaveLength(0)
  })

  it('writes a snapshot with the given source when the AI turn and precondition both hold', async () => {
    await stampAiTurnActive()
    const absPath = path.join(vaultDir, 'note.md')

    await snapshotBeforeMutation(
      absPath,
      'file:write',
      () => true,
      async () => 'before content'
    )

    const turns = await listForFile(vaultDir, 'note.md')
    expect(turns).toHaveLength(1)
    expect(turns[0].trigger).toBe('file:write')
    expect(await readSnapshot(vaultDir, turns[0].turnId, 'note.md')).toBe('before content')
  })

  it('a second call during the same AI-active window reuses the same turnId (turn adoption/reuse)', async () => {
    await stampAiTurnActive()
    const pathA = path.join(vaultDir, 'a.md')
    const pathB = path.join(vaultDir, 'b.md')

    await snapshotBeforeMutation(
      pathA,
      'file:write',
      () => true,
      async () => 'a-before'
    )
    await snapshotBeforeMutation(
      pathB,
      'file:write',
      () => true,
      async () => 'b-before'
    )

    const turns = await listTurns(vaultDir)
    expect(turns).toHaveLength(1) // one turn, not two — the second call reused the adopted turnId

    const turnsForA = await listForFile(vaultDir, 'a.md')
    const turnsForB = await listForFile(vaultDir, 'b.md')
    expect(turnsForA[0].turnId).toBe(turnsForB[0].turnId)
  })

  it('readBefore resolving to null skips the snapshot without error', async () => {
    await stampAiTurnActive()
    const absPath = path.join(vaultDir, 'note.md')

    await expect(
      snapshotBeforeMutation(
        absPath,
        'file:write',
        () => true,
        async () => null
      )
    ).resolves.toBeUndefined()

    expect(await listTurns(vaultDir)).toHaveLength(0)
  })

  it('an error thrown by readBefore is caught and logged, not propagated', async () => {
    await stampAiTurnActive()
    const absPath = path.join(vaultDir, 'note.md')
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      snapshotBeforeMutation(
        absPath,
        'file:write',
        () => true,
        async () => {
          throw new Error('disk read failed')
        }
      )
    ).resolves.toBeUndefined()

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('file:write pre-mutation snapshot failed'),
      expect.objectContaining({ err: expect.any(Error) })
    )
    expect(await listTurns(vaultDir)).toHaveLength(0)

    consoleErrorSpy.mockRestore()
  })
})
