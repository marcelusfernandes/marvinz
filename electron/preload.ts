import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { SearchResult } from './search-content.js'
import type { ApprovalDecision, AgentRequest, AgentEvent } from '../src/shared/agent-protocol.js'
import type { MoveResult, Settings, SnapshotEnvelope, SnapshotManifest } from '../src/types.js'
import { IPC_CHANNELS } from '../src/shared/ipc-channels.js'

type FileNode = {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

type BrowserEvent =
  | { id: string; kind: 'title'; title: string }
  | { id: string; kind: 'url'; url: string }
  | { id: string; kind: 'loading'; loading: boolean }
  | { id: string; kind: 'nav-state'; canBack: boolean; canForward: boolean }
  | { id: string; kind: 'load-error'; url: string; message: string }

type FileChangeSource = 'agent' | 'external'

type MenuItemSpec =
  | { kind: 'item'; id: string; label: string; accelerator?: string; enabled?: boolean }
  | { kind: 'separator' }

const api = {
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.settings.get) as Promise<Settings>,
    set: (partial: Partial<Settings>) =>
      ipcRenderer.invoke(IPC_CHANNELS.settings.set, partial) as Promise<Settings>,
  },
  vault: {
    pick: () => ipcRenderer.invoke(IPC_CHANNELS.vault.pick) as Promise<string | null>,
    current: () => ipcRenderer.invoke(IPC_CHANNELS.vault.current) as Promise<string | null>,
    tree: (vaultPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.vault.tree, vaultPath) as Promise<FileNode[]>,
    watch: (vaultPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.vault.watch, vaultPath) as Promise<void>,
    onChanged: (cb: () => void) => {
      const listener = () => cb()
      ipcRenderer.on(IPC_CHANNELS.vault.changed, listener)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.vault.changed, listener)
      }
    },
  },
  file: {
    pick: () => ipcRenderer.invoke(IPC_CHANNELS.file.pick) as Promise<string | null>,
    read: (filePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.file.read, filePath) as Promise<string>,
    write: (filePath: string, content: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.file.write, filePath, content) as Promise<void>,
    exportPdf: (filePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.file.exportPdf, filePath) as Promise<void>,
    create: (parentDir: string, name: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.file.create, parentDir, name) as Promise<string>,
    writeBinary: (payload: {
      vaultPath: string
      relPath: string
      base64Bytes: string
      maxBytes?: number
    }) => ipcRenderer.invoke(IPC_CHANNELS.file.writeBinary, payload) as Promise<string>,
    copy: (srcPath: string, destDir: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.file.copy, srcPath, destDir) as Promise<string>,
    moveBatch: (srcs: string[], destDir: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.file.moveBatch, srcs, destDir) as Promise<MoveResult[]>,
    onChanged: (cb: (filePath: string, source: FileChangeSource) => void) => {
      const listener = (_: unknown, filePath: string, source: FileChangeSource) =>
        cb(filePath, source)
      ipcRenderer.on(IPC_CHANNELS.file.changed, listener)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.file.changed, listener)
      }
    },
  },
  office: {
    readDocx: (filePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.office.readDocx, filePath) as Promise<{
        html: string
        messages: unknown[]
      }>,
    writeDocx: (filePath: string, plainText: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.office.writeDocx, filePath, plainText) as Promise<void>,
    readXlsx: (filePath: string, sheetName?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.office.readXlsx, filePath, sheetName) as Promise<{
        rows: string[][]
        sheetNames: string[]
      }>,
    writeXlsx: (filePath: string, rows: string[][], sheetName: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.office.writeXlsx, filePath, rows, sheetName) as Promise<void>,
  },
  folder: {
    create: (parentDir: string, name: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.folder.create, parentDir, name) as Promise<string>,
  },
  path: {
    rename: (oldPath: string, newPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.path.rename, oldPath, newPath) as Promise<string>,
    trash: (target: string) => ipcRenderer.invoke(IPC_CHANNELS.path.trash, target) as Promise<void>,
  },
  claude: {
    detect: () => ipcRenderer.invoke(IPC_CHANNELS.claude.detect) as Promise<string | null>,
  },
  agent: {
    detect: (name: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.agent.detect, name) as Promise<string | null>,
    request: (req: AgentRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.agent.request, req) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
    approve: (sessionId: string, toolUseId: string, decision: ApprovalDecision) =>
      ipcRenderer.invoke(IPC_CHANNELS.agent.request, {
        type: 'approval',
        sessionId,
        toolUseId,
        decision,
      } as AgentRequest) as Promise<{ ok: true } | { ok: false; error: string }>,
    onEvent: (sessionId: string, cb: (event: AgentEvent) => void) => {
      const channel = IPC_CHANNELS.agent.event(sessionId)
      const listener = (_: unknown, event: AgentEvent) => cb(event)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    },
  },
  browser: {
    create: (opts: {
      id: string
      url: string
      bounds: { x: number; y: number; width: number; height: number }
    }) =>
      ipcRenderer.invoke(IPC_CHANNELS.browser.create, opts) as Promise<{
        url: string
        title: string
        canBack: boolean
        canForward: boolean
      }>,
    navigate: (id: string, url: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.browser.navigate, id, url) as Promise<void>,
    back: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.browser.back, id) as Promise<void>,
    forward: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.browser.forward, id) as Promise<void>,
    reload: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.browser.reload, id) as Promise<void>,
    stop: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.browser.stop, id) as Promise<void>,
    setBounds: (id: string, bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke(IPC_CHANNELS.browser.setBounds, id, bounds) as Promise<void>,
    setGeometry: (
      id: string,
      geometry: { leftInset: number; topInset: number; rightInset: number; bottomInset: number }
    ) => ipcRenderer.invoke(IPC_CHANNELS.browser.setGeometry, id, geometry) as Promise<void>,
    setActive: (id: string | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.browser.setActive, id) as Promise<void>,
    setAllHidden: (hidden: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.browser.setAllHidden, hidden) as Promise<void>,
    close: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.browser.close, id) as Promise<void>,
    onEvent: (cb: (event: BrowserEvent) => void) => {
      const listener = (_: unknown, event: BrowserEvent) => cb(event)
      ipcRenderer.on(IPC_CHANNELS.browser.event, listener)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.browser.event, listener)
      }
    },
  },
  shell: {
    openExternal: (url: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.shell.openExternal, url) as Promise<void>,
    reveal: (target: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.shell.reveal, target) as Promise<void>,
  },
  editor: {
    readClipboard: () => ipcRenderer.invoke(IPC_CHANNELS.editor.clipboardRead) as Promise<string>,
    writeClipboard: (text: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.editor.clipboardWrite, text) as Promise<void>,
    writeClipboardRich: (payload: { html: string; text: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.editor.clipboardWriteRich, payload) as Promise<void>,
    readClipboardRich: () =>
      ipcRenderer.invoke(IPC_CHANNELS.editor.clipboardReadRich) as Promise<{
        html: string
        text: string
      }>,
    getSpellcheckContext: () =>
      ipcRenderer.invoke(IPC_CHANNELS.editor.spellcheckContext) as Promise<{
        misspelledWord: string
        suggestions: string[]
      }>,
  },
  app: {
    showContextMenu: (items: MenuItemSpec[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.app.showContextMenu, items) as Promise<string | null>,
    canPaste: () => ipcRenderer.invoke(IPC_CHANNELS.app.canPaste) as Promise<boolean>,
    confirmUnsavedChanges: (fileName: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.app.confirmUnsavedChanges, fileName) as Promise<
        'save' | 'discard' | 'cancel'
      >,
    onMenuAction: (cb: (action: string) => void) => {
      const h = (_e: unknown, a: string) => cb(a)
      ipcRenderer.on(IPC_CHANNELS.app.menuAction, h)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.app.menuAction, h)
      }
    },
    setMenuNoteContext: (hasNoteTab: boolean) =>
      ipcRenderer.send(IPC_CHANNELS.app.menuNoteContext, hasNoteTab),
  },
  fs: {
    importExternal: (sources: string[], destDir: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.fs.importExternal, sources, destDir) as Promise<{
        imported: string[]
        skipped: {
          source: string
          reason: 'not-found' | 'denied' | 'broken-symlink' | 'fs-error'
        }[]
      }>,
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },
  snapshot: {
    listTurns: () =>
      ipcRenderer.invoke(IPC_CHANNELS.snapshot.listTurns) as Promise<
        SnapshotEnvelope<SnapshotManifest[]>
      >,
    listForFile: (relPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.snapshot.listForFile, relPath) as Promise<
        SnapshotEnvelope<SnapshotManifest[]>
      >,
    read: (turnId: string, relPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.snapshot.read, turnId, relPath) as Promise<
        SnapshotEnvelope<string>
      >,
    restore: (turnId: string, relPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.snapshot.restore, turnId, relPath) as Promise<
        SnapshotEnvelope<{ preTurnId: string }>
      >,
    saveBuffer: (relPath: string, content: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.snapshot.saveBuffer, relPath, content) as Promise<
        SnapshotEnvelope<{ turnId: string; saved: boolean }>
      >,
    saveExternalChange: (relPath: string, content: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.snapshot.saveExternalChange, relPath, content) as Promise<
        SnapshotEnvelope<{ turnId: string; saved: boolean }>
      >,
    capture: (paths: string[], trigger: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.snapshot.capture, { paths, trigger }) as Promise<
        SnapshotEnvelope<{ snapshotId: string }>
      >,
    restoreOne: (snapshotId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.snapshot.restoreOne, { snapshotId }) as Promise<
        SnapshotEnvelope<Record<string, never>>
      >,
    onTurnCompleted: (
      cb: (event: { turnId: string; timestamp: number; files: string[] }) => void
    ) => {
      const listener = (
        _: unknown,
        event: { turnId: string; timestamp: number; files: string[] }
      ) => cb(event)
      ipcRenderer.on(IPC_CHANNELS.snapshot.turnCompleted, listener)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.snapshot.turnCompleted, listener)
      }
    },
  },
  search: {
    content: (query: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.search.content, query) as Promise<SearchResult>,
  },
  pty: {
    spawn: (opts: {
      id: string
      shell: string
      cwd: string
      cols: number
      rows: number
      args?: string[]
    }) => ipcRenderer.invoke(IPC_CHANNELS.pty.spawn, opts) as Promise<{ pid: number }>,
    write: (id: string, data: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.pty.write, id, data) as Promise<void>,
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.pty.resize, id, cols, rows) as Promise<void>,
    kill: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.pty.kill, id) as Promise<void>,
    onData: (id: string, cb: (data: string) => void) => {
      const channel = IPC_CHANNELS.pty.data(id)
      const listener = (_: unknown, data: string) => cb(data)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    },
    onExit: (id: string, cb: (code: number) => void) => {
      const channel = IPC_CHANNELS.pty.exit(id)
      const listener = (_: unknown, code: number) => cb(code)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    },
  },
}

contextBridge.exposeInMainWorld('marvin', api)

export type MarvinAPI = typeof api
