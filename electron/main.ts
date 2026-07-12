import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  shell,
  Menu,
  MenuItem,
  clipboard,
} from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process'
import chokidar, { type FSWatcher } from 'chokidar'
import {
  writeSnapshot,
  newTurnId,
  ensureVaultGitignore,
  completeTurn,
  listTurns,
  type SnapshotTrigger,
} from './snapshot.js'
import { assertInsideVaultAsync } from './vault-boundary.js'
import { assertAllowedVault } from './vault-allowlist.js'
import { isNoisy, relPathIsNoisy } from './noisyPaths.js'
import { killAllAgents } from './agent/index.js'
import { importExternal } from './fs-import-external.js'
import { debounce } from './debounce.js'
import { BoundedCache } from './bounded-cache.js'
import { searchContent } from './search-content.js'
import { resolveConflict } from './conflictResolver.js'
import { registerPtyHandlers, killAllPty } from './ipc/pty.js'
import { registerFsHandlers } from './ipc/fs-handlers.js'
import { registerBrowserHandlers } from './ipc/browser.js'
import { registerSnapshotHandlers } from './ipc/snapshot-handlers.js'
import { registerAgentHandlers } from './ipc/agent.js'
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
let lastSpellcheck: { misspelledWord: string; suggestions: string[] } = {
  misspelledWord: '',
  suggestions: [],
}
let vaultWatcher: FSWatcher | null = null
let activeVaultPath: string | null = null

// Push a tree-refresh signal to the renderer. Mutation handlers call this
// after their op so the UI doesn't depend on chokidar/fsevents catching a
// rapid unlink+add sequence (which it sometimes coalesces on macOS).
//
// Debounced (trailing-edge): a burst of structural fs events (git checkout,
// an agent turn creating many files, archive extraction) otherwise fires one
// full recursive readVaultTree walk per event, almost all of them discarded
// before the last one lands. Coalescing to a single emission after the burst
// settles reflects live on-disk state regardless of intra-burst ordering, at
// the cost of a bounded, imperceptible delay (#571).
const NOTIFY_TREE_DEBOUNCE_MS = 200
const notifyTree = debounce((): void => {
  win?.webContents.send('vault:changed')
}, NOTIFY_TREE_DEBOUNCE_MS)
// Allowlist of vault paths that were opened via OS dialog (vault:pick) or loaded
// from the persisted settings file. vault:watch only accepts paths in this set.
const allowedVaultPaths = new Set<string>()

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

// Cancels a pending scheduleTurnEnd timer without finalizing — used by the
// pty:* handlers (electron/ipc/pty.ts) when the last pty exits and a turn end
// fires immediately instead of waiting out the timer (#570).
function cancelScheduledTurnEnd(): void {
  if (turnEndTimer) {
    clearTimeout(turnEndTimer)
    turnEndTimer = null
  }
}

// Centralizes the "AI turn active -> adopt/allocate activeTurnId -> snapshot
// before mutating" invariant shared by file:write, path:rename, and the
// watcher's snapshotExternalChange (#569).
//
// `precondition` covers each call site's extra gate (existsSync for
// file:write/path:rename, the vault-relative path match for the watcher) —
// checked, like the shared aiActive/activeVaultPath gate, BEFORE activeTurnId
// is touched, so a call that doesn't qualify never starts a turn.
//
// `readBefore` resolves the pre-mutation content, or returns null to signal
// "skip the snapshot" — file:write's no-op check (identical content) and the
// watcher's cache-miss/no-change skips need to bypass the snapshot without
// this helper knowing about their site-specific reasons, so they communicate
// it via this return value rather than a thrown error.
//
// NOTE: activeTurnId adoption happens BEFORE readBefore() runs, matching
// every original call site — an AI-active call that turns out to be a no-op
// (e.g. file:write with identical content) still starts a turn if none was
// active yet. This is pre-existing behavior, preserved deliberately here, not
// a new decision made by this refactor.
export async function snapshotBeforeMutation(
  absPath: string,
  source: SnapshotTrigger,
  precondition: () => boolean,
  readBefore: () => Promise<string | null>
): Promise<void> {
  const aiActive = Date.now() - lastPtyWriteAt < AI_TURN_WINDOW_MS
  if (!aiActive || !activeVaultPath || !precondition()) return
  const vaultRoot = activeVaultPath
  const turnId = activeTurnId ?? newTurnId()
  if (!activeTurnId) activeTurnId = turnId
  const relPath = path.relative(vaultRoot, absPath)
  try {
    const before = await readBefore()
    if (before == null) return
    await writeSnapshot(vaultRoot, turnId, relPath, before, source)
  } catch (err) {
    console.error(`[snapshot] ${source} pre-mutation snapshot failed`, { relPath, turnId, err })
  }
}

