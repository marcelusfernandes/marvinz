import { app, BrowserWindow, WebContentsView, ipcMain, dialog, net, protocol, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { execSync } from 'node:child_process'
import chokidar, { type FSWatcher } from 'chokidar'
import * as pty from 'node-pty'

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
const ptyProcesses = new Map<string, pty.IPty>()

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

type Settings = { vaultPath?: string }

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
    backgroundColor: '#1e1e1e',
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
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
  pdf: 'application/pdf',
}

function mimeFor(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop() ?? ''
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

app.whenReady().then(() => {
  protocol.handle('marvin', async (request) => {
    try {
      const u = new URL(request.url)
      const filePath = decodeURIComponent(u.pathname)
      if (!activeVaultPath) {
        console.warn('[marvin] no active vault, rejecting', request.url)
        return new Response('No vault', { status: 403 })
      }
      if (!filePath.startsWith(activeVaultPath)) {
        console.warn('[marvin] outside vault, rejecting', filePath, 'vault=', activeVaultPath)
        return new Response('Forbidden', { status: 403 })
      }
      const data = await fs.readFile(filePath)
      // Buffer is a Uint8Array subclass; Response accepts BodyInit which
      // includes ArrayBuffer / Uint8Array — cast to satisfy TS.
      return new Response(data as unknown as BodyInit, {
        headers: { 'Content-Type': mimeFor(filePath) },
      })
    } catch (err) {
      console.error('[marvin] handler failed', request.url, err)
      return new Response('Error', { status: 500 })
    }
  })
  createWindow()
})

app.on('window-all-closed', () => {
  for (const p of ptyProcesses.values()) p.kill()
  ptyProcesses.clear()
  vaultWatcher?.close()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

ipcMain.handle('settings:get', () => readSettings())

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
  const settings = await readSettings()
  await writeSettings({ ...settings, vaultPath })
  return vaultPath
})

type FileNode = {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

const NOISY_DIRS = new Set(['.git', 'node_modules', '.DS_Store', '.svn', '.hg', '.idea'])
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

ipcMain.handle('vault:tree', async (_e, vaultPath: string) => {
  if (!vaultPath || !existsSync(vaultPath)) return []
  return readVaultTree(vaultPath)
})

ipcMain.handle('vault:watch', (_e, vaultPath: string) => {
  vaultWatcher?.close()
  activeVaultPath = vaultPath || null
  if (!vaultPath) return
  vaultWatcher = chokidar.watch(vaultPath, {
    ignored: (p) => {
      const base = path.basename(p)
      return NOISY_DIRS.has(base) || NOISY_FILES.has(base)
    },
    ignoreInitial: true,
    persistent: true,
  })
  const notifyTree = () => win?.webContents.send('vault:changed')
  const notifyFile = (filePath: string) =>
    win?.webContents.send('file:changed', filePath)
  vaultWatcher
    .on('add', (p) => {
      notifyTree()
      notifyFile(p)
    })
    .on('change', (p) => notifyFile(p))
    .on('unlink', notifyTree)
    .on('addDir', notifyTree)
    .on('unlinkDir', notifyTree)
})

const FILE_SIZE_LIMIT = 5 * 1024 * 1024 // 5 MB — guard against pathologically large files
const BINARY_PROBE_BYTES = 8192 // any null byte in the first 8 KB → treat as binary

ipcMain.handle('file:read', async (_e, filePath: string) => {
  const stats = await fs.stat(filePath)
  if (stats.size > FILE_SIZE_LIMIT) {
    throw new Error(`MARVIN_TOO_LARGE: ${stats.size}`)
  }
  // Sniff the head for null bytes — the standard binary heuristic. Most
  // text formats (utf-8) don't contain literal NUL; most binary files do.
  if (stats.size > 0) {
    const fd = await fs.open(filePath, 'r')
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
  return fs.readFile(filePath, 'utf8')
})

ipcMain.handle('file:write', async (_e, filePath: string, content: string) => {
  await fs.writeFile(filePath, content, 'utf8')
})

ipcMain.handle('file:create', async (_e, parentDir: string, name: string) => {
  const safeName = name.endsWith('.md') ? name : `${name}.md`
  const full = path.join(parentDir, safeName)
  if (existsSync(full)) throw new Error('File already exists')
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, '', 'utf8')
  return full
})

ipcMain.handle('folder:create', async (_e, parentDir: string, name: string) => {
  const full = path.join(parentDir, name)
  if (existsSync(full)) throw new Error('Folder already exists')
  await fs.mkdir(full, { recursive: false })
  return full
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
    const oldAbsTarget = path.resolve(oldFileDir, decoded)

    // Where does this absolute path live AFTER the rename?
    const newAbsTarget = remappedPath(oldAbsTarget, oldPath, newPath) ?? oldAbsTarget

    // If this file didn't move AND the target didn't move, nothing to do.
    if (!fileOldLocation && newAbsTarget === oldAbsTarget) return match

    const newRel = path.relative(newFileDir, newAbsTarget) || '.'
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
 * Rewrite `[[wikilinks]]` whose target points at the renamed file so they
 * keep resolving after the rename. Only runs when a markdown file is
 * renamed; folder-only renames don't change basenames.
 *
 * - `[[Foo]]` / `[[Foo|Bar]]` / `[[Foo#sec]]` — rewritten when the bare
 *   basename matches the old file's basename.
 * - `[[folder/Foo]]` — rewritten when its vault-relative path matches
 *   exactly the renamed file.
 */
function rewriteWikilinksOneFile(
  vaultRoot: string,
  oldPath: string,
  newPath: string,
  content: string,
): string {
  if (!/\.(md|markdown)$/i.test(oldPath)) return content

  const oldBase = stripMdExt(path.basename(oldPath))
  const newBase = stripMdExt(path.basename(newPath))
  const newRel = path.relative(vaultRoot, newPath)
  const newTargetPath = stripMdExt(newRel)

  return content.replace(WIKILINK_RE, (match, rawName, rawDisplay) => {
    const name = String(rawName)
    const hashIdx = name.indexOf('#')
    const target = hashIdx >= 0 ? name.slice(0, hashIdx) : name
    const fragment = hashIdx >= 0 ? name.slice(hashIdx) : ''
    const displaySuffix = rawDisplay ? `|${rawDisplay}` : ''

    if (target.includes('/')) {
      const withExt = /\.(md|markdown)$/i.test(target) ? target : `${target}.md`
      const abs = path.join(vaultRoot, withExt)
      if (abs !== oldPath) return match
      return `[[${newTargetPath}${fragment}${displaySuffix}]]`
    }

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
  await Promise.all(
    files.map(async (file) => {
      try {
        const content = await fs.readFile(file, 'utf8')
        let next = rewriteOneFile(file, oldPath, newPath, content)
        next = rewriteWikilinksOneFile(vaultRoot, oldPath, newPath, next)
        if (next !== content) {
          await fs.writeFile(file, next, 'utf8')
        }
      } catch {
        // best-effort; skip files that vanished mid-walk
      }
    }),
  )
}

ipcMain.handle('path:rename', async (_e, oldPath: string, newPath: string) => {
  if (existsSync(newPath)) throw new Error('Target path already exists')
  await fs.mkdir(path.dirname(newPath), { recursive: true })
  await fs.rename(oldPath, newPath)
  if (activeVaultPath && oldPath.startsWith(activeVaultPath)) {
    try {
      await rewriteLinksAfterMove(activeVaultPath, oldPath, newPath)
    } catch (err) {
      console.error('[rewriteLinksAfterMove] failed', err)
    }
  }
  return newPath
})

ipcMain.handle('path:trash', async (_e, target: string) => {
  await shell.trashItem(target)
})

ipcMain.handle('shell:reveal', async (_e, target: string) => {
  shell.showItemInFolder(target)
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

ipcMain.handle('agent:detect', async (_e, name: string) => detectBinary(name))

// Back-compat shim for the previous renderer API.
ipcMain.handle('claude:detect', async () => detectBinary('claude'))

ipcMain.handle(
  'pty:spawn',
  (_e, opts: { id: string; shell: string; cwd: string; cols: number; rows: number; args?: string[] }) => {
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
      const ptyProcess = pty.spawn(opts.shell, opts.args ?? [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: opts.cwd,
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
      ptyProcess.onData((data) => safeSend(`pty:data:${opts.id}`, data))
      ptyProcess.onExit(({ exitCode }) => {
        safeSend(`pty:exit:${opts.id}`, exitCode)
        ptyProcesses.delete(opts.id)
      })
      return { pid: ptyProcess.pid }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Failed to spawn ${opts.shell}: ${message}`)
    }
  },
)

ipcMain.handle('pty:write', (_e, id: string, data: string) => {
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
