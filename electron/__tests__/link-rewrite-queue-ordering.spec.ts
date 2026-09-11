/**
 * Regression test for issue #566 — proves two renames fired back-to-back
 * (before the first one's rewrite has finished) don't race each other over a
 * shared referrer file.
 *
 * Without serialization, both rewrites independently read the SAME original
 * referrer content, each computes its own rewrite, and whichever fs.writeFile
 * lands second silently clobbers the other — one of the two renames' link
 * updates is lost. enqueueLinkRewrite serializes all rewrite passes onto a
 * single chained promise, so the second rename's walk only starts once the
 * first's writes have fully landed, and it reads the already-updated content
 * as its own "original" — both updates survive.
 *
 * This is a real-timing test (not gated): the two path:rename calls are
 * fired without awaiting between them, so their rewrite passes have a
 * realistic chance to genuinely overlap. The queue's serialization is also a
 * structural guarantee (a single chained `linkRewriteQueue` promise — see
 * enqueueLinkRewrite in electron/ipc/fs-handlers.ts), not solely established
 * by this test; this test is the empirical check on top of that structural
 * guarantee.
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
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-rewrite-queue-userdata-'))
  vi.mocked(app.getPath).mockReturnValue(userDataDir)
})

afterEach(async () => {
  await vaultWatch(undefined, null)
  await fs.rm(userDataDir, { recursive: true, force: true })
})

describe('enqueueLinkRewrite — serializes overlapping rewrites (#566)', () => {
  it('does not lose either rewrite when two renames fire before the first one finishes', async () => {
    const vaultDir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-rewrite-queue-'))
    )
    try {
      await pickAndWatch(vaultDir)

      const fileA = path.join(vaultDir, 'file-a.md')
      const fileB = path.join(vaultDir, 'file-b.md')
      const fileARenamed = path.join(vaultDir, 'file-a-renamed.md')
      const fileBRenamed = path.join(vaultDir, 'file-b-renamed.md')
      const referrerPath = path.join(vaultDir, 'referrer.md')

      await fs.writeFile(fileA, '# A', 'utf8')
      await fs.writeFile(fileB, '# B', 'utf8')
      await fs.writeFile(referrerPath, 'Links: [[file-a]] and [[file-b]].', 'utf8')

      // Fire both renames without awaiting between them — their fire-and-forget
      // rewrites must be serialized by enqueueLinkRewrite, not race each other.
      const rename1 = pathRename(undefined, fileA, fileARenamed)
      const rename2 = pathRename(undefined, fileB, fileBRenamed)
      await Promise.all([rename1, rename2])

      await vi.waitFor(
        async () => {
          const content = await fs.readFile(referrerPath, 'utf8')
          expect(content).toBe('Links: [[file-a-renamed]] and [[file-b-renamed]].')
        },
        { timeout: 2000, interval: 20 }
      )
    } finally {
      await fs.rm(vaultDir, { recursive: true, force: true })
    }
  })
})
