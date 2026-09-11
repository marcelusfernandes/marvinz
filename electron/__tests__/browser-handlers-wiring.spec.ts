/**
 * Wiring test for electron/ipc/browser.ts's composition into electron/main.ts
 * (#575).
 *
 * Closes a gap the unit-level ipc-browser-handlers.spec.ts cannot: that file
 * imports browser.ts directly with a fake ctx, so it proves the module's own
 * logic but is blind to whether main.ts actually calls
 * registerBrowserHandlers(ctx) at all, or wires getWin/sendToRenderer to the
 * real BrowserWindow. Confirmed empirically: stubbing out main.ts's
 * registerBrowserHandlers call left the entire repo suite green — the exact
 * false-green class of gap QA rejected in #571 (debounce wrap without an
 * integration test against real wiring). This file is that integration test.
 *
 * Same technique as watcher-snapshot-content-guard.spec.ts (#536) and
 * vault-switch-state-reset.spec.ts (#568): mock 'electron'/'chokidar',
 * side-effect-import electron/main.ts to capture the REAL ipcMain.handle
 * callbacks, and drive them directly. BrowserWindow returns a full stub
 * instance and app.whenReady().then(cb) actually invokes cb, so `win` gets
 * set for real and browser.ts's ctx.getWin()/ctx.sendToRenderer resolve to it.
 */

import { describe, it, expect, vi, type Mock } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing electron/main.ts
// ---------------------------------------------------------------------------

type Listener = (...args: unknown[]) => void

const { winStub, fakeViews, WebContentsViewCtor } = vi.hoisted(() => {
  function makeListenerMap() {
    const map = new Map<string, Listener[]>()
    return {
      record: (event: string, cb: Listener) => {
        const arr = map.get(event) ?? []
        arr.push(cb)
        map.set(event, arr)
      },
      get: (event: string): Listener => {
        const arr = map.get(event)
        if (!arr || arr.length === 0) throw new Error(`no listener registered for ${event}`)
        return arr[0]
      },
    }
  }

  const winListeners = makeListenerMap()
  const webContentsStub = {
    send: vi.fn(),
    openDevTools: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    session: {
      setSpellCheckerEnabled: vi.fn(),
      setSpellCheckerLanguages: vi.fn(),
    },
    on: vi.fn(),
  }
  const winStub = {
    webContents: webContentsStub,
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn((event: string, cb: Listener) => winListeners.record(event, cb)),
    isDestroyed: vi.fn(() => false),
    getContentBounds: vi.fn(() => ({ x: 0, y: 0, width: 1200, height: 900 })),
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
    getWinListener: winListeners.get,
  }

  const fakeViews: Array<ReturnType<typeof makeFakeView>> = []
  function makeFakeView() {
    const listeners = makeListenerMap()
    const webContents = {
      on: vi.fn((event: string, cb: Listener) => listeners.record(event, cb)),
      setWindowOpenHandler: vi.fn(),
      loadURL: vi.fn(async () => {}),
      getURL: vi.fn(() => 'https://example.com/'),
      getTitle: vi.fn(() => 'Example'),
      navigationHistory: {
        canGoBack: vi.fn(() => false),
        canGoForward: vi.fn(() => false),
        goBack: vi.fn(),
        goForward: vi.fn(),
      },
      reload: vi.fn(),
      stop: vi.fn(),
      close: vi.fn(),
    }
    return {
      setBackgroundColor: vi.fn(),
      setBounds: vi.fn(),
      webContents,
      getListener: listeners.get,
    }
  }
  const WebContentsViewCtor = vi.fn(function () {
    const view = makeFakeView()
    fakeViews.push(view)
    return view
  })

  return { winStub, fakeViews, WebContentsViewCtor }
})

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(),
    on: vi.fn(),
    whenReady: vi.fn(() => ({
      then: (cb: () => void) => {
        cb()
        return Promise.resolve()
      },
    })),
  },
  BrowserWindow: vi.fn(function () {
    return winStub
  }),
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  MenuItem: vi.fn(),
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { trashItem: vi.fn(), openExternal: vi.fn(), showItemInFolder: vi.fn() },
  clipboard: {},
  WebContentsView: WebContentsViewCtor,
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

import { ipcMain, shell } from 'electron'
import '../main.js' // side-effect import — registers the real ipcMain.handle callbacks

// ---------------------------------------------------------------------------
// Capture the real handlers registered by electron/main.ts (via
// registerBrowserHandlers) at import time.
// ---------------------------------------------------------------------------

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

