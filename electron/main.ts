import { app, BrowserWindow, WebContentsView, ipcMain, dialog, protocol, shell, Menu, MenuItem, clipboard } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { execSync } from 'node:child_process'
import chokidar, { type FSWatcher } from 'chokidar'
import * as pty from 'node-pty'
import {
  writeSnapshot,
  newTurnId,
  ensureVaultGitignore,
  completeTurn,
  listTurns,
  listForFile,
  readSnapshot,
  restoreSnapshot,
} from './snapshot.js'
import { assertInsideVaultAsync } from './vault-boundary.js'
import { assertAllowedVault } from './vault-allowlist.js'
import { assertPtySpawnAllowed, registerDynamicShell } from './pty-spawn-guard.js'
import { assertAgentDetectAllowed, registerDetectedAgent } from './agent-detect-guard.js'
import {
  spawnAgent,
  cancelAgent,
  killAgentSession,
  handleApproval,
  killAllAgents,
} from './agent/index.js'
import type { AgentRequest, AgentEvent } from './agent/protocol.js'

process.env.APP_ROOT = path.join(__dirname, '..')

let cachedShellEnv: NodeJS.ProcessEnv | null = null

function getShellEnv(): NodeJS.ProcessEnv {
  if (cachedShellEnv) return cachedShellEnv
  if (process.platform === 'win32') {
    cachedShellEnv = { ...process.env }
    return cachedShellEnv
  }
  const userShell = process.env.SHELL || '/bin/zsh'
  try {
    const out = execSync(`${userShell} -ilc 'env'`, {
      encoding: 'utf8',
      timeout: 4000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
    })
    const parsed: NodeJS.ProcessEnv = {}
    for (const line of out.split('\n')) {
      const eq = line.indexOf('=')
      if (eq <= 0) continue
      parsed[line.slice(0, eq)] = line.slice(eq + 1)
    }
    cachedShellEnv = { ...process.env, ...parsed }
  } catch {
    cachedShellEnv = { ...process.env }
  }
  return cachedShellEnv
}
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

let win: BrowserWindow | null = null
let vaultWatcher: FSWatcher | null = null
let activeVaultPath: string | null = null
// Allowlist of vault paths that were opened via OS dialog (vault:pick) or loaded
// from the persisted settings file. vault:watch only accepts paths in this set.
const allowedVaultPaths = new Set<string>()
const ptyProcesses = new Map<string, pty.IPty>()

// AI turn tracking — a PTY write stamps lastPtyWriteAt; file:write checks recency.
// 2 s window (PRD: PTY_ACTIVE_THRESHOLD = 2000 ms): if PTY was active within 2 s, treat as AI turn.
const AI_TURN_WINDOW_MS = 2_000
// 500 ms of silence marks end-of-turn (PRD: TURN_END_THRESHOLD).
const TURN_END_MS = 500
let lastPtyWriteAt = 0
let activeTurnId: string | null = null
let turnEndTimer: ReturnType<typeof setTimeout> | null = null

async function finalizeTurn(vaultRoot: string, turnId: string): Promise<void> {
  await completeTurn(vaultRoot, turnId)
  try {
    const turns = await listTurns(vaultRoot)
    const manifest = turns.find((t) => t.turnId === turnId)
    if (manifest && win && !win.isDestroyed()) {
      win.webContents.send('snapshot:turn-completed', {
        turnId,
        timestamp: manifest.timestamp,
        files: manifest.files.map((f) => f.relPath),
      })
    }
  } catch {
    // best-effort
  }
}

function scheduleTurnEnd(vaultRoot: string, turnId: string) {
  if (turnEndTimer) clearTimeout(turnEndTimer)
  turnEndTimer = setTimeout(() => {
    turnEndTimer = null
    activeTurnId = null
    finalizeTurn(vaultRoot, turnId).catch(() => {})
  }, TURN_END_MS)
}

// Last-read cache — populated by file:read, used by the watcher to obtain the
// "before" content when an external change is detected.
// Limitation: if the watcher fires for a file that was never read through the
// app (e.g. edited externally before any app open), the cache misses and no
// snapshot is taken. This is a known best-effort race between disk change
// detection and in-process state.
const fileContentCache = new Map<string, string>()

type BrowserEntry = {
  view: WebContentsView
  /** Last known bounds set from the renderer; we reapply them when un-hiding. */
  lastBounds: { x: number; y: number; width: number; height: number }
  /** Whether this view is currently the active browser tab. */
  active: boolean
  /** When true, all browsers are temporarily hidden (e.g. a React modal is open). */
  globallyHidden: boolean
}
const browserViews = new Map<string, BrowserEntry>()
let browsersGloballyHidden = false

const HIDDEN_BOUNDS = { x: 0, y: 0, width: 0, height: 0 }

function applyBounds(entry: BrowserEntry) {
  if (!entry.active || entry.globallyHidden) {
    entry.view.setBounds(HIDDEN_BOUNDS)
    return
  }
  entry.view.setBounds(entry.lastBounds)
}

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json')

type Settings = {
  vaultPath?: string
  iconTheme?: 'codicon' | 'material'
  colorTheme?: 'light' | 'dark' | 'system'
  visualStyle?: 'modern' | 'legacy'
  terminalModeEnabled?: boolean
}

