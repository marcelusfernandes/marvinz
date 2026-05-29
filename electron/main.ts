import { app, BrowserWindow, WebContentsView, ipcMain, dialog, protocol, shell, Menu, MenuItem, clipboard } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process'
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
import { isNoisy, relPathIsNoisy } from './noisyPaths.js'
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
import { importExternal } from './fs-import-external.js'
import { searchContent } from './search-content.js'
import { killProcessTree } from './proc-group.js'
import { resolveConflict } from './conflictResolver.js'
import type { MoveResult } from '../src/types.js'

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
    // The interactive (-i) shell does job control: it grabs the controlling
    // terminal's foreground process group via tcsetpgrp and, since our parent
    // (Electron/node) is not a job-control shell, never restores it on exit —
    // leaving the launching terminal's foreground pointing at a dead group, so
    // Ctrl+C reaches nothing and the dev app can't be stopped. `detached: true`
    // (setsid) runs the shell in its own session with no controlling terminal,
    // so it cannot touch the terminal we were launched from. .zshrc is still
    // sourced (-i is preserved). `detached` is honored by the runtime but absent
    // from @types/node's spawnSync options, so the option type is widened here.
    const envOpts: SpawnSyncOptionsWithStringEncoding & { detached?: boolean } = {
      encoding: 'utf8',
      timeout: 4000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
      stdio: ['ignore', 'pipe', 'ignore'],
      detached: true,
    }
    const out = spawnSync(userShell, ['-ilc', 'env'], envOpts).stdout ?? ''
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
let lastSpellcheck: { misspelledWord: string; suggestions: string[] } = { misspelledWord: '', suggestions: [] }
let vaultWatcher: FSWatcher | null = null
let activeVaultPath: string | null = null

// Push a tree-refresh signal to the renderer. Mutation handlers call this
// after their op so the UI doesn't depend on chokidar/fsevents catching a
// rapid unlink+add sequence (which it sometimes coalesces on macOS).
const notifyTree = (): void => {
  win?.webContents.send('vault:changed')
}
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

// Geometry descriptor: insets from each contentView edge to the browser-host
// element. Registered by the renderer once and reused by main on every resize.
type BrowserGeometry = {
  leftInset: number
  topInset: number
  rightInset: number
  bottomInset: number
}

type BrowserEntry = {
  view: WebContentsView
  /** Last known bounds set from the renderer; fallback when no geometry registered. */
  lastBounds: { x: number; y: number; width: number; height: number }
  /** Geometry descriptor for synchronous main-side resize recompute. */
  geometry: BrowserGeometry | null
  /** Whether this view is currently the active browser tab. */
  active: boolean
  /** When true, all browsers are temporarily hidden (e.g. a React modal is open). */
  globallyHidden: boolean
}
const browserViews = new Map<string, BrowserEntry>()
let browsersGloballyHidden = false

const HIDDEN_BOUNDS = { x: 0, y: 0, width: 0, height: 0 }

function boundsFromGeometry(
  geometry: BrowserGeometry,
  contentWidth: number,
  contentHeight: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: geometry.leftInset,
    y: geometry.topInset,
    width: Math.max(0, contentWidth - geometry.leftInset - geometry.rightInset),
    height: Math.max(0, contentHeight - geometry.topInset - geometry.bottomInset),
  }
}

function applyBounds(entry: BrowserEntry) {
  if (!entry.active || entry.globallyHidden) {
    entry.view.setBounds(HIDDEN_BOUNDS)
    return
  }
  entry.view.setBounds(entry.lastBounds)
}

// Recompute bounds from stored geometry descriptors using current window size.
// Called synchronously on every resize event to avoid an IPC round-trip.
// Uses getContentBounds() — same coordinate space as getBoundingClientRect() in
// the renderer and as WebContentsView.setBounds() (content area, excludes frame).
function reapplyAllWithGeometry() {
  if (!win || win.isDestroyed()) return
  const { width: contentWidth, height: contentHeight } = win.getContentBounds()
  for (const entry of browserViews.values()) {
    if (!entry.geometry) {
      applyBounds(entry)
      continue
    }
    const newBounds = boundsFromGeometry(entry.geometry, contentWidth, contentHeight)
    entry.lastBounds = newBounds
    applyBounds(entry)
  }
}

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json')

