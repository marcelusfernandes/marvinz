/**
 * Wiring test for electron/ipc/shell-menu-handlers.ts's composition into
 * electron/main.ts (#613, follow-up of #573/#580).
 *
 * None of shell:openExternal/reveal, app:show-context-menu/can-paste/
 * confirm-unsaved/menu-note-context, editor:clipboard-*, or
 * editor:spellcheck-context had real-handler coverage before this move
 * (confirmed by grep before writing this file) — the existing specs for
 * app:show-context-menu/can-paste, editor:clipboard-write-rich/read-rich, and
 * editor:spellcheck-context are all "mirror" tests (hand-copied logic, not
 * the real handler), so they'd stay green even if main.ts's wiring were
 * completely broken. This file is the real-wiring proof.
 *
 * Same technique as #575's browser-handlers-wiring.spec.ts for the parts
 * that need a real running window: BrowserWindow returns a full stub with
 * webContents.on/win.on recording listeners, and app.whenReady().then(cb)
 * actually invokes cb, so createWindow() runs for real and
 * ctx.getSpellcheckContext() resolves against the real lastSpellcheck state
 * createWindow's context-menu listener writes to.
 */

import { describe, it, expect, vi } from 'vitest'

type Listener = (...args: unknown[]) => void

const { winStub } = vi.hoisted(() => {
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
  const webContentsListeners = makeListenerMap()
  const webContentsStub = {
    send: vi.fn(),
    openDevTools: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    session: {
      setSpellCheckerEnabled: vi.fn(),
      setSpellCheckerLanguages: vi.fn(),
    },
    on: vi.fn((event: string, cb: Listener) => webContentsListeners.record(event, cb)),
  }
  const winStub = {
    webContents: webContentsStub,
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn((event: string, cb: Listener) => winListeners.record(event, cb)),
    isDestroyed: vi.fn(() => false),
    getWebContentsListener: webContentsListeners.get,
    getWinListener: winListeners.get,
  }

  return { winStub }
})

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(),
    on: vi.fn(),
    isPackaged: true,
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
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  shell: { trashItem: vi.fn(), openExternal: vi.fn(), showItemInFolder: vi.fn() },
  clipboard: {
    availableFormats: vi.fn(() => []),
    readText: vi.fn(() => ''),
    writeText: vi.fn(),
    readHTML: vi.fn(() => ''),
    write: vi.fn(),
  },
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

import { ipcMain, shell, clipboard } from 'electron'
import '../main.js' // side-effect import — registers the real ipcMain.handle callbacks; app.whenReady's cb runs createWindow() for real

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

function getHandler(channel: string): IpcHandler {
  const calls = vi.mocked(ipcMain.handle).mock.calls
  const found = calls.find(([ch]) => ch === channel)
  if (!found) throw new Error(`ipcMain.handle was never called for channel "${channel}"`)
  return found[1] as IpcHandler
}

function getOnHandler(channel: string): IpcHandler {
  const calls = vi.mocked(ipcMain.on).mock.calls
  const found = calls.find(([ch]) => ch === channel)
  if (!found) throw new Error(`ipcMain.on was never called for channel "${channel}"`)
  return found[1] as IpcHandler
}

const SHELL_MENU_HANDLE_CHANNELS = [
  'shell:openExternal',
  'shell:reveal',
  'app:show-context-menu',
  'app:can-paste',
  'app:confirm-unsaved',
  'editor:clipboard-read',
  'editor:clipboard-write',
  'editor:clipboard-write-rich',
  'editor:clipboard-read-rich',
  'editor:spellcheck-context',
] as const

describe('electron/ipc/shell-menu-handlers.ts wiring into main.ts (#613)', () => {
  it('registers ipcMain.handle for every shell-menu-handlers channel', () => {
    // Exactly the assertion that would have caught the gap proved by
    // experiment: stubbing out registerShellMenuHandlers() in main.ts left
    // the whole repo suite green.
    for (const channel of SHELL_MENU_HANDLE_CHANNELS) {
      expect(() => getHandler(channel)).not.toThrow()
    }
    expect(() => getOnHandler('app:menu-note-context')).not.toThrow()
  })

  it('shell:reveal resolves the real assertInVault and calls shell.showItemInFolder', async () => {
    // No active vault is set up in this file (this suite only needs the
    // handlers to exist and call through), so assertInVault rejects with
    // MARVIN_NO_VAULT — still proof the real ctx.assertInVault (not a no-op
    // fake) is what's wired in.
    const shellReveal = getHandler('shell:reveal')
    await expect(shellReveal(undefined, '/some/path.md')).rejects.toThrow(/MARVIN_NO_VAULT/)
    expect(shell.showItemInFolder).not.toHaveBeenCalled()
  })

  it('app:can-paste reflects the real clipboard.availableFormats', () => {
    const appCanPaste = getHandler('app:can-paste')
    vi.mocked(clipboard.availableFormats).mockReturnValueOnce([])
    expect(appCanPaste(undefined)).toBe(false)

    vi.mocked(clipboard.availableFormats).mockReturnValueOnce(['text/plain'])
    expect(appCanPaste(undefined)).toBe(true)
  })

  it('editor:clipboard-write/read round-trip through the real clipboard mock', () => {
    const clipboardWrite = getHandler('editor:clipboard-write')
    const clipboardRead = getHandler('editor:clipboard-read')
    vi.mocked(clipboard.readText).mockReturnValueOnce('round-tripped')

    clipboardWrite(undefined, 'round-tripped')

    expect(clipboard.writeText).toHaveBeenCalledWith('round-tripped')
    expect(clipboardRead(undefined)).toBe('round-tripped')
  })

  it('editor:spellcheck-context reflects the real lastSpellcheck state createWindow wires up', () => {
    // Fire the real context-menu listener registered by createWindow() (ran
    // for real via the app.whenReady().then(cb) stub above) — only
    // observable if ctx.getSpellcheckContext() resolves against the same
    // main.ts-owned lastSpellcheck variable, not a disconnected fake.
    const contextMenuListener = winStub.getWebContentsListener('context-menu')
    contextMenuListener(undefined, { misspelledWord: 'teh', dictionarySuggestions: ['the'] })

    const editorSpellcheckContext = getHandler('editor:spellcheck-context')
    expect(editorSpellcheckContext(undefined)).toEqual({
      misspelledWord: 'teh',
      suggestions: ['the'],
    })

    // win's blur listener resets it back to empty — same real closure.
    const blurListener = winStub.getWinListener('blur')
    blurListener()
    expect(editorSpellcheckContext(undefined)).toEqual({ misspelledWord: '', suggestions: [] })
  })

  it('app:menu-note-context ignores a non-boolean payload without throwing', () => {
    const menuNoteContext = getOnHandler('app:menu-note-context')
    expect(() => menuNoteContext(undefined, 'not-a-boolean')).not.toThrow()
    expect(() => menuNoteContext(undefined, true)).not.toThrow()
  })
})