async function readSettings(): Promise<Settings> {
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

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    trafficLightPosition: { x: 14, y: 13 },
    // Transparent + frameless on macOS so .shell can own rounded corners +
    // translucent vibrancy blur (Tahoe-friendly look). Traffic lights still
    // draw via titleBarStyle 'hidden'.
    transparent: process.platform === 'darwin',
    frame: process.platform !== 'darwin',
    backgroundColor: process.platform === 'darwin' ? '#00000000' : '#1e1e1e',
    vibrancy: process.platform === 'darwin' ? 'fullscreen-ui' : undefined,
    visualEffectState: process.platform === 'darwin' ? 'active' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

// Custom protocol for serving vault-local resources (images, etc.) into
// renderer-loaded HTML. Lets <img src="marvin:///abs/path"> work even
// though the renderer is loaded over http://localhost (which would normally
// block file:// for cross-origin reasons). Restricted to paths inside the
// active vault to prevent path traversal.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'marvin',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  // SVGs may only be embedded via `<img>`; `<object>/<iframe>/<embed>` would
  // enable script execution. The CSP header on the response is the second line
  // of defence — see the handler below.
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
  pdf: 'application/pdf',
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
}

function mimeFor(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop() ?? ''
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

app.whenReady().then(() => {
  protocol.handle('marvin', async (request) => {
    try {
      const u = new URL(request.url)
      if (!activeVaultPath) {
        console.warn('[marvin] no active vault, rejecting', request.url)
        return new Response('No vault', { status: 403 })
      }
      // Two URL shapes are accepted:
      //   1. App-emitted: `marvin://localhost/<absolute-vault-path>` — host
      //      is a placeholder so the standard URL parser doesn't eat the
      //      first path segment. Pathname holds the full absolute path.
      //   2. User-typed in URL bar: `marvin://<vault-relative-path>` — host
      //      holds the first segment (case-folded by Chromium, hence the
      //      lowercase-filename limitation for typed URLs). Resolved
      //      against the active vault.
      const host = decodeURIComponent(u.host)
      const urlPath = decodeURIComponent(u.pathname)
      let filePath: string
      if (host && host !== 'localhost') {
        filePath = path.resolve(activeVaultPath, host + urlPath)
      } else if (urlPath.startsWith(activeVaultPath)) {
        filePath = urlPath
      } else {
        filePath = path.resolve(activeVaultPath, urlPath.replace(/^\/+/, ''))
      }
      let safePath: string
      try {
        safePath = await assertInsideVaultAsync(activeVaultPath, filePath)
      } catch {
        return new Response('Forbidden', { status: 403 })
      }
      const data = await fs.readFile(safePath)
      // Buffer is a Uint8Array subclass; Response accepts BodyInit which
      // includes ArrayBuffer / Uint8Array — cast to satisfy TS.
      return new Response(data as unknown as Uint8Array, {
        headers: {
          'Content-Type': mimeFor(safePath),
          // Defense-in-depth: SVGs served here may carry inline `<script>`.
          // Chromium already blocks script execution when SVG is loaded via
          // `<img>` (secure animation mode); this CSP locks the response down
          // unconditionally so a future regression in the embed path cannot
          // enable script or plugin execution.
          'Content-Security-Policy': "script-src 'none'; object-src 'none'",
        },
      })
    } catch (err) {
      console.error('[marvin] handler failed', request.url, err)
      return new Response('Error', { status: 500 })
    }
  })
  // Pre-populate activeVaultPath from persisted settings so IPC handlers
  // (snapshot:*, vault:tree, etc.) work immediately when the renderer loads,
  // without waiting for the renderer to call vault:watch first.
  readSettings().then(async (s) => {
    if (s.vaultPath) {
      let resolved: string
      try {
        resolved = await fs.realpath(path.resolve(s.vaultPath))
      } catch {
        // ENOENT: settings stale or dir removed — skip allowlist, keep lexical for activeVaultPath
        activeVaultPath = path.resolve(s.vaultPath)
        return
      }
      allowedVaultPaths.add(resolved)
      activeVaultPath = resolved
    }
  }).catch(() => {})

  createWindow()
})

app.on('window-all-closed', () => {
  for (const p of ptyProcesses.values()) p.kill()
  ptyProcesses.clear()
  killAllAgents().catch(() => {})
  vaultWatcher?.close()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

ipcMain.handle('settings:get', () => readSettings())

// Read-modify-write so callers can update one key (e.g. iconTheme) without
// having to know — or clobber — unrelated keys like vaultPath. Resolved
// settings are returned so the renderer can sync its local cache.
ipcMain.handle('settings:set', async (_e, partial: Partial<Settings>) => {
  const current = await readSettings()
  const next: Settings = { ...current, ...partial }
  await writeSettings(next)
  return next
})

ipcMain.handle('shell:openExternal', async (_e, url: string) => {
  if (!/^(https?|mailto):/i.test(url)) return
  await shell.openExternal(url)
})

ipcMain.handle('vault:pick', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select your vault folder',
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
  allowedVaultPaths.add(resolvedVault)
  const settings = await readSettings()
  await writeSettings({ ...settings, vaultPath })
  return resolvedVault
})

type FileNode = {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

const NOISY_DIRS = new Set(['.git', 'node_modules', '.DS_Store', '.svn', '.hg', '.idea', '.marvin'])
const NOISY_FILES = new Set(['.DS_Store', 'Thumbs.db'])

function isNoisy(name: string, isDir: boolean): boolean {
  return isDir ? NOISY_DIRS.has(name) : NOISY_FILES.has(name)
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

ipcMain.handle('vault:current', () => activeVaultPath)

ipcMain.handle('vault:tree', async () => {
  if (!activeVaultPath || !existsSync(activeVaultPath)) return []
  return readVaultTree(activeVaultPath)
})

ipcMain.handle('vault:watch', async (_e, vaultPath: string) => {
  if (!vaultPath) {
    vaultWatcher?.close()
    activeVaultPath = null
    return null
  }
  let resolvedVault: string
  try {
    resolvedVault = await fs.realpath(path.resolve(vaultPath))
  } catch {
    throw new Error('MARVIN_VAULT_NOT_ALLOWED')
  }
  assertAllowedVault(resolvedVault, allowedVaultPaths)
  vaultWatcher?.close()
  activeVaultPath = resolvedVault
  ensureVaultGitignore(resolvedVault).catch((err) =>
    console.error('[snapshot] ensureVaultGitignore failed', err),
  )
  vaultWatcher = chokidar.watch(resolvedVault, {
    ignored: (p) => {
      const base = path.basename(p)
      return NOISY_DIRS.has(base) || NOISY_FILES.has(base)
    },
    ignoreInitial: true,
    persistent: true,
  })
  const notifyTree = () => win?.webContents.send('vault:changed')
  const notifyFile = (filePath: string, source: 'agent' | 'external') =>
    win?.webContents.send('file:changed', filePath, source)

  // Snapshot before notifying the renderer of an external change.
  // Prefers the in-memory cache (last content served via file:read) as the
  // "before" value. If the cache is empty (file was never opened in the editor,
  // e.g. Claude created and modified it entirely via PTY), falls back to reading
  // from disk. Known race: the watcher fires after the write completes, so the
  // disk read may already reflect the new content — we snapshot best-effort and
  // log a warning when that happens (hashes equal after snapshot write).
  const snapshotExternalChange = async (filePath: string): Promise<void> => {
    const aiActive = Date.now() - lastPtyWriteAt < AI_TURN_WINDOW_MS
    if (!aiActive || !activeVaultPath || !(filePath === activeVaultPath || filePath.startsWith(activeVaultPath + path.sep))) return
    const turnId = activeTurnId ?? newTurnId()
    if (!activeTurnId) activeTurnId = turnId
    const relPath = path.relative(activeVaultPath, filePath)

    let before = fileContentCache.get(filePath)
    if (!before) {
      // Cache miss — read from disk (best-effort; may already be post-write content)
      try {
        before = await fs.readFile(filePath, 'utf8')
        console.warn('[snapshot] watcher cache miss — reading from disk, may be post-write content', { relPath })
      } catch {
        return // file unreadable (binary, deleted, permission) — skip
      }
    }

    try {
      await writeSnapshot(activeVaultPath, turnId, relPath, before, 'watcher')
    } catch (err) {
      console.error('[snapshot] watcher pre-change snapshot failed', { filePath, turnId, err })
    }
    // Update cache to the new on-disk content so the next change has a fresh baseline
    try {
      const next = await fs.readFile(filePath, 'utf8')
      fileContentCache.set(filePath, next)
    } catch {
      fileContentCache.delete(filePath)
    }
  }

  vaultWatcher
    .on('add', (p) => {
      notifyTree()
      notifyFile(p, Date.now() - lastPtyWriteAt < AI_TURN_WINDOW_MS ? 'agent' : 'external')
    })
    .on('change', (p) => {
      const source: 'agent' | 'external' = Date.now() - lastPtyWriteAt < AI_TURN_WINDOW_MS ? 'agent' : 'external'
      snapshotExternalChange(p).catch((err) =>
        console.error('[snapshot] snapshotExternalChange unhandled', err),
      )
      notifyFile(p, source)
    })
    .on('unlink', (p) => {
      fileContentCache.delete(p)
      notifyTree()
    })
    .on('addDir', notifyTree)
    .on('unlinkDir', notifyTree)
  
  return resolvedVault
})

const FILE_SIZE_LIMIT = 5 * 1024 * 1024 // 5 MB — guard against pathologically large files
const BINARY_PROBE_BYTES = 8192 // any null byte in the first 8 KB → treat as binary

ipcMain.handle('file:read', async (_e, filePath: string) => {
  const safe = await assertInVault(filePath)
  const stats = await fs.stat(safe)
  if (stats.isDirectory()) throw new Error('MARVIN_IS_DIRECTORY')
  if (stats.size > FILE_SIZE_LIMIT) {
    throw new Error(`MARVIN_TOO_LARGE: ${stats.size}`)
  }
  // Sniff the head for null bytes — the standard binary heuristic. Most
  // text formats (utf-8) don't contain literal NUL; most binary files do.
  if (stats.size > 0) {
    const fd = await fs.open(safe, 'r')
    try {
      const probeLen = Math.min(BINARY_PROBE_BYTES, stats.size)
      const probe = Buffer.alloc(probeLen)
      await fd.read(probe, 0, probeLen, 0)
      if (probe.includes(0)) {
        throw new Error('MARVIN_BINARY')
      }
    } finally {
      await fd.close()
    }
  }
  const content = await fs.readFile(safe, 'utf8')
  fileContentCache.set(safe, content)
  return content
})

ipcMain.handle('file:write', async (_e, filePath: string, content: string) => {
  const safe = await assertInVault(filePath)
  const aiActive = Date.now() - lastPtyWriteAt < AI_TURN_WINDOW_MS
  if (aiActive && activeVaultPath && existsSync(safe)) {
    const turnId = activeTurnId ?? newTurnId()
    if (!activeTurnId) activeTurnId = turnId
    const relPath = path.relative(activeVaultPath, safe)
    try {
      const before = await fs.readFile(safe, 'utf8')
      await writeSnapshot(activeVaultPath, turnId, relPath, before, 'file:write')
    } catch (err) {
      console.error('[snapshot] file:write pre-snapshot failed', { relPath, turnId, err })
    }
  }
  await fs.writeFile(safe, content, 'utf8')
})

ipcMain.handle('file:create', async (_e, parentDir: string, name: string) => {
  const safeName = name.endsWith('.md') ? name : `${name}.md`
  const full = path.join(parentDir, safeName)
  const safe = await assertInVault(full)
  if (existsSync(safe)) throw new Error('File already exists')
  await fs.mkdir(path.dirname(safe), { recursive: true })
  await fs.writeFile(safe, '', 'utf8')
  return safe
})

ipcMain.handle('folder:create', async (_e, parentDir: string, name: string) => {
  const full = path.join(parentDir, name)
  const safe = await assertInVault(full)
  if (existsSync(safe)) throw new Error('Folder already exists')
  await fs.mkdir(safe, { recursive: false })
  return safe
})

async function listAllMarkdown(root: string, current = root): Promise<string[]> {
  const out: string[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(current, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (isNoisy(entry.name, entry.isDirectory())) continue
    const full = path.join(current, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await listAllMarkdown(root, full)))
    } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

// Markdown link patterns we touch:
//   [text](href)         standard link
//   ![alt](href)         image
//   [text](href "title") with title (preserved)
//   [[Name]] / [[Name|Display]] / [[folder/Name]] / [[Name#section]] — wikilinks
const MD_LINK_RE = /(!?)\[((?:\\.|[^\]\\])*)\]\(\s*([^\s)]+)(\s+"[^"]*")?\s*\)/g
const WIKILINK_RE = /\[\[([^\[\]\n|]+)(?:\|([^\[\]\n]+))?\]\]/g

function rewriteOneFile(
  fileAbsPath: string,
  vaultRoot: string,
  oldPath: string,
  newPath: string,
  content: string,
): string {
  // If THIS file IS the moved one (or lives inside a moved folder), its absolute
  // location changed — but its outgoing links were authored relative to its OLD
  // location. So compute "what did href point to before?" using oldDir; then
  // rewrite the link relative to the file's NEW directory.
  // remappedPath maps OLD → NEW; for the inverse (NEW current path → OLD origin)
  // we swap the args.
  const fileOldLocation = remappedPath(fileAbsPath, newPath, oldPath)
  const oldFileDir = path.dirname(fileOldLocation ?? fileAbsPath)
  const newFileDir = path.dirname(fileAbsPath)

  return content.replace(MD_LINK_RE, (match, bang, label, href, title) => {
    if (!href) return match
    if (/^(https?|mailto|data):/i.test(href) || href.startsWith('#')) return match

    const suffixIdx = href.search(/[?#]/)
    const purePath = suffixIdx >= 0 ? href.slice(0, suffixIdx) : href
    const suffix = suffixIdx >= 0 ? href.slice(suffixIdx) : ''
    if (!purePath) return match

    const decoded = safeDecode(purePath)
    // `/`-prefix → vault-root-relative; else → file-relative.
    const isVaultRootRel = decoded.startsWith('/')
    const oldAbsTarget = isVaultRootRel
      ? path.join(vaultRoot, decoded)
      : path.resolve(oldFileDir, decoded)

    // Where does this absolute path live AFTER the rename?
    const newAbsTarget = remappedPath(oldAbsTarget, oldPath, newPath) ?? oldAbsTarget

    // If this file didn't move AND the target didn't move, nothing to do.
    if (!fileOldLocation && newAbsTarget === oldAbsTarget) return match

    // Preserve the form: vault-root-relative stays vault-root-relative.
    const newRel = isVaultRootRel
      ? '/' + path.relative(vaultRoot, newAbsTarget)
      : path.relative(newFileDir, newAbsTarget) || '.'
    const newHref = encodePath(newRel) + suffix
    if (newHref === purePath + suffix) return match

    return `${bang}[${label}](${newHref}${title ?? ''})`
  })
}

function safeDecode(s: string): string {
  try {
    return decodeURI(s)
  } catch {
    return s
  }
}

function encodePath(s: string): string {
  // Encode spaces and a few other chars markdown-safely; preserve / and .
  return s
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/%2F/g, '/'))
    .join('/')
}

// If `target` equals `oldPath` or lives inside `oldPath` (treated as a directory),
// returns the equivalent location after rename. Otherwise returns null.
function remappedPath(target: string, oldPath: string, newPath: string): string | null {
  if (target === oldPath) return newPath
  if (target.startsWith(`${oldPath}/`)) return newPath + target.slice(oldPath.length)
  return null
}

function stripMdExt(s: string): string {
  return s.replace(/\.(md|markdown)$/i, '')
}

/**
 * Rewrite `[[wikilinks]]` so they keep resolving after a rename or move.
 *
 * - `[[Foo]]` / `[[Foo|Bar]]` / `[[Foo#sec]]` — rewritten only when a
 *   markdown file is renamed (folder renames don't change basenames).
 * - `[[folder/Foo]]` — rewritten when the resolved path either matches
 *   the renamed file or lives inside a renamed folder.
 */
function rewriteWikilinksOneFile(
  vaultRoot: string,
  oldPath: string,
  newPath: string,
  content: string,
): string {
  const oldIsMd = /\.(md|markdown)$/i.test(oldPath)
  const oldBase = oldIsMd ? stripMdExt(path.basename(oldPath)) : ''
  const newBase = oldIsMd ? stripMdExt(path.basename(newPath)) : ''

  return content.replace(WIKILINK_RE, (match, rawName, rawDisplay) => {
    const name = String(rawName)
    const hashIdx = name.indexOf('#')
    const target = hashIdx >= 0 ? name.slice(0, hashIdx) : name
    const fragment = hashIdx >= 0 ? name.slice(hashIdx) : ''
    const displaySuffix = rawDisplay ? `|${rawDisplay}` : ''

    if (target.includes('/')) {
      const withExt = /\.(md|markdown)$/i.test(target) ? target : `${target}.md`
      const abs = path.join(vaultRoot, withExt)
      const remapped = remappedPath(abs, oldPath, newPath)
      if (!remapped) return match
      const newRel = path.relative(vaultRoot, remapped)
      return `[[${stripMdExt(newRel)}${fragment}${displaySuffix}]]`
    }

    if (!oldIsMd) return match
    if (stripMdExt(target) !== oldBase) return match
    return `[[${newBase}${fragment}${displaySuffix}]]`
  })
}

async function rewriteLinksAfterMove(
  vaultRoot: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  const files = await listAllMarkdown(vaultRoot)
  // One turn-id for all cascade snapshots in this rename operation
  const cascadeTurnId = newTurnId()
  await Promise.all(
    files.map(async (file) => {
      try {
        const content = await fs.readFile(file, 'utf8')
        let next = rewriteOneFile(file, vaultRoot, oldPath, newPath, content)
        next = rewriteWikilinksOneFile(vaultRoot, oldPath, newPath, next)
        if (next !== content) {
          // Snapshot the file before rewriting its links — always, regardless of
          // AI turn state, because the user did not edit this file directly.
          const relPath = path.relative(vaultRoot, file)
          await writeSnapshot(vaultRoot, cascadeTurnId, relPath, content, 'cascade')
          await fs.writeFile(file, next, 'utf8')
        }
      } catch {
        // best-effort; skip files that vanished mid-walk
      }
    }),
  )
}

ipcMain.handle('path:rename', async (_e, oldPath: string, newPath: string) => {
  const safeOld = await assertInVault(oldPath)
  const safeNew = await assertInVault(newPath)
  if (existsSync(safeNew)) throw new Error('Target path already exists')

  // Snapshot the source file before moving if AI turn is active
  const aiActive = Date.now() - lastPtyWriteAt < AI_TURN_WINDOW_MS
  if (aiActive && activeVaultPath && existsSync(safeOld)) {
    const turnId = activeTurnId ?? newTurnId()
    if (!activeTurnId) activeTurnId = turnId
    const relPath = path.relative(activeVaultPath, safeOld)
    try {
      const content = await fs.readFile(safeOld, 'utf8')
      await writeSnapshot(activeVaultPath, turnId, relPath, content, 'file:write')
    } catch (err) {
      console.error('[snapshot] path:rename pre-snapshot failed', { relPath, turnId, err })
    }
  }

  await fs.mkdir(path.dirname(safeNew), { recursive: true })
  await fs.rename(safeOld, safeNew)
  if (activeVaultPath) {
    try {
      await rewriteLinksAfterMove(activeVaultPath, safeOld, safeNew)
    } catch (err) {
      console.error('[rewriteLinksAfterMove] failed', err)
    }
  }
  return safeNew
})

ipcMain.handle('path:trash', async (_e, target: string) => {
  const safe = await assertInVault(target)
  await shell.trashItem(safe)
})

ipcMain.handle('shell:reveal', async (_e, target: string) => {
  const safe = await assertInVault(target)
  shell.showItemInFolder(safe)
})

type EditorMenuRequest = { hasSelection: boolean; canUndo: boolean; canRedo: boolean }
type EditorMenuAction = 'cut' | 'copy' | 'paste' | 'selectAll' | 'undo' | 'redo' | null

ipcMain.handle('editor:show-context-menu', (e, req: EditorMenuRequest): Promise<EditorMenuAction> => {
  const canPaste = clipboard.availableFormats().some(f => f.startsWith('text/') || f === 'text')
  return new Promise<EditorMenuAction>(resolve => {
    // Capture the chosen action in a closure; menu.popup's callback fires AFTER
    // any click handler, so click handlers set `chosen` and the callback resolves
    // with whatever was set (or `null` if the menu was dismissed without a click).
    let chosen: EditorMenuAction = null
    const menu = new Menu()
    menu.append(new MenuItem({ label: 'Cut', accelerator: 'CmdOrCtrl+X', enabled: req.hasSelection, click: () => { chosen = 'cut' } }))
    menu.append(new MenuItem({ label: 'Copy', accelerator: 'CmdOrCtrl+C', enabled: req.hasSelection, click: () => { chosen = 'copy' } }))
    menu.append(new MenuItem({ label: 'Paste', accelerator: 'CmdOrCtrl+V', enabled: canPaste, click: () => { chosen = 'paste' } }))
    menu.append(new MenuItem({ type: 'separator' }))
    menu.append(new MenuItem({ label: 'Select All', accelerator: 'CmdOrCtrl+A', click: () => { chosen = 'selectAll' } }))
    menu.append(new MenuItem({ type: 'separator' }))
    menu.append(new MenuItem({ label: 'Undo', accelerator: 'CmdOrCtrl+Z', enabled: req.canUndo, click: () => { chosen = 'undo' } }))
    menu.append(new MenuItem({ label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', enabled: req.canRedo, click: () => { chosen = 'redo' } }))
    const win = BrowserWindow.fromWebContents(e.sender)
    menu.popup({ window: win ?? undefined, callback: () => resolve(chosen) })
  })
})

ipcMain.handle('editor:clipboard-read', (): string => {
  return clipboard.readText()
})

ipcMain.handle('editor:clipboard-write', (_e, text: string): void => {
  clipboard.writeText(text)
})

function detectBinary(name: string): string | null {
  // Defensive: only allow simple binary names — no path traversal or shell.
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return null
  const env = getShellEnv()
  const pathDirs = (env.PATH || '').split(':').filter(Boolean)
  const fallback = [
    path.join(env.HOME || '', '.local/bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ]
  for (const dir of [...pathDirs, ...fallback]) {
    const candidate = path.join(dir, name)
    try {
      const st = statSync(candidate)
      if (st.isFile() || st.isSymbolicLink()) return candidate
    } catch {
      // ignore
    }
  }
  return null
}

ipcMain.handle('agent:detect', async (_e, name: string) => {
  assertAgentDetectAllowed(name)
  const detected = detectBinary(name)
  if (detected) {
    registerDynamicShell(detected)
    registerDetectedAgent(detected)
  }
  return detected
})

// Back-compat shim for the previous renderer API.
ipcMain.handle('claude:detect', async () => {
  const detected = detectBinary('claude')
  if (detected) registerDynamicShell(detected)
  return detected
})

ipcMain.handle(
  'pty:spawn',
  async (_e, opts: { id: string; shell: string; cwd: string; cols: number; rows: number; args?: string[] }) => {
    if (!activeVaultPath) throw new Error('MARVIN_OUTSIDE_VAULT')
    const { shell: resolvedShell, cwd: safeCwd } = await assertPtySpawnAllowed(activeVaultPath, opts)

    const existing = ptyProcesses.get(opts.id)
    if (existing) existing.kill()

    const shellEnv = getShellEnv()
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(shellEnv)) {
      if (v != null) env[k] = v
    }
    delete env.ELECTRON_RUN_AS_NODE
    env.TERM = 'xterm-256color'
    env.COLORTERM = 'truecolor'
    env.FORCE_COLOR = '1'

    const cols = Math.max(opts.cols || 80, 20)
    const rows = Math.max(opts.rows || 24, 5)

    try {
      const ptyProcess = pty.spawn(resolvedShell, opts.args ?? [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: safeCwd,
        env,
      })
      ptyProcesses.set(opts.id, ptyProcess)

      const safeSend = (channel: string, payload: unknown) => {
        try {
          if (win && !win.isDestroyed()) {
            win.webContents.send(channel, payload)
          }
        } catch {
          // renderer being torn down (HMR) — ignore
        }
      }
      ptyProcess.onData((data) => {
        // Stamp AI turn activity on every data chunk — Claude streams output
        // continuously, so the 2s window stays open while it's responding.
        lastPtyWriteAt = Date.now()
        if (!activeTurnId) activeTurnId = newTurnId()
        if (activeVaultPath) scheduleTurnEnd(activeVaultPath, activeTurnId)
        safeSend(`pty:data:${opts.id}`, data)
      })
      ptyProcess.onExit(({ exitCode }) => {
        safeSend(`pty:exit:${opts.id}`, exitCode)
        ptyProcesses.delete(opts.id)
        // When last PTY exits, fire turn-end immediately rather than waiting the timer
        if (ptyProcesses.size === 0 && activeTurnId && activeVaultPath) {
          if (turnEndTimer) { clearTimeout(turnEndTimer); turnEndTimer = null }
          const tid = activeTurnId
          activeTurnId = null
          finalizeTurn(activeVaultPath, tid).catch(() => {})
        } else if (ptyProcesses.size === 0) {
          activeTurnId = null
        }
      })
      return { pid: ptyProcess.pid }
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err)
      if (/^(MARVIN|SNAPSHOT)_[A-Z_]+$/.test(code)) throw err
      console.error('[pty:spawn] spawn failed', { id: opts.id, shell: opts.shell, err })
      throw new Error('MARVIN_PTY_SPAWN_FAILED')
    }
  },
)

ipcMain.handle('pty:write', (_e, id: string, data: string) => {
  lastPtyWriteAt = Date.now()
  if (!activeTurnId) activeTurnId = newTurnId()
  if (activeVaultPath) scheduleTurnEnd(activeVaultPath, activeTurnId)
  ptyProcesses.get(id)?.write(data)
})

ipcMain.handle('pty:resize', (_e, id: string, cols: number, rows: number) => {
  ptyProcesses.get(id)?.resize(cols, rows)
})

ipcMain.handle('pty:kill', (_e, id: string) => {
  ptyProcesses.get(id)?.kill()
  ptyProcesses.delete(id)
})

// --- In-app browser (WebContentsView) -----------------------------------

function safeBrowserSend(channel: string, payload: unknown) {
  try {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  } catch {
    // renderer being torn down — ignore
  }
}

type BrowserBounds = { x: number; y: number; width: number; height: number }

ipcMain.handle(
  'browser:create',
  async (_e, opts: { id: string; url: string; bounds: BrowserBounds }) => {
    if (!win) throw new Error('No window available')
    // Idempotent: if a view with this id already exists (e.g. HMR remount of
    // the React component), return its current state instead of recreating.
    const existing = browserViews.get(opts.id)
    if (existing) {
      existing.lastBounds = opts.bounds
      applyBounds(existing)
      const wc = existing.view.webContents
      return {
        url: wc.getURL(),
        title: wc.getTitle(),
        canBack: wc.navigationHistory.canGoBack(),
        canForward: wc.navigationHistory.canGoForward(),
      }
    }

    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // No preload — the embedded page must not see Marvin's API.
      },
    })
    view.setBackgroundColor('#1e1e1e')

    const entry: BrowserEntry = {
      view,
      lastBounds: opts.bounds,
      active: true,
      globallyHidden: browsersGloballyHidden,
    }
    browserViews.set(opts.id, entry)

    win.contentView.addChildView(view)
    applyBounds(entry)

    const { webContents } = view

    webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })

    // Block file:// navigations to avoid local file disclosure inside the
    // sandboxed browser. Allow http(s)/about:blank.
    webContents.on('will-navigate', (event, url) => {
      try {
        const u = new URL(url)
        if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'about:') {
          event.preventDefault()
        }
      } catch {
        event.preventDefault()
      }
    })

    const sendNavState = () => {
      safeBrowserSend('browser:event', {
        id: opts.id,
        kind: 'nav-state',
        canBack: webContents.navigationHistory.canGoBack(),
        canForward: webContents.navigationHistory.canGoForward(),
      })
    }

    webContents.on('page-title-updated', (_evt, title) => {
      safeBrowserSend('browser:event', { id: opts.id, kind: 'title', title })
    })
    webContents.on('did-navigate', (_evt, url) => {
      safeBrowserSend('browser:event', { id: opts.id, kind: 'url', url })
      sendNavState()
    })
    webContents.on('did-navigate-in-page', (_evt, url) => {
      safeBrowserSend('browser:event', { id: opts.id, kind: 'url', url })
      sendNavState()
    })
    webContents.on('did-start-loading', () => {
      safeBrowserSend('browser:event', { id: opts.id, kind: 'loading', loading: true })
    })
    webContents.on('did-stop-loading', () => {
      safeBrowserSend('browser:event', { id: opts.id, kind: 'loading', loading: false })
      sendNavState()
    })
    webContents.on('did-fail-load', (_evt, errorCode, errorDesc, validatedURL) => {
      // Sub-frame failures emit too; only surface main-frame failures.
      if (_evt && (_evt as unknown as { isMainFrame?: boolean }).isMainFrame === false) return
      safeBrowserSend('browser:event', {
        id: opts.id,
        kind: 'load-error',
        url: validatedURL,
        message: `${errorDesc} (${errorCode})`,
      })
    })

    try {
      await webContents.loadURL(opts.url)
    } catch {
      // The error event already fired; swallow the rejection so create still
      // resolves and the renderer can show the URL bar with the broken URL.
    }

    return {
      url: webContents.getURL(),
      title: webContents.getTitle(),
      canBack: webContents.navigationHistory.canGoBack(),
      canForward: webContents.navigationHistory.canGoForward(),
    }
  },
)

ipcMain.handle('browser:navigate', async (_e, id: string, url: string) => {
  const entry = browserViews.get(id)
  if (!entry) return
  try {
    await entry.view.webContents.loadURL(url)
  } catch {
    // surfaced via did-fail-load
  }
})

ipcMain.handle('browser:back', (_e, id: string) => {
  const entry = browserViews.get(id)
  if (entry?.view.webContents.navigationHistory.canGoBack()) {
    entry.view.webContents.navigationHistory.goBack()
  }
})

ipcMain.handle('browser:forward', (_e, id: string) => {
  const entry = browserViews.get(id)
  if (entry?.view.webContents.navigationHistory.canGoForward()) {
    entry.view.webContents.navigationHistory.goForward()
  }
})

ipcMain.handle('browser:reload', (_e, id: string) => {
  browserViews.get(id)?.view.webContents.reload()
})

ipcMain.handle('browser:stop', (_e, id: string) => {
  browserViews.get(id)?.view.webContents.stop()
})

ipcMain.handle('browser:setBounds', (_e, id: string, bounds: BrowserBounds) => {
  const entry = browserViews.get(id)
  if (!entry) return
  entry.lastBounds = bounds
  applyBounds(entry)
})

ipcMain.handle('browser:setActive', (_e, activeId: string | null) => {
  for (const [id, entry] of browserViews.entries()) {
    entry.active = id === activeId
    applyBounds(entry)
  }
})

ipcMain.handle('browser:setAllHidden', (_e, hidden: boolean) => {
  browsersGloballyHidden = hidden
  for (const entry of browserViews.values()) {
    entry.globallyHidden = hidden
    applyBounds(entry)
  }
})

ipcMain.handle('browser:close', (_e, id: string) => {
  const entry = browserViews.get(id)
  if (!entry) return
  try {
    win?.contentView.removeChildView(entry.view)
  } catch {
    // ignore
  }
  // Close the underlying webContents to release Chromium resources.
  // Newer Electron exposes destroy() via close(); fall back to setting
  // bounds to zero and dropping references.
  try {
    ;(entry.view.webContents as unknown as { close?: () => void }).close?.()
  } catch {
    // ignore
  }
  browserViews.delete(id)
})

// --- Snapshot IPC handlers ---------------------------------------------------

// PRD format: <ISO-8601-compact>Z-<12-char-hex-salt>  e.g. 20250521T120345Z-abc123def456
const TURN_ID_RE = /^\d{8}T\d{6}Z-[0-9a-f]{12}$/i

function validateTurnId(turnId: unknown): string {
  if (typeof turnId !== 'string' || !TURN_ID_RE.test(turnId)) {
    throw new Error('SNAPSHOT_INVALID_TURN_ID')
  }
  return turnId
}

const MARVIN_DIR_PREFIX = '.marvin'

function validateRelPath(relPath: unknown): string {
  if (typeof relPath !== 'string' || !relPath) throw new Error('SNAPSHOT_INVALID_REL_PATH')
  if (relPath.includes('\0')) throw new Error('SNAPSHOT_INVALID_REL_PATH') // L4: null byte
  const normalized = path.normalize(relPath)
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    throw new Error('SNAPSHOT_INVALID_REL_PATH')
  }
  // L5: block access to .marvin/ internals via IPC
  if (normalized === MARVIN_DIR_PREFIX || normalized.startsWith(MARVIN_DIR_PREFIX + path.sep)) {
    throw new Error('SNAPSHOT_INVALID_REL_PATH')
  }
  return normalized
}