type Settings = {
  vaultPath?: string
  iconTheme?: 'codicon' | 'material'
  colorTheme?: 'light' | 'dark' | 'system'
  visualStyle?: 'modern' | 'legacy'
  terminalModeEnabled?: boolean
  saveMode?: 'auto' | 'manual'
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
    trafficLightPosition: { x: 18, y: 16 },
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

  win.webContents.session.setSpellCheckerEnabled(true)
  // macOS uses the OS dictionary and may ignore this; that's expected behaviour.
  win.webContents.session.setSpellCheckerLanguages(['en-US', 'pt-BR'])

  win.webContents.on('context-menu', (_e, params) => {
    lastSpellcheck = { misspelledWord: params.misspelledWord, suggestions: params.dictionarySuggestions }
  })
  // Drop stale context once the window loses focus so a later right-click never
  // reads suggestions captured for a different word/session.
  win.on('blur', () => {
    lastSpellcheck = { misspelledWord: '', suggestions: [] }
  })

  win.on('resize', () => reapplyAllWithGeometry())
  win.on('maximize', () => reapplyAllWithGeometry())
  win.on('unmaximize', () => reapplyAllWithGeometry())
  win.on('restore', () => reapplyAllWithGeometry())
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

export function buildMenuTemplate(
  send: (action: string) => void,
  hasNoteTab = false,
): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: 'Marvinz',
      submenu: [
        { role: 'about' },
        {
          label: 'Settings…',
          accelerator: 'Cmd+,',
          click: () => send('settings'),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Note',
          accelerator: 'Cmd+N',
          click: () => send('new-note'),
        },
        {
          label: 'Open Folder…',
          click: () => send('open-vault'),
        },
        {
          label: 'Export PDF',
          enabled: hasNoteTab,
          click: () => send('export-pdf'),
        },
        {
          label: 'Reveal in Finder',
          enabled: hasNoteTab,
          click: () => send('reveal'),
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'Cmd+S',
          click: () => send('save'),
        },
        { type: 'separator' },
        {
          label: 'New Agent Terminal',
          accelerator: 'Cmd+Shift+T',
          click: () => send('new-agent-terminal'),
        },
        { type: 'separator' },
        {
          label: 'Command Palette',
          accelerator: 'Cmd+P',
          click: () => send('command-palette'),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Find',
          accelerator: 'Cmd+F',
          click: () => send('find'),
        },
        // Reload + DevTools are dev-only — hidden in packaged builds so end
        // users don't see them in the View menu.
        { role: 'reload', visible: !app.isPackaged },
        { role: 'toggleDevTools', visible: !app.isPackaged },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
  ]
}

// Tracks whether a note tab is active in the renderer so File → Export PDF /
// Reveal in Finder can be disabled when they'd be no-ops. Updated via IPC.
let menuHasNoteTab = false

function buildAppMenu() {
  if (process.platform !== 'darwin') return
  // `?.` only guards null; a closed-but-non-null window throws "Object has been
  // destroyed" on send — mirror the safeSend/safeBrowserSend idiom.
  const send = (action: string) => {
    if (win && !win.isDestroyed()) win.webContents.send('menu:action', action)
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(send, menuHasNoteTab)))
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
  buildAppMenu()
})

// Kill every long-lived child (pty shells + their trees, agent CLIs + their
// grandchildren) and close the vault watcher. Returns the agent-kill promise so
// callers can await the full SIGTERM→grace→SIGKILL sequence before exiting.
// Tracked in `pendingTeardowns` so a quit triggered while a teardown is still
// in flight (e.g. window closed then Cmd+Q) waits for it instead of cutting it
// off and orphaning children.
const pendingTeardowns = new Set<Promise<unknown>>()
function teardownChildren(): Promise<void> {
  for (const p of ptyProcesses.values()) killProcessTree(p.pid, 'SIGKILL')
  ptyProcesses.clear()
  vaultWatcher?.close()
  const done = killAllAgents()
  pendingTeardowns.add(done)
  done.finally(() => pendingTeardowns.delete(done))
  return done
}

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') {
    // App stays in the dock; the closed window's ptys/agents are now
    // unreachable, so reap them. before-quit handles the real-quit path.
    void teardownChildren()
  } else {
    app.quit()
  }
})