function getHandler(channel: string): IpcHandler {
  const calls = vi.mocked(ipcMain.handle).mock.calls
  const found = calls.find(([ch]) => ch === channel)
  if (!found) throw new Error(`ipcMain.handle was never called for channel "${channel}"`)
  return found[1] as IpcHandler
}

const BROWSER_CHANNELS = [
  'browser:create',
  'browser:navigate',
  'browser:back',
  'browser:forward',
  'browser:reload',
  'browser:stop',
  'browser:setBounds',
  'browser:setGeometry',
  'browser:setActive',
  'browser:setAllHidden',
  'browser:close',
] as const

describe('electron/ipc/browser.ts wiring into main.ts (#575)', () => {
  it('registers ipcMain.handle for every browser:* channel', () => {
    // This is exactly the assertion that would have caught the gap #570
    // proved by experiment: stubbing out registerBrowserHandlers() in
    // main.ts left the whole repo suite green. getHandler() throws if a
    // channel was never registered, so a missing/broken register() call
    // fails this test immediately.
    for (const channel of BROWSER_CHANNELS) {
      expect(() => getHandler(channel)).not.toThrow()
    }
  })

  it('browser:create wires the REAL main.ts window and forwards navigation events to it', async () => {
    const create = getHandler('browser:create')

    const result = await create(null, {
      id: 'wiring-tab-1',
      url: 'https://example.com',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    })

    // The view was attached to the actual `win` createWindow() set (not a
    // disconnected/undefined reference) — proves ctx.getWin() in main.ts
    // resolves to the real window.
    const view = fakeViews[fakeViews.length - 1]
    expect(winStub.contentView.addChildView).toHaveBeenCalledWith(view)
    expect(view.webContents.loadURL).toHaveBeenCalledWith('https://example.com')
    expect(result).toEqual({
      url: 'https://example.com/',
      title: 'Example',
      canBack: false,
      canForward: false,
    })

    // Drive the real did-navigate listener browser:create registered, and
    // confirm it reaches the renderer through main.ts's real safeBrowserSend
    // (ctx.sendToRenderer) — i.e. win.webContents.send, not a disconnected stub.
    const didNavigate = view.getListener('did-navigate')
    ;(winStub.webContents.send as Mock).mockClear()
    didNavigate({}, 'https://example.com/next')

    expect(winStub.webContents.send).toHaveBeenCalledWith('browser:event', {
      id: 'wiring-tab-1',
      kind: 'url',
      url: 'https://example.com/next',
    })
  })

  it('browser:create denies popups via the real shell.openExternal', async () => {
    const create = getHandler('browser:create')
    await create(null, {
      id: 'wiring-tab-popup',
      url: 'https://example.com',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    })
    const view = fakeViews[fakeViews.length - 1]

    const setWindowOpenHandlerCall = (view.webContents.setWindowOpenHandler as Mock).mock
      .calls[0][0] as (details: { url: string }) => { action: string }
    const result = setWindowOpenHandlerCall({ url: 'https://popup.example' })

    expect(shell.openExternal).toHaveBeenCalledWith('https://popup.example')
    expect(result).toEqual({ action: 'deny' })
  })

  it('browser:close detaches the view from the real main.ts window', async () => {
    const create = getHandler('browser:create')
    const close = getHandler('browser:close')
    await create(null, {
      id: 'wiring-tab-close',
      url: 'https://example.com',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    })
    const view = fakeViews[fakeViews.length - 1]

    close(null, 'wiring-tab-close')

    expect(winStub.contentView.removeChildView).toHaveBeenCalledWith(view)
  })

  it("createWindow's resize listener recomputes bounds via the real reapplyAllWithGeometry", async () => {
    // Proves the piece unique to this slice's composition: main.ts captures
    // registerBrowserHandlers's returned reapplyAllWithGeometry and wires it
    // to win.on('resize', ...) inside createWindow() — not just that the IPC
    // handlers are registered.
    const create = getHandler('browser:create')
    const setGeometry = getHandler('browser:setGeometry')
    await create(null, {
      id: 'wiring-tab-resize',
      url: 'https://example.com',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    })
    const view = fakeViews[fakeViews.length - 1]
    setGeometry(null, 'wiring-tab-resize', {
      leftInset: 0,
      topInset: 0,
      rightInset: 0,
      bottomInset: 0,
    })
    ;(view.setBounds as Mock).mockClear()
    winStub.getContentBounds.mockReturnValue({ x: 0, y: 0, width: 1500, height: 1000 })

    const resizeListener = winStub.getWinListener('resize')
    resizeListener()

    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1500, height: 1000 })
  })
})