// Called from vault:watch before adopting a new vault (or closing the current
// one), while `activeVaultPath` still holds the OLD vault root. Without this,
// an in-flight turn started in the old vault survives the switch: its
// turnId gets reused for the new vault's snapshots (writing fragments under a
// manifest that lives in the old vault's .marvin folder, or under no manifest
// at all), and the old vault's turn is abandoned without ever being finalized
// (#568).
async function resetVaultSessionState(): Promise<void> {
  if (turnEndTimer) {
    clearTimeout(turnEndTimer)
    turnEndTimer = null
  }
  const turnId = activeTurnId
  const vaultRoot = activeVaultPath
  activeTurnId = null
  lastPtyWriteAt = 0
  fileContentCache.clear()
  if (turnId && vaultRoot) {
    try {
      await finalizeTurn(vaultRoot, turnId)
    } catch (err) {
      console.error('[snapshot] finalizeTurn on vault switch failed', { vaultRoot, turnId, err })
    }
  }
}

// Last-read cache — populated by file:read, used by the watcher to obtain the
// "before" content when an external change is detected.
// Limitation: if the watcher fires for a file that was never read through the
// app (e.g. edited externally before any app open), the cache misses and no
// snapshot is taken. This is a known best-effort race between disk change
// detection and in-process state.
//
// Bounded (LRU) so a long session touching many files doesn't retain
// unbounded memory: each entry holds up to FILE_SIZE_LIMIT (5 MB) of text, so
// this cap is a soft heuristic on working-set size, not a strict byte-total
// guarantee (#568).
export const FILE_CONTENT_CACHE_MAX_ENTRIES = 100
const fileContentCache = new BoundedCache<string, string>(FILE_CONTENT_CACHE_MAX_ENTRIES)

// Renderer-safe send for browser-tab events — a closed-but-non-null window
// throws "Object has been destroyed" on send. Stays here (not moved into
// electron/ipc/browser.ts with the browser handlers it also serves) because
// electron/ipc/pty.ts's ctx also uses it as sendToRenderer (#570); threaded
// into both via ctx.
function safeBrowserSend(channel: string, payload: unknown) {
  try {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  } catch {
    // renderer being torn down — ignore
  }
}