// Authoritative teardown for every quit path (Cmd+Q, app.quit() from anywhere,
// auto-update relaunch) — window-all-closed alone misses these and on macOS
// never fires. Defer the quit until children are reaped, with a hard ceiling so
// a stuck child can't block exit forever.
let isQuitting = false
app.on('before-quit', (event) => {
  if (isQuitting) return
  event.preventDefault()
  isQuitting = true
  const forceExit = setTimeout(() => app.exit(0), 5000)
  void teardownChildren()
  Promise.allSettled([...pendingTeardowns]).finally(() => {
    clearTimeout(forceExit)
    app.exit(0)
  })
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

ipcMain.handle('file:pick', async () => {
  if (!activeVaultPath) return null
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    defaultPath: activeVaultPath,
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown'] },
      { name: 'Code', extensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'yaml', 'yml', 'toml', 'sh', 'py', 'rb', 'go', 'rs', 'css', 'html'] },
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
  let resolvedChosen: string
  let resolvedVault: string
  try {
    resolvedChosen = await fs.realpath(path.resolve(chosen))
    resolvedVault = await fs.realpath(activeVaultPath)
  } catch {
    return null
  }
  if (!resolvedChosen.startsWith(resolvedVault + path.sep) && resolvedChosen !== resolvedVault) {
    console.warn('[file:pick] path outside vault allowlist, rejecting:', resolvedChosen)
    return null
  }
  return resolvedChosen
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
    // Test every vault-relative path segment, not just the basename: under the
    // macOS fsevents backend the watcher receives deep paths, and a basename-only
    // check let internal files leak (.marvin/.../_manifest.json,
    // .obsidian/workspace.json) into snapshots and the turn's modified-files list.
    ignored: (p) => relPathIsNoisy(path.relative(resolvedVault, p)),
    ignoreInitial: true,
    persistent: true,
  })
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

// Re-throw fs errors as MARVIN_FS_<CODE> so raw host paths never reach the
// renderer (e.g. "EACCES: ... '/Users/lipe/vault/foo.md'"). Our own MARVIN_*/
// SNAPSHOT_* codes pass through untouched. Mirrors the snapshot err() envelope.
export function wrapFsError(e: unknown): never {
  const msg = e instanceof Error ? e.message : ''
  if (/^(MARVIN|SNAPSHOT)_[A-Z_]+/.test(msg)) throw e
  const code = (e as NodeJS.ErrnoException)?.code
  throw new Error(code ? `MARVIN_FS_${code}` : 'MARVIN_FS_UNKNOWN')
}

ipcMain.handle('file:read', async (_e, filePath: string) => {
  try {
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
  } catch (e) {
    wrapFsError(e)
  }
})

ipcMain.handle('file:write', async (_e, filePath: string, content: string) => {
  try {
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
  } catch (e) {
    wrapFsError(e)
  }
})

ipcMain.handle('office:readDocx', async (_e, filePath: string) => {
  const mammoth = await import('mammoth')
  const safe = await assertInVault(filePath)
  const stats = await fs.stat(safe)
  if (stats.size > 25 * 1024 * 1024) throw new Error(`MARVIN_TOO_LARGE: ${stats.size}`)
  const buf = await fs.readFile(safe)
  const result = await mammoth.convertToHtml({ buffer: buf })
  return { html: result.value, messages: result.messages }
})

ipcMain.handle('office:writeDocx', async (_e, filePath: string, plainText: string) => {
  if (plainText.length > 10 * 1024 * 1024) throw new Error('MARVIN_TOO_LARGE')
  const { Document, Paragraph, TextRun, Packer } = await import('docx')
  const safe = await assertInVault(filePath)
  const paragraphs = plainText.split(/\n\n+/).map(
    (text) => new Paragraph({ children: [new TextRun(text)] })
  )
  const doc = new Document({ sections: [{ children: paragraphs }] })
  const buf = await Packer.toBuffer(doc)
  await fs.writeFile(safe, buf)
})

ipcMain.handle('office:readXlsx', async (_e, filePath: string, sheetName?: string) => {
  const XLSX = await import('xlsx')
  const safe = await assertInVault(filePath)
  const stats = await fs.stat(safe)
  if (stats.size > 25 * 1024 * 1024) throw new Error(`MARVIN_TOO_LARGE: ${stats.size}`)
  const buf = await fs.readFile(safe)
  // cellFormula/cellHTML disabled to reduce parser attack surface (SheetJS CVEs)
  const wb = XLSX.read(buf, { type: 'buffer', cellFormula: false, cellHTML: false })
  const sheetNames = wb.SheetNames
  const targetSheet = sheetName && sheetNames.includes(sheetName) ? sheetName : sheetNames[0]
  const sheet = wb.Sheets[targetSheet]
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })
  const rows = raw.map((r) => (r as unknown[]).map((c) => (c == null ? '' : String(c))))
  return { rows, sheetNames }
})