async function assertInVault(filePath: string): Promise<string> {
  if (!activeVaultPath) throw new Error('MARVIN_NO_VAULT')
  // Use the realpath-resolved path returned by assertInsideVaultAsync as the
  // canonical I/O path — eliminates the TOCTOU window between check and use (C2).
  return assertInsideVaultAsync(activeVaultPath, filePath)
}

function requireVault(): string {
  if (!activeVaultPath) throw new Error('SNAPSHOT_NO_VAULT')
  return activeVaultPath
}

type SnapshotEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

function ok<T>(data: T): SnapshotEnvelope<T> {
  return { ok: true, data }
}

// M9: never leak absolute host paths or fs error details to the renderer.
// Whitelist our own error codes; map fs errors to SNAPSHOT_FS_<CODE>;
// everything else becomes SNAPSHOT_INTERNAL_ERROR.
const KNOWN_CODE_RE = /^(MARVIN|SNAPSHOT)_[A-Z_]+$/
function err(e: unknown): SnapshotEnvelope<never> {
  const message = e instanceof Error ? e.message : ''
  if (KNOWN_CODE_RE.test(message)) return { ok: false, error: message }
  const fsCode = (e as NodeJS.ErrnoException)?.code
  return { ok: false, error: fsCode ? `SNAPSHOT_FS_${fsCode}` : 'SNAPSHOT_INTERNAL_ERROR' }
}