const { reapplyAllWithGeometry } = registerBrowserHandlers({
  getWin: () => win,
  sendToRenderer: safeBrowserSend,
})

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
    lastSpellcheck = {
      misspelledWord: params.misspelledWord,
      suggestions: params.dictionarySuggestions,
    }
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
  hasNoteTab = false
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
  // destroyed" on send — mirror the safeBrowserSend idiom.
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
  readSettings()
    .then(async (s) => {
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
    })
    .catch(() => {})

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
  killAllPty()
  vaultWatcher?.close()
  notifyTree.cancel()
  // Waits for any in-flight fire-and-forget link rewrite (#566) too — mitigates
  // a graceful quit racing a queued rewrite. linkRewriteQueue never rejects
  // (see enqueueLinkRewrite), so this can't turn a clean quit into a hang or
  // an unhandled rejection. A hard crash/force-kill bypasses this entirely
  // (no JS runs), which is the accepted, unmitigable trade-off.
  const done = Promise.all([killAllAgents(), linkRewriteQueue]).then(() => {})
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
    await resetVaultSessionState()
    vaultWatcher?.close()
    notifyTree.cancel()
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
  await resetVaultSessionState()
  vaultWatcher?.close()
  notifyTree.cancel()
  activeVaultPath = resolvedVault
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
    win?.webContents.send('file:changed', filePath, source)

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
    await snapshotBeforeMutation(
      filePath,
      'watcher',
      () =>
        !!activeVaultPath &&
        (filePath === activeVaultPath || filePath.startsWith(activeVaultPath + path.sep)),
      async () => {
        if (!activeVaultPath) return null // guarded by precondition above; narrows for TS
        const relPath = path.relative(activeVaultPath, filePath)
        const before = fileContentCache.get(filePath)

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
          fileContentCache.set(filePath, after)
          return null
        }

        if (before === after) {
          fileContentCache.set(filePath, after)
          return null
        }

        fileContentCache.set(filePath, after)
        return before
      }
    )
  }

  vaultWatcher
    .on('add', (p) => {
      notifyTree()
      notifyFile(p, Date.now() - lastPtyWriteAt < AI_TURN_WINDOW_MS ? 'agent' : 'external')
    })
    .on('change', (p) => {
      const source: 'agent' | 'external' =
        Date.now() - lastPtyWriteAt < AI_TURN_WINDOW_MS ? 'agent' : 'external'
      snapshotExternalChange(p).catch((err) =>
        console.error('[snapshot] snapshotExternalChange unhandled', err)
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

// Re-throw fs errors as MARVIN_FS_<CODE> so raw host paths never reach the
// renderer (e.g. "EACCES: ... '/Users/lipe/vault/foo.md'"). Our own MARVIN_*/
// SNAPSHOT_* codes pass through untouched. Mirrors the snapshot err() envelope.
//
// Stays here (not moved into fs-handlers.ts with the handlers that use it)
// because file:writeBinary, folder:create, and file:move-batch — all
// out of scope for #574 — also call it; threaded into fs-handlers.ts via ctx.
export function wrapFsError(e: unknown): never {
  const msg = e instanceof Error ? e.message : ''
  if (/^(MARVIN|SNAPSHOT)_[A-Z_]+/.test(msg)) throw e
  const code = (e as { code?: string } | null | undefined)?.code
  throw new Error(code ? `MARVIN_FS_${code}` : 'MARVIN_FS_UNKNOWN')
}

registerFsHandlers({
  getActiveVaultPath: () => activeVaultPath,
  assertInVault,
  wrapFsError,
  snapshotBeforeMutation,
  enqueueLinkRewrite,
  notifyTree,
  setFileCacheEntry: (key, value) => {
    fileContentCache.set(key, value)
  },
})

ipcMain.handle(
  'file:writeBinary',
  async (
    _e,
    payload: { vaultPath: string; relPath: string; base64Bytes: string; maxBytes?: number }
  ) => {
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
  }
)

ipcMain.handle('folder:create', async (_e, parentDir: string, name: string) => {
  try {
    const full = path.join(parentDir, name)
    const safe = await assertInVault(full)
    if (existsSync(safe)) throw new Error('MARVIN_FS_EEXIST')
    await fs.mkdir(safe, { recursive: false })
    notifyTree()
    return safe
  } catch (e) {
    wrapFsError(e)
  }
})

ipcMain.handle(
  'file:move-batch',
  async (_e, srcs: string[], destDir: string): Promise<MoveResult[]> => {
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
    // Serialized via enqueueLinkRewrite so this can't race path:rename's own
    // fire-and-forget rewrite over the same files (#566).
    if (activeVaultPath && moved.length > 0) {
      try {
        await enqueueLinkRewrite(activeVaultPath, moved)
      } catch (err) {
        console.error('[rewriteLinksAfterMove] move-batch failed', err)
      }
    }
    notifyTree()
    return results
  }
)

// Serializes rewriteLinksAfterMoveBatch across concurrent path:rename/
// file:move-batch calls: two overlapping full-vault walks could otherwise
// race on the same file's read-then-conditionally-write, and whichever write
// lands second would silently clobber the other's rewrite. Chaining every
// call onto this queue guarantees at most one rewrite pass runs at a time,
// in call order (#566).
//
// The queue chain itself must never reject — swallowing the error there (not
// on `run`) keeps a failed rewrite from poisoning every rewrite queued after
// it, while each caller's own `run` promise still rejects independently, so
// callers that await/.catch() it keep seeing their own errors.
let linkRewriteQueue: Promise<void> = Promise.resolve()

function enqueueLinkRewrite(
  vaultRoot: string,
  moves: { src: string; dest: string }[]
): Promise<void> {
  const run = linkRewriteQueue.then(() => rewriteLinksAfterMoveBatch(vaultRoot, moves))
  linkRewriteQueue = run.catch(() => {})
  return run
}

async function rewriteLinksAfterMoveBatch(
  vaultRoot: string,
  moves: { src: string; dest: string }[]
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
    })
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
const WIKILINK_RE = /\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/g

function rewriteOneFile(
  fileAbsPath: string,
  vaultRoot: string,
  oldPath: string,
  newPath: string,
  content: string
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
  content: string
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

function showContextMenu(
  e: Electron.IpcMainInvokeEvent,
  items: MenuItemSpec[]
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let chosen: string | null = null
    const menu = new Menu()
    for (const spec of items) {
      if (spec.kind === 'separator') {
        menu.append(new MenuItem({ type: 'separator' }))
      } else {
        menu.append(
          new MenuItem({
            label: spec.label,
            accelerator: spec.accelerator,
            enabled: spec.enabled ?? true,
            click: () => {
              chosen = spec.id
            },
          })
        )
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
  clipboard.availableFormats().some((f) => f.startsWith('text/') || f === 'text')
)

// Native "unsaved changes" confirmation. Window-modal sheet on macOS so it
// reads as a system prompt rather than an in-app modal.
ipcMain.handle(
  'app:confirm-unsaved',
  async (e, fileName: string): Promise<'save' | 'discard' | 'cancel'> => {
    const w = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.MessageBoxOptions = {
      type: 'warning',
      message: `Do you want to save the changes you made to “${fileName}”?`,
      detail: "Your changes will be lost if you don't save them.",
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    }
    // w is null only when the sender has no host window (effectively never
    // from the renderer); the modeless fallback is intentional, not a bug.
    const { response } = w
      ? await dialog.showMessageBox(w, opts)
      : await dialog.showMessageBox(opts)
    return response === 0 ? 'save' : response === 1 ? 'discard' : 'cancel'
  }
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

ipcMain.handle(
  'editor:clipboard-write-rich',
  (_e, payload: { html: string; text: string }): void => {
    clipboard.write({ html: payload.html, text: payload.text })
  }
)

ipcMain.handle('editor:clipboard-read-rich', (): { html: string; text: string } => {
  return { html: clipboard.readHTML(), text: clipboard.readText() }
})

ipcMain.handle('editor:spellcheck-context', () => lastSpellcheck)

registerPtyHandlers({
  getActiveVaultPath: () => activeVaultPath,
  getShellEnv,
  getActiveTurnId: () => activeTurnId,
  setActiveTurnId: (id) => {
    activeTurnId = id
  },
  setLastPtyWriteAt: (timestamp) => {
    lastPtyWriteAt = timestamp
  },
  scheduleTurnEnd,
  cancelScheduledTurnEnd,
  finalizeTurn,
  sendToRenderer: safeBrowserSend,
})

async function assertInVault(filePath: string): Promise<string> {
  if (!activeVaultPath) throw new Error('MARVIN_NO_VAULT')
  // Use the realpath-resolved path returned by assertInsideVaultAsync as the
  // canonical I/O path — eliminates the TOCTOU window between check and use (C2).
  return assertInsideVaultAsync(activeVaultPath, filePath)
}

registerSnapshotHandlers({
  getActiveVaultPath: () => activeVaultPath,
  assertInVault,
  getActiveTurnId: () => activeTurnId,
  setActiveTurnId: (id) => {
    activeTurnId = id
  },
  deleteFileCacheEntry: (key) => {
    fileContentCache.delete(key)
  },
  notifyTree,
})

registerAgentHandlers({
  getShellEnv,
  getAllowedVaultPaths: () => allowedVaultPaths,
})