const XLSX_SHEET_NAME_RE = /[\[\]:*?/\\]/

ipcMain.handle('office:writeXlsx', async (_e, filePath: string, rows: unknown, sheetName: unknown) => {
  if (
    !Array.isArray(rows) ||
    !rows.every(
      (r) =>
        Array.isArray(r) &&
        r.every((c) => typeof c === 'string' || typeof c === 'number' || c == null),
    )
  ) {
    throw new Error('MARVIN_INVALID_ROWS')
  }
  if (
    typeof sheetName !== 'string' ||
    sheetName.length === 0 ||
    sheetName.length > 31 ||
    XLSX_SHEET_NAME_RE.test(sheetName)
  ) {
    throw new Error('MARVIN_INVALID_SHEET_NAME')
  }
  let totalCells = 0
  for (const r of rows as unknown[][]) {
    totalCells += r.length
    if (totalCells > 1_000_000) throw new Error('MARVIN_TOO_LARGE')
  }
  const XLSX = await import('xlsx')
  const safe = await assertInVault(filePath)
  const ws = XLSX.utils.aoa_to_sheet(rows as string[][])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  await fs.writeFile(safe, buf)
})

ipcMain.handle('file:create', async (_e, parentDir: string, name: string) => {
  const safeName = name.endsWith('.md') ? name : `${name}.md`
  const full = path.join(parentDir, safeName)
  const safe = await assertInVault(full)
  if (existsSync(safe)) throw new Error('File already exists')
  await fs.mkdir(path.dirname(safe), { recursive: true })
  await fs.writeFile(safe, '', 'utf8')
  notifyTree()
  return safe
})

ipcMain.handle('file:writeBinary', async (_e, payload: { vaultPath: string; relPath: string; base64Bytes: string; maxBytes?: number }) => {
  try {
    const { vaultPath, relPath, base64Bytes, maxBytes } = payload
    const absolute = path.join(vaultPath, relPath)
    const safe = await assertInVault(absolute)
    const limit = maxBytes ?? 25 * 1024 * 1024
    // Cheap raw-length gate BEFORE decoding: base64 packs 3 bytes per 4 chars, so a
    // string longer than (limit * 4 / 3) + 4 always decodes past the cap. Rejecting
    // here avoids allocating a huge Buffer in main-process RAM for a hostile renderer.
    if (base64Bytes.length > Math.floor((limit * 4) / 3) + 4) {
      throw new Error('MARVIN_TOO_LARGE: payload')
    }
    // Exact check on decoded length catches adversarial padding under the raw gate.
    const decoded = Buffer.from(base64Bytes, 'base64')
    if (decoded.length > limit) throw new Error(`MARVIN_TOO_LARGE: ${decoded.length}`)
    await fs.mkdir(path.dirname(safe), { recursive: true })
    await fs.writeFile(safe, decoded)
    return path.relative(vaultPath, safe)
  } catch (e) {
    wrapFsError(e)
  }
})

ipcMain.handle('folder:create', async (_e, parentDir: string, name: string) => {
  const full = path.join(parentDir, name)
  const safe = await assertInVault(full)
  if (existsSync(safe)) throw new Error('Folder already exists')
  await fs.mkdir(safe, { recursive: false })
  notifyTree()
  return safe
})