ipcMain.handle('snapshot:listTurns', async () => {
  try {
    const vault = requireVault()
    const turns = await listTurns(vault)
    return ok(turns)
  } catch (e) {
    return err(e)
  }
})

ipcMain.handle('snapshot:listForFile', async (_e, relPath: unknown) => {
  try {
    const vault = requireVault()
    const rel = validateRelPath(relPath)
    const turns = await listForFile(vault, rel)
    return ok(turns)
  } catch (e) {
    return err(e)
  }
})

ipcMain.handle('snapshot:read', async (_e, turnId: unknown, relPath: unknown) => {
  try {
    const vault = requireVault()
    const tid = validateTurnId(turnId)
    const rel = validateRelPath(relPath)
    const content = await readSnapshot(vault, tid, rel)
    return ok(content)
  } catch (e) {
    return err(e)
  }
})

ipcMain.handle('snapshot:restore', async (_e, turnId: unknown, relPath: unknown) => {
  try {
    const vault = requireVault()
    const tid = validateTurnId(turnId)
    const rel = validateRelPath(relPath)
    const preTurnId = await restoreSnapshot(vault, tid, rel)
    // Invalidate cache so the next file:read picks up the restored content
    const absPath = path.join(vault, rel)
    fileContentCache.delete(absPath)
    return ok({ preTurnId })
  } catch (e) {
    return err(e)
  }
})

