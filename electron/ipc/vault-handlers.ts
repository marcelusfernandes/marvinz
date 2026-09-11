// vault:*/settings:*/file:pick/folder:create/fs:importExternal/search:content
// IPC handlers — vault selection/watch lifecycle, persisted app settings, and
// the handlers that only make sense once a vault is active. Extracted from
// main.ts (#613, follow-up of #573/#580); shared state main.ts still owns
// (activeVaultPath, the vault allowlist, the file-content cache, notifyTree,
// turn-tracking) flows in via `VaultHandlersCtx` rather than a circular
// import of main.js. `vaultWatcher` itself is owned locally by this module
// (mirrors electron/ipc/pty.ts's ptyProcesses) — `closeVaultWatcher` is
// exported for main.ts's teardownChildren, same as pty.ts's killAllPty.
// `assertInVault`/`wrapFsError` stay main.ts-owned (also used by
// file:writeBinary/file:move-batch in fs-handlers.ts and shell:reveal in
// shell-menu-handlers.ts) and are threaded the same way as #574.
import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import chokidar, { type FSWatcher } from 'chokidar'
import { ensureVaultGitignore } from '../snapshot.js'
import { assertAllowedVault } from '../vault-allowlist.js'
import { isNoisy, relPathIsNoisy } from '../noisyPaths.js'
import { importExternal } from '../fs-import-external.js'
import { searchContent } from '../search-content.js'
import type { SnapshotTrigger } from '../snapshot.js'
import { IPC_CHANNELS } from '../../src/shared/ipc-channels.js'

export type Settings = {
  vaultPath?: string
  iconTheme?: 'codicon' | 'material'
  colorTheme?: 'light' | 'dark' | 'system'
  visualStyle?: 'modern' | 'legacy'
  terminalModeEnabled?: boolean
  saveMode?: 'auto' | 'manual'
}

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json')

export async function readSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE(), 'utf8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function writeSettings(s: Settings): Promise<void> {
  await fs.mkdir(path.dirname(SETTINGS_FILE()), { recursive: true })
  await fs.writeFile(SETTINGS_FILE(), JSON.stringify(s, null, 2))
}

type FileNode = {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

async function readVaultTree(root: string, current = root): Promise<FileNode[]> {
  const entries = await fs.readdir(current, { withFileTypes: true })
  const nodes: FileNode[] = []
  for (const entry of entries) {
    if (isNoisy(entry.name, entry.isDirectory())) continue
    const full = path.join(current, entry.name)
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: full,
        isDir: true,
        children: await readVaultTree(root, full),
      })
    } else if (entry.isFile()) {
      nodes.push({ name: entry.name, path: full, isDir: false })
    }
  }
  nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return nodes
}

export type VaultHandlersCtx = {
  getActiveVaultPath: () => string | null
  setActiveVaultPath: (path: string | null) => void
  getAllowedVaultPaths: () => Set<string>
  assertInVault: (filePath: string) => Promise<string>
  wrapFsError: (e: unknown) => never
  snapshotBeforeMutation: (
    absPath: string,
    source: SnapshotTrigger,
    precondition: () => boolean,
    readBefore: () => Promise<string | null>
  ) => Promise<void>
  resetVaultSessionState: () => Promise<void>
  notifyTree: () => void
  cancelNotifyTree: () => void
  getFileCacheEntry: (key: string) => string | undefined
  setFileCacheEntry: (key: string, value: string) => void
  deleteFileCacheEntry: (key: string) => void
  isAiTurnActive: () => boolean
  getWin: () => BrowserWindow | null
}

let vaultWatcher: FSWatcher | null = null

// Called from main.ts's teardownChildren() on app quit — same pattern as
// electron/ipc/pty.ts's killAllPty (#570).
export function closeVaultWatcher(): void {
  vaultWatcher?.close()
}