ipcMain.handle('file:copy', async (_e, srcPath: string, destDir: string): Promise<string> => {
  const safeSrc = await assertInVault(srcPath)
  const safeDir = await assertInVault(destDir)
  const destPath = await resolveConflict(safeDir, path.basename(safeSrc), 'copy')
  await fs.cp(safeSrc, destPath, { recursive: true, errorOnExist: false })
  notifyTree()
  return destPath
})

ipcMain.handle('file:move-batch', async (_e, srcs: string[], destDir: string): Promise<MoveResult[]> => {
  const safeDir = await assertInVault(destDir)
  const results: MoveResult[] = []
  const moved: { src: string; dest: string }[] = []
  for (const src of srcs) {
    try {
      const safeSrc = await assertInVault(src)
      const destPath = await resolveConflict(safeDir, path.basename(safeSrc), 'move')
      await fs.mkdir(path.dirname(destPath), { recursive: true })
      try {
        await fs.rename(safeSrc, destPath)
      } catch (err) {
        // EXDEV: src and dest on different filesystems (e.g., USB vault → internal disk).
        if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
        await fs.cp(safeSrc, destPath, { recursive: true })
        await fs.rm(safeSrc, { recursive: true, force: true })
      }
      moved.push({ src: safeSrc, dest: destPath })
      results.push({ src, dest: destPath, ok: true })
    } catch (err) {
      results.push({ src, dest: '', ok: false, error: (err as Error).message })
    }
  }
  // Single vault walk for all successful moves — avoids O(N×M) listAllMarkdown calls.
  if (activeVaultPath && moved.length > 0) {
    try {
      await rewriteLinksAfterMoveBatch(activeVaultPath, moved)
    } catch (err) {
      console.error('[rewriteLinksAfterMove] move-batch failed', err)
    }
  }
  notifyTree()
  return results
})

async function rewriteLinksAfterMoveBatch(
  vaultRoot: string,
  moves: { src: string; dest: string }[],
): Promise<void> {
  const files = await listAllMarkdown(vaultRoot)
  const cascadeTurnId = newTurnId()
  await Promise.all(
    files.map(async (file) => {
      try {
        const original = await fs.readFile(file, 'utf8')
        let content = original
        for (const { src, dest } of moves) {
          content = rewriteOneFile(file, vaultRoot, src, dest, content)
          content = rewriteWikilinksOneFile(vaultRoot, src, dest, content)
        }
        if (content !== original) {
          const relPath = path.relative(vaultRoot, file)
          await writeSnapshot(vaultRoot, cascadeTurnId, relPath, original, 'cascade')
          await fs.writeFile(file, content, 'utf8')
        }
      } catch (err) {
        // Tolerate files that vanished mid-walk; surface anything else.
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error('[rewriteLinksAfterMoveBatch] skipping file', file, err)
        }
      }
    }),
  )
}

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
  notifyTree()
  return safeNew
})

ipcMain.handle('path:trash', async (_e, target: string) => {
  const safe = await assertInVault(target)
  await shell.trashItem(safe)
  notifyTree()
})

