/**
 * Characterization tests for electron/ipc/browser.ts (#575).
 *
 * Zero real-handler coverage existed for any browser:* channel before this
 * move (no integration suite drives them, unlike the file: and pty: channels
 * in #574/#570) — these tests are the sole guard against a future
 * regression, not a secondary net alongside an existing suite.
 *
 * Driven directly against registerBrowserHandlers(ctx) + a mocked
 * WebContentsView/shell, same pattern as ipc-pty-handlers.spec.ts (#570) and
 * ipc-fs-handlers.spec.ts (#574).
 *
 * Two security behaviors are pinned deliberately (per the team lead: #556
 * hardens these later, not this pure-move issue):
 *   - setWindowOpenHandler → always { action: 'deny' } + shell.openExternal
 *   - will-navigate guard → blocks non-http(s)/about protocols
 *
 * Every test uses a fresh tab id (via `uid()`) rather than reusing 'tab-1':
 * browserViews is a module-level map inside browser.ts (like ptyProcesses in
 * pty.ts), so reusing an id across tests would hit the create handler's
 * idempotent-existing-id branch instead of actually creating a fresh view.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { registerBrowserHandlers, type BrowserCtx } from '../ipc/browser.js'
import { ipcMain, shell } from 'electron'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

type Listener = (...args: unknown[]) => void

const { fakeViews, WebContentsViewCtor } = vi.hoisted(() => {
  const fakeViews: Array<ReturnType<typeof makeFakeView>> = []
  function makeFakeView() {
    const listeners = new Map<string, Listener[]>()
    let windowOpenHandler: ((details: { url: string }) => { action: string }) | null = null
    const webContents = {
      on: vi.fn((event: string, cb: Listener) => {
        const arr = listeners.get(event) ?? []
        arr.push(cb)
        listeners.set(event, arr)
      }),
      setWindowOpenHandler: vi.fn((cb: (details: { url: string }) => { action: string }) => {
        windowOpenHandler = cb
      }),
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
      getListener: (event: string): Listener => {
        const arr = listeners.get(event)
        if (!arr || arr.length === 0) throw new Error(`no listener registered for ${event}`)
        return arr[0]
      },
      getWindowOpenHandler: () => windowOpenHandler,
    }
  }
  const WebContentsViewCtor = vi.fn(function () {
    const view = makeFakeView()
    fakeViews.push(view)
    return view
  })
  return { fakeViews, WebContentsViewCtor }
})

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  WebContentsView: WebContentsViewCtor,
  shell: { openExternal: vi.fn() },
}))

let idCounter = 0
function uid(): string {
  idCounter += 1
  return `tab-${idCounter}`
}

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const calls = (ipcMain.handle as Mock).mock.calls
  const call = calls.find((c: unknown[]) => c[0] === channel)
  if (!call) throw new Error(`handler not registered: ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function makeFakeWin() {
  return {
    isDestroyed: vi.fn(() => false),
    getContentBounds: vi.fn(() => ({ x: 0, y: 0, width: 1000, height: 800 })),
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
  }
}

function makeCtx(overrides: Partial<BrowserCtx> = {}): BrowserCtx {
  return {
    getWin: () => win as never,
    sendToRenderer: vi.fn(),
    ...overrides,
  }
}

async function createTab(
  ctx: BrowserCtx,
  id: string,
  bounds = { x: 0, y: 0, width: 800, height: 600 }
): Promise<void> {
  registerBrowserHandlers(ctx)
  await getHandler('browser:create')(null, { id, url: 'https://example.com', bounds })
}

let win: ReturnType<typeof makeFakeWin>

beforeEach(() => {
  fakeViews.length = 0
  WebContentsViewCtor.mockClear()
  ;(ipcMain.handle as Mock).mockClear()
  ;(shell.openExternal as Mock).mockClear()
  win = makeFakeWin()
})

// ---------------------------------------------------------------------------
// browser:create
// ---------------------------------------------------------------------------

describe('browser:create', () => {
  it('creates a new WebContentsView, attaches it, loads the url, and returns state', async () => {
    registerBrowserHandlers(makeCtx())
    const id = uid()

    const result = await getHandler('browser:create')(null, {
      id,
      url: 'https://example.com',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    })

    expect(WebContentsViewCtor).toHaveBeenCalledTimes(1)
    expect(win.contentView.addChildView).toHaveBeenCalledWith(fakeViews[0])
    expect(fakeViews[0].webContents.loadURL).toHaveBeenCalledWith('https://example.com')
    expect(result).toEqual({
      url: 'https://example.com/',
      title: 'Example',
      canBack: false,
      canForward: false,
    })
  })

  it('is idempotent for an existing id — reuses the view instead of recreating', async () => {
    registerBrowserHandlers(makeCtx())
    const id = uid()
    const handler = getHandler('browser:create')
    await handler(null, {
      id,
      url: 'https://example.com',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    })

    await handler(null, {
      id,
      url: 'https://ignored.example',
      bounds: { x: 0, y: 0, width: 900, height: 700 },
    })

    expect(WebContentsViewCtor).toHaveBeenCalledTimes(1)
    expect(fakeViews[0].setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 900, height: 700 })
  })

  it('throws when there is no window available', async () => {
    registerBrowserHandlers(makeCtx({ getWin: () => null }))

    await expect(
      getHandler('browser:create')(null, {
        id: uid(),
        url: 'https://example.com',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      })
    ).rejects.toThrow('No window available')
    expect(WebContentsViewCtor).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Security pins (#556 hardens these later — preserved byte-identical here)
// ---------------------------------------------------------------------------

describe('browser:create — window-open handler', () => {
  it('denies popups and opens the url in the OS browser instead', async () => {
    await createTab(makeCtx(), uid())

    const openHandler = fakeViews[0].getWindowOpenHandler()
    const result = openHandler?.({ url: 'https://popup.example' })

    expect(shell.openExternal).toHaveBeenCalledWith('https://popup.example')
    expect(result).toEqual({ action: 'deny' })
  })
})

describe('browser:create — will-navigate guard', () => {
  it('blocks file:// navigation and allows https://', async () => {
    await createTab(makeCtx(), uid())
    const willNavigate = fakeViews[0].getListener('will-navigate')

    const blockedEvent = { preventDefault: vi.fn() }
    willNavigate(blockedEvent, 'file:///etc/passwd')
    expect(blockedEvent.preventDefault).toHaveBeenCalledTimes(1)

    const allowedEvent = { preventDefault: vi.fn() }
    willNavigate(allowedEvent, 'https://example.com/page')
    expect(allowedEvent.preventDefault).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Event wiring → ctx.sendToRenderer
// ---------------------------------------------------------------------------

describe('browser:create — event wiring', () => {
  it('forwards did-navigate as a url event plus a nav-state event', async () => {
    const ctx = makeCtx()
    const id = uid()
    await createTab(ctx, id)
    const didNavigate = fakeViews[0].getListener('did-navigate')

    didNavigate({}, 'https://example.com/next')

    expect(ctx.sendToRenderer).toHaveBeenCalledWith('browser:event', {
      id,
      kind: 'url',
      url: 'https://example.com/next',
    })
    expect(ctx.sendToRenderer).toHaveBeenCalledWith('browser:event', {
      id,
      kind: 'nav-state',
      canBack: false,
      canForward: false,
    })
  })

  it('forwards main-frame did-fail-load but not sub-frame failures', async () => {
    const ctx = makeCtx()
    const id = uid()
    await createTab(ctx, id)
    const didFailLoad = fakeViews[0].getListener('did-fail-load')
    ;(ctx.sendToRenderer as Mock).mockClear()

    didFailLoad({ isMainFrame: false }, -1, 'boom', 'https://sub.example')
    expect(ctx.sendToRenderer).not.toHaveBeenCalled()

    didFailLoad({ isMainFrame: true }, -2, 'timeout', 'https://main.example')
    expect(ctx.sendToRenderer).toHaveBeenCalledWith('browser:event', {
      id,
      kind: 'load-error',
      url: 'https://main.example',
      message: 'timeout (-2)',
    })
  })
})

// ---------------------------------------------------------------------------
// browser:navigate / back / forward / reload / stop
// ---------------------------------------------------------------------------

describe('navigation handlers', () => {
  it('browser:navigate loads the given url on the existing view', async () => {
    const id = uid()
    await createTab(makeCtx(), id)
    await getHandler('browser:navigate')(null, id, 'https://other.example')
    expect(fakeViews[0].webContents.loadURL).toHaveBeenCalledWith('https://other.example')
  })

  it('browser:back/forward only act when history allows it', async () => {
    const id = uid()
    await createTab(makeCtx(), id)
    fakeViews[0].webContents.navigationHistory.canGoBack.mockReturnValue(true)
    fakeViews[0].webContents.navigationHistory.canGoForward.mockReturnValue(false)

    getHandler('browser:back')(null, id)
    getHandler('browser:forward')(null, id)

    expect(fakeViews[0].webContents.navigationHistory.goBack).toHaveBeenCalledTimes(1)
    expect(fakeViews[0].webContents.navigationHistory.goForward).not.toHaveBeenCalled()
  })

  it('browser:reload/stop forward to the webContents', async () => {
    const id = uid()
    await createTab(makeCtx(), id)
    getHandler('browser:reload')(null, id)
    getHandler('browser:stop')(null, id)
    expect(fakeViews[0].webContents.reload).toHaveBeenCalledTimes(1)
    expect(fakeViews[0].webContents.stop).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Geometry / visibility: setBounds, setGeometry, setActive, setAllHidden
// ---------------------------------------------------------------------------

describe('geometry and visibility handlers', () => {
  it('browser:setBounds applies the given bounds while active', async () => {
    const id = uid()
    await createTab(makeCtx(), id)
    getHandler('browser:setBounds')(null, id, { x: 1, y: 2, width: 300, height: 400 })
    expect(fakeViews[0].setBounds).toHaveBeenLastCalledWith({
      x: 1,
      y: 2,
      width: 300,
      height: 400,
    })
  })

  it('browser:setActive hides inactive tabs and shows the active one', async () => {
    const ctx = makeCtx()
    const id1 = uid()
    const id2 = uid()
    registerBrowserHandlers(ctx)
    await getHandler('browser:create')(null, {
      id: id1,
      url: 'https://example.com',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    })
    await getHandler('browser:create')(null, {
      id: id2,
      url: 'https://example.com',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    })
    getHandler('browser:setActive')(null, id2)

    expect(fakeViews[0].setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 0, height: 0 })
    expect(fakeViews[1].setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    })
  })

  it('browser:setAllHidden hides every tab regardless of active state', async () => {
    const id = uid()
    await createTab(makeCtx(), id)
    getHandler('browser:setAllHidden')(null, true)
    expect(fakeViews[0].setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 0, height: 0 })
    // browsersGloballyHidden is module-level state shared across every test in
    // this file (like browserViews) — reset it so later tests' freshly
    // created tabs default back to visible.
    getHandler('browser:setAllHidden')(null, false)
  })

  it('browser:setGeometry recomputes bounds from window content size', async () => {
    const id = uid()
    await createTab(makeCtx(), id)
    getHandler('browser:setGeometry')(null, id, {
      leftInset: 10,
      topInset: 20,
      rightInset: 5,
      bottomInset: 15,
    })
    expect(fakeViews[0].setBounds).toHaveBeenLastCalledWith({
      x: 10,
      y: 20,
      width: 1000 - 10 - 5,
      height: 800 - 20 - 15,
    })
  })
})

// ---------------------------------------------------------------------------
// browser:close
// ---------------------------------------------------------------------------

describe('browser:close', () => {
  it('detaches the view from the window and closes its webContents', async () => {
    const id = uid()
    await createTab(makeCtx(), id)

    getHandler('browser:close')(null, id)

    expect(win.contentView.removeChildView).toHaveBeenCalledWith(fakeViews[0])
    expect(fakeViews[0].webContents.close).toHaveBeenCalledTimes(1)

    // Untracked after close — later ops on the same id are no-ops, not throws.
    expect(() => getHandler('browser:reload')(null, id)).not.toThrow()
    expect(fakeViews[0].webContents.reload).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// reapplyAllWithGeometry (createWindow's win.on('resize'/'maximize'/...) hook)
// ---------------------------------------------------------------------------

describe('reapplyAllWithGeometry', () => {
  it('recomputes bounds for every tracked view with registered geometry', async () => {
    const ctx = makeCtx()
    const id = uid()
    const { reapplyAllWithGeometry } = registerBrowserHandlers(ctx)
    await getHandler('browser:create')(null, {
      id,
      url: 'https://example.com',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    })
    getHandler('browser:setGeometry')(null, id, {
      leftInset: 0,
      topInset: 0,
      rightInset: 0,
      bottomInset: 0,
    })
    fakeViews[0].setBounds.mockClear()
    win.getContentBounds.mockReturnValue({ x: 0, y: 0, width: 1200, height: 900 })

    reapplyAllWithGeometry()

    expect(fakeViews[0].setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      width: 1200,
      height: 900,
    })
  })

  it('is a no-op when there is no window', () => {
    const { reapplyAllWithGeometry } = registerBrowserHandlers(makeCtx({ getWin: () => null }))
    expect(() => reapplyAllWithGeometry()).not.toThrow()
  })
})