const BUFFER_SAVE_MAX_BYTES = 50 * 1024 * 1024 // 50 MB hard cap

ipcMain.handle('snapshot:saveBuffer', async (_e, relPath: unknown, content: unknown) => {
  try {
    if (typeof content !== 'string') throw new Error('SNAPSHOT_INVALID_CONTENT')
    if (Buffer.byteLength(content, 'utf8') > BUFFER_SAVE_MAX_BYTES) throw new Error('SNAPSHOT_BUFFER_TOO_LARGE')
    const vault = requireVault()
    const rel = validateRelPath(relPath)
    const turnId = activeTurnId ?? newTurnId()
    if (!activeTurnId) activeTurnId = turnId
    const saved = await writeSnapshot(vault, turnId, rel, content, 'buffer-save')
    return ok({ turnId, saved })
  } catch (e) {
    return err(e)
  }
})

ipcMain.handle('snapshot:saveExternalChange', async (_e, relPath: unknown, content: unknown) => {
  try {
    const vault = requireVault()
    const rel = validateRelPath(relPath)
    if (typeof content !== 'string') throw new Error('SNAPSHOT_INVALID_CONTENT')
    if (Buffer.byteLength(content, 'utf8') > BUFFER_SAVE_MAX_BYTES) {
      throw new Error('SNAPSHOT_BUFFER_TOO_LARGE')
    }
    const turnId = activeTurnId ?? newTurnId()
    if (!activeTurnId) activeTurnId = turnId
    const saved = await writeSnapshot(vault, turnId, rel, content, 'external-rejected')
    return ok({ turnId, saved })
  } catch (e) { return err(e) }
})

