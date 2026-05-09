import { contextBridge, ipcRenderer } from 'electron'

type FileNode = {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

const api = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get') as Promise<{ vaultPath?: string }>,
  },
  vault: {
    pick: () => ipcRenderer.invoke('vault:pick') as Promise<string | null>,
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
    create: (parentDir: string, name: string) =>
      ipcRenderer.invoke('file:create', parentDir, name) as Promise<string>,
    onChanged: (cb: (filePath: string) => void) => {
      const listener = (_: unknown, filePath: string) => cb(filePath)
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
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url) as Promise<void>,
    reveal: (target: string) => ipcRenderer.invoke('shell:reveal', target) as Promise<void>,
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

contextBridge.exposeInMainWorld('obsclone', api)

export type ObscloneAPI = typeof api
