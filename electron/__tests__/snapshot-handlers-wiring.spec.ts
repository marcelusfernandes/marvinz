/**
 * Wiring test for electron/ipc/snapshot-handlers.ts's composition into
 * electron/main.ts (#577).
 *
 * The existing "rich" snapshot suite (snapshot.spec.ts, snapshot-user-
 * integration.spec.ts, snapshot-user-bucket.spec.ts, snapshot-before-
 * mutation.spec.ts, watcher-snapshot-content-guard.spec.ts, vault-switch-
 * state-reset.spec.ts) all continue to pass unmodified and remain the
 * primary net for electron/snapshot.ts's business logic — but NONE of them
 * drive a single snapshot:* IPC handler directly (confirmed by grep before
 * writing this file). Severing main.ts's registerSnapshotHandlers(...) call
 * left the entire 169-file repo suite green, the same false-green class QA
 * rejected in #571 and that #575's browser-handlers-wiring.spec.ts closed
 * for the browser slice. This file is that spec for the snapshot slice —
 * added proactively per the team lead's #575 lesson, not after a QA bounce.
 *
 * Same technique as #536/#568/#575: mock 'electron'/'chokidar', side-effect-
 * import electron/main.ts to capture the REAL ipcMain.handle callbacks, and
 * drive vault:pick/vault:watch to set up a real activeVaultPath (same
 * bootstrap as snapshot-before-mutation.spec.ts) so every ctx-touching path
 * (getActiveVaultPath, assertInVault, activeTurnId adoption, notifyTree)
 * resolves against real main.ts state, not a fake ctx.
 *
 * Known thin spot (not this issue's scope): deleteFileCacheEntry is exercised
 * insofar as restoreOne/restore complete without throwing when it's called,
 * but fileContentCache isn't a file:read read-through cache — it's the
 * chokidar watcher's "before" baseline for external-change detection
 * (main.ts's snapshotExternalChange). Asserting the watcher-interplay effect
 * of a restore's cache-delete would mean driving the mocked watcher's
 * 'change' callback, which tests #569's pre-existing watcher behavior, not
 * this move. Left to the existing watcher-snapshot-content-guard.spec.ts net.
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
import '../main.js' // side-effect import — registers the real ipcMain.handle callbacks

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown
type Envelope<T = unknown> = { ok: true; data: T } | { ok: false; error: string }

function getHandler(channel: string): IpcHandler {
  const calls = vi.mocked(ipcMain.handle).mock.calls
  const found = calls.find(([ch]) => ch === channel)
  if (!found) throw new Error(`ipcMain.handle was never called for channel "${channel}"`)
  return found[1] as IpcHandler
}

const SNAPSHOT_CHANNELS = [
  'snapshot:listTurns',
  'snapshot:listForFile',
  'snapshot:read',
  'snapshot:restore',
  'snapshot:saveBuffer',
  'snapshot:saveExternalChange',
  'snapshot:capture',
  'snapshot:restoreOne',
] as const

const vaultPick = getHandler('vault:pick')
const vaultWatch = getHandler('vault:watch')
const listTurns = getHandler('snapshot:listTurns')
const listForFile = getHandler('snapshot:listForFile')
const readSnapshotH = getHandler('snapshot:read')
const saveBuffer = getHandler('snapshot:saveBuffer')
const capture = getHandler('snapshot:capture')
const restoreOne = getHandler('snapshot:restoreOne')

let vaultDir: string
let userDataDir: string

async function setup(): Promise<void> {
  vaultDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-snap-wiring-')))
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-snap-wiring-userdata-'))

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

describe('electron/ipc/snapshot-handlers.ts wiring into main.ts (#577)', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('registers ipcMain.handle for every snapshot:* channel', () => {
    // Exactly the assertion that would have caught the gap proved by
    // experiment: stubbing out registerSnapshotHandlers() in main.ts left
    // the whole repo suite green.
    for (const channel of SNAPSHOT_CHANNELS) {
      expect(() => getHandler(channel)).not.toThrow()
    }
  })

  it('snapshot:saveBuffer adopts and persists activeTurnId through the real ctx', async () => {
    const result1 = (await saveBuffer(undefined, 'note.md', 'v1')) as Envelope<{
      turnId: string
      saved: boolean
    }>
    expect(result1.ok).toBe(true)
    if (!result1.ok) return
    const turnId1 = result1.data.turnId

    // A second save with no intervening turn-end must reuse the SAME
    // activeTurnId — only observable if getActiveTurnId/setActiveTurnId
    // resolve against the real main.ts closure, not a disconnected fake ctx.
    const result2 = (await saveBuffer(undefined, 'note.md', 'v2')) as Envelope<{
      turnId: string
      saved: boolean
    }>
    expect(result2.ok).toBe(true)
    if (!result2.ok) return
    expect(result2.data.turnId).toBe(turnId1)

    const turnsResult = (await listTurns(undefined)) as Envelope<
      { turnId: string; timestamp: string }[]
    >
    expect(turnsResult.ok).toBe(true)
    if (!turnsResult.ok) return
    expect(turnsResult.data.map((t) => t.turnId)).toContain(turnId1)

    const listResult = (await listForFile(undefined, 'note.md')) as Envelope<{ turnId: string }[]>
    expect(listResult.ok).toBe(true)
    if (!listResult.ok) return
    expect(listResult.data.some((t) => t.turnId === turnId1)).toBe(true)

    // buffer-save overwrites the same turn's snapshot entry with the latest
    // buffer content on each call (progressive save, not per-call history) —
    // so the second save's content ('v2') is what's on record for this turn.
    const readResult = (await readSnapshotH(undefined, turnId1, 'note.md')) as Envelope<string>
    expect(readResult).toEqual({ ok: true, data: 'v2' })
  })

  it('snapshot:capture resolves assertInVault against the real active vault and rejects paths outside it', async () => {
    const inVaultPath = path.join(vaultDir, 'captured.md')
    await fs.writeFile(inVaultPath, '# captured', 'utf8')

    const captureResult = (await capture(undefined, {
      paths: [inVaultPath],
      trigger: 'user-overwrite',
    })) as Envelope<{ snapshotId: string }>
    expect(captureResult.ok).toBe(true)

    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-snap-wiring-outside-'))
    const outsidePath = path.join(outsideDir, 'outside.md')
    await fs.writeFile(outsidePath, '# outside', 'utf8')
    try {
      const rejected = (await capture(undefined, {
        paths: [outsidePath],
        trigger: 'user-overwrite',
      })) as Envelope
      // Defense-in-depth: captureUserSnapshot (electron/snapshot.ts) has its
      // own independent assertInsideVaultAsync check, so this passes even if
      // ctx.assertInVault itself were a no-op — confirmed by temporarily
      // wiring assertInVault to an identity function during review. This
      // test verifies the issue's AC end-to-end (paths outside the vault are
      // rejected), not that this specific ctx field is what catches it.
      expect(rejected.ok).toBe(false)
      if (!rejected.ok) expect(rejected.error).toMatch(/^MARVIN_/)
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true })
    }
  })

  it('snapshot:restoreOne restores real file content from a captured snapshot', async () => {
    const target = path.join(vaultDir, 'restore-me.md')
    await fs.writeFile(target, 'original content', 'utf8')
    const captureResult = (await capture(undefined, {
      paths: [target],
      trigger: 'user-overwrite',
    })) as Envelope<{ snapshotId: string }>
    expect(captureResult.ok).toBe(true)
    if (!captureResult.ok) return

    await fs.writeFile(target, 'modified content', 'utf8')

    const restoreResult = (await restoreOne(undefined, {
      snapshotId: captureResult.data.snapshotId,
    })) as Envelope<Record<string, never>>
    expect(restoreResult).toEqual({ ok: true, data: {} })

    const restoredContent = await fs.readFile(target, 'utf8')
    expect(restoredContent).toBe('original content')
  })
})
