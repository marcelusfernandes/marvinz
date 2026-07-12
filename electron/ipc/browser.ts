// browser:* IPC handlers — in-app browser tab lifecycle (WebContentsView
// create/navigate/resize/show-hide/close) and geometry recompute. Extracted
// from main.ts (#575); shared state main.ts still owns (the main
// BrowserWindow, renderer send) flows in via `BrowserCtx` rather than a
// circular import of main.js. `safeBrowserSend` stays defined in main.ts
// (it's also used as the pty ctx's `sendToRenderer`, wired in #570) and is
// threaded here the same way, as `ctx.sendToRenderer`.
import { ipcMain, WebContentsView, shell, type BrowserWindow } from 'electron'

export type BrowserCtx = {
  getWin: () => BrowserWindow | null
  sendToRenderer: (channel: string, payload: unknown) => void
}

// Geometry descriptor: insets from each contentView edge to the browser-host
// element. Registered by the renderer once and reused by main on every resize.
type BrowserGeometry = {
  leftInset: number
  topInset: number
  rightInset: number
  bottomInset: number
}

type BrowserBounds = { x: number; y: number; width: number; height: number }

type BrowserEntry = {
  view: WebContentsView
  /** Last known bounds set from the renderer; fallback when no geometry registered. */
  lastBounds: BrowserBounds
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
  contentHeight: number
): BrowserBounds {
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

export function registerBrowserHandlers(ctx: BrowserCtx): { reapplyAllWithGeometry: () => void } {
  // Recompute bounds from stored geometry descriptors using current window size.
  // Called synchronously on every resize event to avoid an IPC round-trip.
  // Uses getContentBounds() — same coordinate space as getBoundingClientRect() in
  // the renderer and as WebContentsView.setBounds() (content area, excludes frame).
  function reapplyAllWithGeometry(): void {
    const win = ctx.getWin()
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

  ipcMain.handle(
    'browser:create',
    async (_e, opts: { id: string; url: string; bounds: BrowserBounds }) => {
      const win = ctx.getWin()
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
        ctx.sendToRenderer('browser:event', {
          id: opts.id,
          kind: 'nav-state',
          canBack: webContents.navigationHistory.canGoBack(),
          canForward: webContents.navigationHistory.canGoForward(),
        })
      }

      webContents.on('page-title-updated', (_evt, title) => {
        ctx.sendToRenderer('browser:event', { id: opts.id, kind: 'title', title })
      })
      webContents.on('did-navigate', (_evt, url) => {
        ctx.sendToRenderer('browser:event', { id: opts.id, kind: 'url', url })
        sendNavState()
      })
      webContents.on('did-navigate-in-page', (_evt, url) => {
        ctx.sendToRenderer('browser:event', { id: opts.id, kind: 'url', url })
        sendNavState()
      })
      webContents.on('did-start-loading', () => {
        ctx.sendToRenderer('browser:event', { id: opts.id, kind: 'loading', loading: true })
      })
      webContents.on('did-stop-loading', () => {
        ctx.sendToRenderer('browser:event', { id: opts.id, kind: 'loading', loading: false })
        sendNavState()
      })
      webContents.on('did-fail-load', (_evt, errorCode, errorDesc, validatedURL) => {
        // Sub-frame failures emit too; only surface main-frame failures.
        if (_evt && (_evt as unknown as { isMainFrame?: boolean }).isMainFrame === false) return
        ctx.sendToRenderer('browser:event', {
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
    }
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
  ipcMain.handle('browser:setGeometry', (_e, id: string, geometry: BrowserGeometry) => {
    const entry = browserViews.get(id)
    const win = ctx.getWin()
    if (!entry || !win || win.isDestroyed()) return
    entry.geometry = geometry
    const { width: contentWidth, height: contentHeight } = win.getContentBounds()
    const newBounds = boundsFromGeometry(geometry, contentWidth, contentHeight)
    entry.lastBounds = newBounds
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
    const win = ctx.getWin()
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

  return { reapplyAllWithGeometry }
}
