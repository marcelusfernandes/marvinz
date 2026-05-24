import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { SearchResult } from './search-content.js'
import type {
  ApprovalDecision,
  AgentRequest,
  AgentEvent,
} from '../src/shared/agent-protocol.js'

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

type Settings = {
  vaultPath?: string
  iconTheme?: 'codicon' | 'material'
  colorTheme?: 'light' | 'dark' | 'system'
  visualStyle?: 'modern' | 'legacy'
  terminalModeEnabled?: boolean
}

const api = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get') as Promise<Settings>,
    set: (partial: Partial<Settings>) =>
      ipcRenderer.invoke('settings:set', partial) as Promise<Settings>,
  },
  vault: {
    pick: () => ipcRenderer.invoke('vault:pick') as Promise<string | null>,
    current: () => ipcRenderer.invoke('vault:current') as Promise<string | null>,
    tree: (vaultPath: string) =>
      ipcRenderer.invoke('vault:tree', vaultPath) as Promise<FileNode[]>,
    watch: (vaultPath: string) => ipcRenderer.invoke('vault:watch', vaultPath),
    onChanged: (cb: () => void) => {
      const listener = () => cb()
      ipcRenderer.on('vault:changed', listener)
      return () => ipcRenderer.removeListener('vault:changed', listener)
    },
  },
  file: {
    read: (filePath: string) => ipcRenderer.invoke('file:read', filePath) as Promise<string>,
    write: (filePath: string, content: string) =>
      ipcRenderer.invoke('file:write', filePath, content) as Promise<void>,
    exportPdf: (filePath: string) =>
      ipcRenderer.invoke('file:exportPdf', filePath) as Promise<void>,
    create: (parentDir: string, name: string) =>
      ipcRenderer.invoke('file:create', parentDir, name) as Promise<string>,
    onChanged: (cb: (filePath: string, source: FileChangeSource) => void) => {
      const listener = (_: unknown, filePath: string, source: FileChangeSource) => cb(filePath, source)
      ipcRenderer.on('file:changed', listener)
      return () => ipcRenderer.removeListener('file:changed', listener)
    },
  },
  folder: {
    create: (parentDir: string, name: string) =>
      ipcRenderer.invoke('folder:create', parentDir, name) as Promise<string>,
  },
  path: {
    rename: (oldPath: string, newPath: string) =>
      ipcRenderer.invoke('path:rename', oldPath, newPath) as Promise<string>,
    trash: (target: string) => ipcRenderer.invoke('path:trash', target) as Promise<void>,
  },
  claude: {
    detect: () => ipcRenderer.invoke('claude:detect') as Promise<string | null>,
  },
  agent: {
    detect: (name: string) => ipcRenderer.invoke('agent:detect', name) as Promise<string | null>,
    request: (req: AgentRequest) =>
      ipcRenderer.invoke('agent:request', req) as Promise<{ ok: true } | { ok: false; error: string }>,
    approve: (sessionId: string, toolUseId: string, decision: ApprovalDecision) =>
      ipcRenderer.invoke('agent:request', {
        type: 'approval',
        sessionId,
        toolUseId,
        decision,
      } as AgentRequest) as Promise<{ ok: true } | { ok: false; error: string }>,
    onEvent: (sessionId: string, cb: (event: AgentEvent) => void) => {
      const channel = `agent:event:${sessionId}`
      const listener = (_: unknown, event: AgentEvent) => cb(event)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
  },
  browser: {
    create: (opts: {
      id: string
      url: string
      bounds: { x: number; y: number; width: number; height: number }
    }) =>
      ipcRenderer.invoke('browser:create', opts) as Promise<{
        url: string
        title: string
        canBack: boolean
        canForward: boolean
      }>,
    navigate: (id: string, url: string) =>
      ipcRenderer.invoke('browser:navigate', id, url) as Promise<void>,
    back: (id: string) => ipcRenderer.invoke('browser:back', id) as Promise<void>,
    forward: (id: string) => ipcRenderer.invoke('browser:forward', id) as Promise<void>,
    reload: (id: string) => ipcRenderer.invoke('browser:reload', id) as Promise<void>,
    stop: (id: string) => ipcRenderer.invoke('browser:stop', id) as Promise<void>,
    setBounds: (id: string, bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke('browser:setBounds', id, bounds) as Promise<void>,
    setGeometry: (
      id: string,
      geometry: { leftInset: number; topInset: number; rightInset: number; bottomInset: number },
    ) => ipcRenderer.invoke('browser:setGeometry', id, geometry) as Promise<void>,
    setActive: (id: string | null) =>
      ipcRenderer.invoke('browser:setActive', id) as Promise<void>,
    setAllHidden: (hidden: boolean) =>
      ipcRenderer.invoke('browser:setAllHidden', hidden) as Promise<void>,
    close: (id: string) => ipcRenderer.invoke('browser:close', id) as Promise<void>,
    onEvent: (cb: (event: BrowserEvent) => void) => {
      const listener = (_: unknown, event: BrowserEvent) => cb(event)
      ipcRenderer.on('browser:event', listener)
      return () => ipcRenderer.removeListener('browser:event', listener)
    },
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url) as Promise<void>,
    reveal: (target: string) => ipcRenderer.invoke('shell:reveal', target) as Promise<void>,
  },
  editor: {
    readClipboard: () => ipcRenderer.invoke('editor:clipboard-read') as Promise<string>,
    writeClipboard: (text: string) =>
      ipcRenderer.invoke('editor:clipboard-write', text) as Promise<void>,
  },
  app: {
    showContextMenu: (items: MenuItemSpec[]) =>
      ipcRenderer.invoke('app:show-context-menu', items) as Promise<string | null>,
    canPaste: () => ipcRenderer.invoke('app:can-paste') as Promise<boolean>,
  },
  fs: {
    importExternal: (sources: string[], destDir: string) =>
      ipcRenderer.invoke('fs:importExternal', sources, destDir) as Promise<{
        imported: string[]
        skipped: { source: string; reason: 'not-found' | 'denied' | 'fs-error' }[]
      }>,
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },
  snapshot: {
    listTurns: () => ipcRenderer.invoke('snapshot:listTurns'),
    listForFile: (relPath: string) => ipcRenderer.invoke('snapshot:listForFile', relPath),
    read: (turnId: string, relPath: string) =>
      ipcRenderer.invoke('snapshot:read', turnId, relPath),
    restore: (turnId: string, relPath: string) =>
      ipcRenderer.invoke('snapshot:restore', turnId, relPath),
    saveBuffer: (relPath: string, content: string) =>
      ipcRenderer.invoke('snapshot:saveBuffer', relPath, content),
    saveExternalChange: (relPath: string, content: string) =>
      ipcRenderer.invoke('snapshot:saveExternalChange', relPath, content),
    onTurnCompleted: (cb: (event: { turnId: string; timestamp: number; files: string[] }) => void) => {
      const listener = (_: unknown, event: { turnId: string; timestamp: number; files: string[] }) => cb(event)
      ipcRenderer.on('snapshot:turn-completed', listener)
      return () => ipcRenderer.removeListener('snapshot:turn-completed', listener)
    },
  },
  search: {
    content: (query: string) =>
      ipcRenderer.invoke('search:content', query) as Promise<SearchResult>,
  },
  pty: {
    spawn: (opts: {
      id: string
      shell: string
      cwd: string
      cols: number
      rows: number
      args?: string[]
    }) => ipcRenderer.invoke('pty:spawn', opts) as Promise<{ pid: number }>,
    write: (id: string, data: string) => ipcRenderer.invoke('pty:write', id, data),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke('pty:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.invoke('pty:kill', id),
    onData: (id: string, cb: (data: string) => void) => {
      const channel = `pty:data:${id}`
      const listener = (_: unknown, data: string) => cb(data)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    onExit: (id: string, cb: (code: number) => void) => {
      const channel = `pty:exit:${id}`
      const listener = (_: unknown, code: number) => cb(code)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
  },
}

contextBridge.exposeInMainWorld('marvin', api)

export type MarvinAPI = typeof api
