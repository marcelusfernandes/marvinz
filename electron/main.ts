import { app, BrowserWindow, protocol, shell, Menu } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process'
import {
  writeSnapshot,
  newTurnId,
  completeTurn,
  listTurns,
  type SnapshotTrigger,
} from './snapshot.js'
import { assertInsideVaultAsync } from './vault-boundary.js'
import { killAllAgents } from './agent/index.js'
import { debounce } from './debounce.js'
import { BoundedCache } from './bounded-cache.js'
import { registerPtyHandlers, killAllPty } from './ipc/pty.js'
import { registerFsHandlers, getLinkRewriteQueue } from './ipc/fs-handlers.js'
import { registerBrowserHandlers } from './ipc/browser.js'
import { registerSnapshotHandlers } from './ipc/snapshot-handlers.js'
import { registerAgentHandlers } from './ipc/agent.js'
import { registerVaultHandlers, readSettings, closeVaultWatcher } from './ipc/vault-handlers.js'
import { registerShellMenuHandlers } from './ipc/shell-menu-handlers.js'
import { IPC_CHANNELS } from '../src/shared/ipc-channels.js'

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
  win?.webContents.send(IPC_CHANNELS.vault.changed)
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
      win.webContents.send(IPC_CHANNELS.snapshot.turnCompleted, {
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
    if (win && !win.isDestroyed()) win.webContents.send(IPC_CHANNELS.app.menuAction, action)
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
  closeVaultWatcher()
  notifyTree.cancel()
  // Waits for any in-flight fire-and-forget link rewrite (#566) too — mitigates
  // a graceful quit racing a queued rewrite. getLinkRewriteQueue() never
  // rejects (see electron/ipc/fs-handlers.ts's enqueueLinkRewrite), so this
  // can't turn a clean quit into a hang or an unhandled rejection. A hard
  // crash/force-kill bypasses this entirely (no JS runs), which is the
  // accepted, unmitigable trade-off.
  const done = Promise.all([killAllAgents(), getLinkRewriteQueue()]).then(() => {})
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

// Re-throw fs errors as MARVIN_FS_<CODE> so raw host paths never reach the
// renderer (e.g. "EACCES: ... '/Users/lipe/vault/foo.md'"). Our own MARVIN_*/
// SNAPSHOT_* codes pass through untouched. Mirrors the snapshot err() envelope.
//
// Stays here (not moved into fs-handlers.ts with the handlers that use it)
// because vault-handlers.ts's folder:create and shell-menu-handlers.ts's
// shell:reveal also call it; threaded into each module via ctx.
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
  notifyTree,
  setFileCacheEntry: (key, value) => {
    fileContentCache.set(key, value)
  },
})

registerVaultHandlers({
  getActiveVaultPath: () => activeVaultPath,
  setActiveVaultPath: (path) => {
    activeVaultPath = path
  },
  getAllowedVaultPaths: () => allowedVaultPaths,
  assertInVault,
  wrapFsError,
  snapshotBeforeMutation,
  resetVaultSessionState,
  notifyTree,
  cancelNotifyTree: () => notifyTree.cancel(),
  getFileCacheEntry: (key) => fileContentCache.get(key),
  setFileCacheEntry: (key, value) => {
    fileContentCache.set(key, value)
  },
  deleteFileCacheEntry: (key) => {
    fileContentCache.delete(key)
  },
  isAiTurnActive: () => Date.now() - lastPtyWriteAt < AI_TURN_WINDOW_MS,
  getWin: () => win,
})

registerShellMenuHandlers({
  assertInVault,
  setMenuNoteContext: (hasNoteTab) => {
    if (hasNoteTab === menuHasNoteTab) return
    menuHasNoteTab = hasNoteTab
    buildAppMenu()
  },
  getSpellcheckContext: () => lastSpellcheck,
})

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