ipcMain.handle('file:exportPdf', async (_e, filePath: string) => {
  const content = await fs.readFile(filePath, 'utf-8')
  const dir = path.dirname(filePath)

  const { marked } = await import('marked')
  const bodyHtml = await marked(content)

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; line-height: 1.6; color: #1a1a1a; }
  h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; }
  img { max-width: 100%; height: auto; }
  pre { background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow-x: auto; }
  code { font-family: monospace; font-size: 0.9em; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 0.5rem; }
  blockquote { border-left: 4px solid #ddd; margin: 0; padding-left: 1rem; color: #555; }
</style>
</head><body>${bodyHtml}</body></html>`

  const tmpPath = path.join(dir, `._marvinz_export_${Date.now()}.html`)
  await fs.writeFile(tmpPath, html, 'utf-8')

  const exportWin = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })

  try {
    await exportWin.loadFile(tmpPath)

    const { canceled, filePath: savePath } = await dialog.showSaveDialog({
      defaultPath: filePath.replace(/\.md$/, '.pdf'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })

    if (!canceled && savePath) {
      const pdfBuffer = await exportWin.webContents.printToPDF({ printBackground: true })
      await fs.writeFile(savePath, Buffer.from(pdfBuffer))
    }
  } finally {
    exportWin.destroy()
    await fs.unlink(tmpPath).catch(() => {})
  }
})

ipcMain.handle('fs:importExternal', async (_e, sources: string[], destDir: string) => {
  if (!activeVaultPath) throw new Error('MARVIN_OUTSIDE_VAULT')
  const result = await importExternal(activeVaultPath, sources, destDir)
  notifyTree()
  return result
})

ipcMain.handle('search:content', async (_e, query: string) => {
  if (!activeVaultPath) return []
  return searchContent(activeVaultPath, query)
})

ipcMain.handle('shell:reveal', async (_e, target: string) => {
  const safe = await assertInVault(target)
  shell.showItemInFolder(safe)
})

type MenuItemSpec =
  | { kind: 'item'; id: string; label: string; accelerator?: string; enabled?: boolean }
  | { kind: 'separator' }

function showContextMenu(e: Electron.IpcMainInvokeEvent, items: MenuItemSpec[]): Promise<string | null> {
  return new Promise<string | null>(resolve => {
    let chosen: string | null = null
    const menu = new Menu()
    for (const spec of items) {
      if (spec.kind === 'separator') {
        menu.append(new MenuItem({ type: 'separator' }))
      } else {
        menu.append(new MenuItem({
          label: spec.label,
          accelerator: spec.accelerator,
          enabled: spec.enabled ?? true,
          click: () => { chosen = spec.id },
        }))
      }
    }
    const win = BrowserWindow.fromWebContents(e.sender)
    menu.popup({ window: win ?? undefined, callback: () => resolve(chosen) })
  })
}

ipcMain.handle('app:show-context-menu', (e, items: MenuItemSpec[]): Promise<string | null> => {
  return showContextMenu(e, items)
})

ipcMain.handle('app:can-paste', (): boolean =>
  clipboard.availableFormats().some(f => f.startsWith('text/') || f === 'text')
)

// Renderer reports whether a note tab is active so the app menu can disable
// the note-only items (Export PDF, Reveal in Finder). Rebuilds the menu.
ipcMain.on('app:menu-note-context', (_e, hasNoteTab: boolean) => {
  if (typeof hasNoteTab !== 'boolean' || hasNoteTab === menuHasNoteTab) return
  menuHasNoteTab = hasNoteTab
  buildAppMenu()
})

ipcMain.handle('editor:clipboard-read', (): string => {
  return clipboard.readText()
})

ipcMain.handle('editor:clipboard-write', (_e, text: string): void => {
  clipboard.writeText(text)
})

ipcMain.handle('editor:clipboard-write-rich', (_e, payload: { html: string; text: string }): void => {
  clipboard.write({ html: payload.html, text: payload.text })
})

ipcMain.handle('editor:clipboard-read-rich', (): { html: string; text: string } => {
  return { html: clipboard.readHTML(), text: clipboard.readText() }
})

ipcMain.handle('editor:spellcheck-context', () => lastSpellcheck)

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
    registerDetectedAgent(detected)
    // Also register on the pty allowlist so users can open the agent in the
    // legacy xterm terminal via pty:spawn (the chat panel uses child_process.spawn,
    // but the terminal panel uses pty.spawn and needs the binary allowlisted).
    registerDynamicShell(detected)
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
      geometry: null,
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

// Geometry descriptor path: renderer registers insets from window edges once
// (and on panel layout changes). Main recomputes absolute bounds synchronously
// on every win.on('resize') without a renderer round-trip — eliminates the
// "wait then snap" on macOS maximize/restore.
ipcMain.handle(
  'browser:setGeometry',
  (
    _e,
    id: string,
    geometry: { leftInset: number; topInset: number; rightInset: number; bottomInset: number },
  ) => {
    const entry = browserViews.get(id)
    if (!entry || !win || win.isDestroyed()) return
    entry.geometry = geometry
    const { width: contentWidth, height: contentHeight } = win.getContentBounds()
    const newBounds = boundsFromGeometry(geometry, contentWidth, contentHeight)
    entry.lastBounds = newBounds
    applyBounds(entry)
  },
)

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
    notifyTree()
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
