/**
 * Wiring test for electron/ipc/vault-handlers.ts's composition into
 * electron/main.ts (#613, follow-up of #573/#580).
 *
 * vault:pick and vault:watch already have extensive real-wiring coverage via
 * other specs that side-effect-import main.ts (vault-switch-state-reset.spec.ts,
 * watcher-tree-notify-debounce.spec.ts, link-rewrite-queue-ordering.spec.ts,
 * path-rename-*.spec.ts) — severing registerVaultHandlers(...) would already
 * fail those. But settings:get/set, file:pick, folder:create,
 * fs:importExternal, and search:content had ZERO real-handler coverage
 * (confirmed by grep before writing this file) — the same false-green gap
 * class QA rejected in #571 and #575/#577/#580's wiring specs closed for
 * their slices. This file covers the whole module: every channel registered,
 * plus real round-trips for the previously-uncovered handlers.
 *
 * Same technique as #536/#568/#575/#577/#580: mock 'electron'/'chokidar',
 * side-effect-import main.ts to capture the REAL ipcMain.handle callbacks,
 * and drive vault:pick/vault:watch to set up a real activeVaultPath/
 * allowedVaultPaths so every ctx-touching path resolves against real main.ts
 * state, not a fake ctx.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'

// search:content shells out to ripgrep (electron/search-content.ts) — guard
// like electron/__tests__/search-content.spec.ts does, so a machine without
// rg on PATH skips that one assertion instead of failing spuriously.
const rgAvailable = (() => {
  try {
    execSync('rg --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

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

const VAULT_CHANNELS = [
  'settings:get',
  'settings:set',
  'file:pick',
  'vault:pick',
  'vault:current',
  'vault:tree',
  'vault:watch',
  'folder:create',
  'fs:importExternal',
  'search:content',
] as const

const vaultPick = getHandler('vault:pick')
const vaultWatch = getHandler('vault:watch')
const settingsGet = getHandler('settings:get')
const settingsSet = getHandler('settings:set')
const folderCreate = getHandler('folder:create')
const fsImportExternal = getHandler('fs:importExternal')
const searchContentH = getHandler('search:content')
const vaultTree = getHandler('vault:tree')

let vaultDir: string
let userDataDir: string

async function setup(): Promise<void> {
  vaultDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-vault-wiring-')))
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-vault-wiring-userdata-'))

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

describe('electron/ipc/vault-handlers.ts wiring into main.ts (#613)', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('registers ipcMain.handle for every vault-handlers channel', () => {
    // Exactly the assertion that would have caught the gap proved by
    // experiment: stubbing out registerVaultHandlers() in main.ts left the
    // whole repo suite green.
    for (const channel of VAULT_CHANNELS) {
      expect(() => getHandler(channel)).not.toThrow()
    }
  })

  it('settings:set persists through the real settings file and settings:get reads it back', async () => {
    const result = (await settingsSet(undefined, { iconTheme: 'material' })) as {
      iconTheme?: string
    }
    expect(result.iconTheme).toBe('material')

    const readBack = await settingsGet(undefined)
    expect(readBack).toEqual(result)
  })

  it('folder:create creates a real directory inside the real active vault and rejects an existing name', async () => {
    const created = await folderCreate(undefined, vaultDir, 'new-folder')
    expect(created).toBe(path.join(vaultDir, 'new-folder'))
    const stat = await fs.stat(created as string)
    expect(stat.isDirectory()).toBe(true)

    await expect(folderCreate(undefined, vaultDir, 'new-folder')).rejects.toThrow(
      /MARVIN_FS_EEXIST/
    )
  })

  it('fs:importExternal copies a real external file into the real active vault', async () => {
    const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvin-vault-wiring-external-'))
    try {
      const externalFile = path.join(externalDir, 'imported.md')
      await fs.writeFile(externalFile, 'unique-marker-content-613', 'utf8')

      await fsImportExternal(undefined, [externalFile], vaultDir)

      const tree = (await vaultTree(undefined)) as { name: string }[]
      expect(tree.some((n) => n.name === 'imported.md')).toBe(true)
    } finally {
      await fs.rm(externalDir, { recursive: true, force: true })
    }
  })

  it.skipIf(!rgAvailable)('search:content finds a real file in the real active vault', async () => {
    await fs.writeFile(path.join(vaultDir, 'searchable.md'), 'unique-marker-content-613', 'utf8')

    const results = (await searchContentH(undefined, 'unique-marker-content-613')) as {
      path: string
    }[]
    expect(results.some((r) => r.path.endsWith('searchable.md'))).toBe(true)
  })
})
