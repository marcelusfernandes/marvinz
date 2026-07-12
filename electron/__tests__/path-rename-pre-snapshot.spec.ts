/**
 * Characterization test for path:rename's pre-rename snapshot behavior
 * (#569). Written before the snapshotBeforeMutation extraction to pin this
 * call site: snapshot.spec.ts's "rename hook snapshot" describe block only
 * simulates the handler's logic manually (calls writeSnapshot + fs.rename
 * directly) — it never drives the real path:rename IPC handler, so it can't
 * catch a regression in the actual wiring. This does, using the same
 * mock-electron + side-effect-import + capture-real-handlers technique as
 * file-write-noop-snapshot.spec.ts.
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
import { listForFile, listTurns, readSnapshot } from '../snapshot.js'
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
const pathRename = getHandler('path:rename')

let vaultDir: string
let userDataDir: string

async function setup(): Promise<void> {
  vaultDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-rename-presnap-')))
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-rename-presnap-userdata-'))

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

async function stampAiTurnActive(): Promise<void> {
  await ptyWrite(undefined, 'rename-presnap-spec-pty', '')
}

describe('path:rename — pre-rename snapshot (#569 characterization)', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('snapshots the source file content before renaming, when an AI turn is active', async () => {
    const oldPath = path.join(vaultDir, 'original.md')
    const newPath = path.join(vaultDir, 'renamed.md')
    await fs.writeFile(oldPath, 'pre-rename content', 'utf8')
    await stampAiTurnActive()

    const result = await pathRename(undefined, oldPath, newPath)
    expect(result).toBe(newPath)

    const turns = await listForFile(vaultDir, 'original.md')
    expect(turns).toHaveLength(1)
    // Preserved pre-existing mislabel (#569): trigger is 'file:write', not a
    // distinct 'path:rename' value — kept deliberately, see main.ts comment.
    expect(turns[0].trigger).toBe('file:write')
    expect(await readSnapshot(vaultDir, turns[0].turnId, 'original.md')).toBe('pre-rename content')

    // The rename itself still happened.
    await expect(fs.readFile(newPath, 'utf8')).resolves.toBe('pre-rename content')
    await expect(fs.access(oldPath)).rejects.toThrow()
  })

  it('does not snapshot when no AI turn is active', async () => {
    const oldPath = path.join(vaultDir, 'quiet.md')
    const newPath = path.join(vaultDir, 'quiet-renamed.md')
    await fs.writeFile(oldPath, 'content', 'utf8')

    const result = await pathRename(undefined, oldPath, newPath)
    expect(result).toBe(newPath)

    expect(await listTurns(vaultDir)).toHaveLength(0)
  })
})
