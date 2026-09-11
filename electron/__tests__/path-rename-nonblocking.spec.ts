/**
 * Regression test for issue #566 — proves path:rename's IPC response does
 * NOT wait for the full-vault link-rewrite walk to finish.
 *
 * A pure timing race (assert the referrer file is unchanged "immediately"
 * after path:rename resolves) would be flaky: real fs I/O for a tiny test
 * vault can complete fast enough that the race is unobservable either way.
 * Instead, this gates the ONE async call inside rewriteLinksAfterMoveBatch
 * that every rewritten file must pass through — writeSnapshot (the cascade
 * snapshot taken before a file's content is overwritten) — behind a promise
 * this test controls. While the gate is held, the rewrite pass is
 * deterministically parked, so if path:rename's response has already
 * resolved and the referrer file is provably still unchanged, path:rename
 * cannot have waited for the rewrite.
 *
 * writeSnapshot is also called (unconditionally-gated by AI-turn state) as a
 * PRE-rename snapshot of the source file itself, inside the same handler,
 * awaited BEFORE fs.rename. If that branch fired while writeSnapshot is
 * gated, the handler itself would deadlock. This test never stamps an AI
 * turn (no pty:write call), so lastPtyWriteAt stays 0 and that branch is
 * skipped — the cascade rewrite is the only writeSnapshot call in play.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// ---------------------------------------------------------------------------
// Gate — controls when the mocked writeSnapshot resolves.
// ---------------------------------------------------------------------------

const gateState = vi.hoisted(() => {
  let release: (() => void) | null = null
  const state = {
    promise: Promise.resolve() as Promise<void>,
    arm(): void {
      state.promise = new Promise<void>((resolve) => {
        release = resolve
      })
    },
    release(): void {
      release?.()
      release = null
    },
  }
  return state
})

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

// Real snapshot.js behavior, except writeSnapshot is gated: it awaits
// gateState.promise before delegating to the real implementation, so the
// caller (rewriteLinksAfterMoveBatch) is provably parked until released.
vi.mock('../snapshot.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../snapshot.js')>()
  return {
    ...actual,
    writeSnapshot: vi.fn(async (...args: Parameters<typeof actual.writeSnapshot>) => {
      await gateState.promise
      return actual.writeSnapshot(...args)
    }),
  }
})

import { app, dialog, ipcMain } from 'electron'
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
const pathRename = getHandler('path:rename')

async function pickAndWatch(vaultDir: string): Promise<void> {
  vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
    canceled: false,
    filePaths: [vaultDir],
  } as Electron.OpenDialogReturnValue)
  await vaultPick(undefined)
  await vaultWatch(undefined, vaultDir)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let userDataDir: string

beforeEach(async () => {
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-rename-nonblocking-userdata-'))
  vi.mocked(app.getPath).mockReturnValue(userDataDir)
})

afterEach(async () => {
  gateState.release() // don't leak a held gate into the next test
  await vaultWatch(undefined, null)
  await fs.rm(userDataDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('path:rename — link rewrite does not block the IPC response (#566)', () => {
  it('resolves with safeNew while the fire-and-forget rewrite is still parked, then rewrites once released', async () => {
    const vaultDir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-rename-nonblocking-'))
    )
    try {
      await pickAndWatch(vaultDir)

      const oldPath = path.join(vaultDir, 'notes.md')
      const newPath = path.join(vaultDir, 'renamed-notes.md')
      const referrerPath = path.join(vaultDir, 'referrer.md')
      const originalReferrerContent = 'See [[notes]] for details.'
      await fs.writeFile(oldPath, '# Notes', 'utf8')
      await fs.writeFile(referrerPath, originalReferrerContent, 'utf8')

      gateState.arm() // park the cascade snapshot call before it can run

      const result = await pathRename(undefined, oldPath, newPath)
      expect(result).toBe(newPath)

      // The rewrite pass is deterministically parked behind the gated
      // writeSnapshot — referrer.md must still hold its ORIGINAL content.
      const referrerWhileGated = await fs.readFile(referrerPath, 'utf8')
      expect(referrerWhileGated).toBe(originalReferrerContent)

      gateState.release()

      await vi.waitFor(
        async () => {
          const content = await fs.readFile(referrerPath, 'utf8')
          expect(content).toBe('See [[renamed-notes]] for details.')
        },
        { timeout: 2000, interval: 20 }
      )
    } finally {
      await fs.rm(vaultDir, { recursive: true, force: true })
    }
  })
})