export function registerVaultHandlers(ctx: VaultHandlersCtx): void {
  ipcMain.handle(IPC_CHANNELS.settings.get, () => readSettings())

  // Read-modify-write so callers can update one key (e.g. iconTheme) without
  // having to know — or clobber — unrelated keys like vaultPath. Resolved
  // settings are returned so the renderer can sync its local cache.
  ipcMain.handle(IPC_CHANNELS.settings.set, async (_e, partial: Partial<Settings>) => {
    const current = await readSettings()
    const next: Settings = { ...current, ...partial }
    await writeSettings(next)
    return next
  })

  ipcMain.handle(IPC_CHANNELS.file.pick, async () => {
    const activeVaultPath = ctx.getActiveVaultPath()
    if (!activeVaultPath) return null
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      defaultPath: activeVaultPath,
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown'] },
        {
          name: 'Code',
          extensions: [
            'ts',
            'tsx',
            'js',
            'jsx',
            'json',
            'yaml',
            'yml',
            'toml',
            'sh',
            'py',
            'rb',
            'go',
            'rs',
            'css',
            'html',
          ],
        },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] },
        { name: 'Documents', extensions: ['pdf', 'docx'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const chosen = result.filePaths[0]
    // Compare realpath-to-realpath so macOS symlink prefixes (e.g. /tmp →
    // /private/tmp) on either side don't reject otherwise-valid files inside
    // the vault.
    // Re-read the active vault path here (not the value captured before the
    // dialog await): the original main.ts code referenced the module-level
    // `activeVaultPath` variable directly at both sites, so a vault:watch
    // call landing while the dialog was open was already visible to this
    // second read — preserved by re-calling the getter rather than reusing
    // the value from above.
    const currentVaultPath = ctx.getActiveVaultPath()
    if (!currentVaultPath) return null
    let resolvedChosen: string
    let resolvedVault: string
    try {
      resolvedChosen = await fs.realpath(path.resolve(chosen))
      resolvedVault = await fs.realpath(currentVaultPath)
    } catch {
      return null
    }
    if (!resolvedChosen.startsWith(resolvedVault + path.sep) && resolvedChosen !== resolvedVault) {
      console.warn('[file:pick] path outside vault allowlist, rejecting:', resolvedChosen)
      return null
    }
    return resolvedChosen
  })

  ipcMain.handle(IPC_CHANNELS.vault.pick, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select your folder',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const vaultPath = result.filePaths[0]
    let resolvedVault: string
    try {
      resolvedVault = await fs.realpath(path.resolve(vaultPath))
    } catch {
      // ENOENT/EACCES: skip — don't add a symlink or removed path to allowlist
      return null
    }
    ctx.getAllowedVaultPaths().add(resolvedVault)
    const settings = await readSettings()
    await writeSettings({ ...settings, vaultPath })
    return resolvedVault
  })

  ipcMain.handle(IPC_CHANNELS.vault.current, () => ctx.getActiveVaultPath())

  ipcMain.handle(IPC_CHANNELS.vault.tree, async () => {
    const activeVaultPath = ctx.getActiveVaultPath()
    if (!activeVaultPath || !existsSync(activeVaultPath)) return []
    return readVaultTree(activeVaultPath)
  })

  ipcMain.handle(IPC_CHANNELS.vault.watch, async (_e, vaultPath: string) => {
    if (!vaultPath) {
      await ctx.resetVaultSessionState()
      closeVaultWatcher()
      ctx.cancelNotifyTree()
      ctx.setActiveVaultPath(null)
      return null
    }
    let resolvedVault: string
    try {
      resolvedVault = await fs.realpath(path.resolve(vaultPath))
    } catch {
      throw new Error('MARVIN_VAULT_NOT_ALLOWED')
    }
    assertAllowedVault(resolvedVault, ctx.getAllowedVaultPaths())
    await ctx.resetVaultSessionState()
    closeVaultWatcher()
    ctx.cancelNotifyTree()
    ctx.setActiveVaultPath(resolvedVault)
    ensureVaultGitignore(resolvedVault).catch((err) =>
      console.error('[snapshot] ensureVaultGitignore failed', err)
    )
    vaultWatcher = chokidar.watch(resolvedVault, {
      // Test every vault-relative path segment, not just the basename: under the
      // macOS fsevents backend the watcher receives deep paths, and a basename-only
      // check let internal files leak (.marvin/.../_manifest.json,
      // .obsidian/workspace.json) into snapshots and the turn's modified-files list.
      ignored: (p) => relPathIsNoisy(path.relative(resolvedVault, p)),
      ignoreInitial: true,
      persistent: true,
    })
    const notifyFile = (filePath: string, source: 'agent' | 'external') =>
      ctx.getWin()?.webContents.send(IPC_CHANNELS.file.changed, filePath, source)

    // Snapshot before notifying the renderer of an external change.
    // Uses the in-memory cache (last content served via file:read) as the
    // "before" value, then does a single disk read to get the post-change
    // content — reused both to decide whether to snapshot and to refresh the
    // cache, so there's no second read and no torn-content window.
    // - Cache miss (file never opened in the editor, e.g. Claude created and
    //   wrote it entirely via PTY): the watcher fires after the write lands, so
    //   a disk read here would already be post-change — treating it as "before"
    //   would be misleading history. Skip the snapshot (no turn-toast evidence)
    //   and just seed the cache for next time.
    // - No content change (e.g. an editor re-save or mtime-only touch): skip
    //   the snapshot so it doesn't surface as a false "Claude modified" toast.
    const snapshotExternalChange = async (filePath: string): Promise<void> => {
      await ctx.snapshotBeforeMutation(
        filePath,
        'watcher',
        () => {
          const activeVaultPath = ctx.getActiveVaultPath()
          return (
            !!activeVaultPath &&
            (filePath === activeVaultPath || filePath.startsWith(activeVaultPath + path.sep))
          )
        },
        async () => {
          const activeVaultPath = ctx.getActiveVaultPath()
          if (!activeVaultPath) return null // guarded by precondition above; narrows for TS
          const relPath = path.relative(activeVaultPath, filePath)
          const before = ctx.getFileCacheEntry(filePath)

          let after: string
          try {
            after = await fs.readFile(filePath, 'utf8')
          } catch {
            return null // file unreadable (deleted, permission) — skip
          }

          if (before == null) {
            console.warn('[snapshot] watcher cache miss — skipping snapshot, seeding cache', {
              relPath,
            })
            ctx.setFileCacheEntry(filePath, after)
            return null
          }

          if (before === after) {
            ctx.setFileCacheEntry(filePath, after)
            return null
          }

          ctx.setFileCacheEntry(filePath, after)
          return before
        }
      )
    }

    vaultWatcher
      .on('add', (p) => {
        ctx.notifyTree()
        notifyFile(p, ctx.isAiTurnActive() ? 'agent' : 'external')
      })
      .on('change', (p) => {
        const source: 'agent' | 'external' = ctx.isAiTurnActive() ? 'agent' : 'external'
        snapshotExternalChange(p).catch((err) =>
          console.error('[snapshot] snapshotExternalChange unhandled', err)
        )
        notifyFile(p, source)
      })
      .on('unlink', (p) => {
        ctx.deleteFileCacheEntry(p)
        ctx.notifyTree()
      })
      .on('addDir', ctx.notifyTree)
      .on('unlinkDir', ctx.notifyTree)

    return resolvedVault
  })

  ipcMain.handle(IPC_CHANNELS.folder.create, async (_e, parentDir: string, name: string) => {
    try {
      const full = path.join(parentDir, name)
      const safe = await ctx.assertInVault(full)
      if (existsSync(safe)) throw new Error('MARVIN_FS_EEXIST')
      await fs.mkdir(safe, { recursive: false })
      ctx.notifyTree()
      return safe
    } catch (e) {
      ctx.wrapFsError(e)
    }
  })

  ipcMain.handle(IPC_CHANNELS.fs.importExternal, async (_e, sources: string[], destDir: string) => {
    const activeVaultPath = ctx.getActiveVaultPath()
    if (!activeVaultPath) throw new Error('MARVIN_OUTSIDE_VAULT')
    const result = await importExternal(activeVaultPath, sources, destDir)
    ctx.notifyTree()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.search.content, async (_e, query: string) => {
    const activeVaultPath = ctx.getActiveVaultPath()
    if (!activeVaultPath) return []
    return searchContent(activeVaultPath, query)
  })
}
