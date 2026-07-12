/**
 * Regression test for issue #566 — proves the fire-and-forget link rewrite
 * triggered by path:rename still produces correct output: both
 * `[text](href)`-style links and `[[wikilinks]]` referencing the renamed file
 * get rewritten to point at its new name. Uses the REAL snapshot.js (no
 * gating) — path-rename-nonblocking.spec.ts covers the non-blocking timing
 * separately, with writeSnapshot gated; this file is the "does it produce
 * the right answer, eventually" half of AC #6.
 *
 * Since the rewrite is fire-and-forget, this polls for the eventual result
 * with vi.waitFor rather than asserting synchronously after path:rename
 * resolves.
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
import { listForFile } from '../snapshot.js'
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
const pathRename = getHandler('path:rename')

async function pickAndWatch(vaultDir: string): Promise<void> {
  vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
    canceled: false,
    filePaths: [vaultDir],
  } as Electron.OpenDialogReturnValue)
  await vaultPick(undefined)
  await vaultWatch(undefined, vaultDir)
}

let userDataDir: string

beforeEach(async () => {
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-rename-rewrite-userdata-'))
  vi.mocked(app.getPath).mockReturnValue(userDataDir)
})

afterEach(async () => {
  await vaultWatch(undefined, null)
  await fs.rm(userDataDir, { recursive: true, force: true })
})

describe('path:rename — link rewrite correctness (#566)', () => {
  it('rewrites both a markdown link and a wikilink referencing the renamed file', async () => {
    const vaultDir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-rename-rewrite-'))
    )
    try {
      await pickAndWatch(vaultDir)

      const oldPath = path.join(vaultDir, 'notes.md')
      const newPath = path.join(vaultDir, 'renamed-notes.md')
      const referrerPath = path.join(vaultDir, 'referrer.md')
      await fs.writeFile(oldPath, '# Notes', 'utf8')
      await fs.writeFile(referrerPath, 'See [notes](notes.md) and [[notes]] for details.', 'utf8')

      const result = await pathRename(undefined, oldPath, newPath)
      expect(result).toBe(newPath)

      await vi.waitFor(
        async () => {
          const content = await fs.readFile(referrerPath, 'utf8')
          expect(content).toBe('See [notes](renamed-notes.md) and [[renamed-notes]] for details.')
        },
        { timeout: 2000, interval: 20 }
      )

      // A cascade snapshot of referrer.md's pre-rewrite content must exist —
      // the rewrite must not have clobbered it without snapshotting first.
      const turns = await listForFile(vaultDir, 'referrer.md')
      expect(turns).toHaveLength(1)
      expect(turns[0].trigger).toBe('cascade')
    } finally {
      await fs.rm(vaultDir, { recursive: true, force: true })
    }
  })
})