// --- Agent IPC handlers (agent namespace) ------------------------------------

type AgentResponse = { ok: true } | { ok: false; error: string }

// L2: sessionId must be alphanumeric + dash/underscore only — no path traversal.
const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/

function requireAgentRequest(raw: unknown): AgentRequest {
  if (!raw || typeof raw !== 'object' || !('type' in raw)) {
    throw new Error('AGENT_INVALID_REQUEST')
  }
  const obj = raw as Record<string, unknown>
  if ('sessionId' in obj) {
    if (typeof obj.sessionId !== 'string' || !SESSION_ID_RE.test(obj.sessionId)) {
      throw new Error('AGENT_INVALID_REQUEST')
    }
  }
  // M3: validate decision.kind for approval requests.
  if (obj.type === 'approval') {
    const d = obj.decision as Record<string, unknown> | undefined
    if (!d || (d.kind !== 'allow' && d.kind !== 'deny')) {
      throw new Error('AGENT_INVALID_REQUEST')
    }
  }
  return raw as AgentRequest
}

ipcMain.handle('agent:request', async (e, raw: unknown): Promise<AgentResponse> => {
  try {
    const req = requireAgentRequest(raw)

    // Events go back to the renderer that made the request, not a global win ref.
    const sender = e.sender
    function senderSend(channel: string, payload: AgentEvent) {
      try {
        if (!sender.isDestroyed()) sender.send(channel, payload)
      } catch {
        // renderer being torn down — ignore
      }
    }

    if (req.type === 'start') {
      // C2: vaultRoot must be an allowed vault path (opened via dialog or settings).
      let resolvedVault: string
      try {
        resolvedVault = await fs.realpath(path.resolve(req.vaultRoot))
      } catch {
        throw new Error('MARVIN_VAULT_NOT_ALLOWED')
      }
      assertAllowedVault(resolvedVault, allowedVaultPaths)

      const binary = (process.env.NODE_ENV === 'test' && process.env.MOCK_CLAUDE_BIN)
        ? process.env.MOCK_CLAUDE_BIN
        : detectBinary('claude')
      if (!binary) {
        senderSend(`agent:event:${req.sessionId}`, {
          type: 'error',
          sessionId: req.sessionId,
          code: 'AGENT_NOT_FOUND',
          message: 'claude binary not found in PATH',
          recoverable: false,
        })
        return { ok: true }
      }
      // Register the binary so pty-spawn-guard validates it if ever needed.
      registerDynamicShell(binary)
      await spawnAgent({ ...req, vaultRoot: resolvedVault }, binary, senderSend)
      return { ok: true }
    }

    if (req.type === 'cancel') {
      await cancelAgent(req.sessionId)
      return { ok: true }
    }

    if (req.type === 'kill') {
      await killAgentSession(req.sessionId)
      return { ok: true }
    }

    if (req.type === 'approval') {
      handleApproval(req.sessionId, req.toolUseId, req.decision)
      return { ok: true }
    }

    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
})
