export type FileNode = {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

export type ObscloneAPI = {
  settings: {
    get: () => Promise<{ vaultPath?: string }>
  }
  vault: {
    pick: () => Promise<string | null>
    tree: (vaultPath: string) => Promise<FileNode[]>
    watch: (vaultPath: string) => Promise<void>
    onChanged: (cb: () => void) => () => void
  }
  file: {
    read: (filePath: string) => Promise<string>
    write: (filePath: string, content: string) => Promise<void>
    create: (parentDir: string, name: string) => Promise<string>
    onChanged: (cb: (filePath: string) => void) => () => void
  }
  folder: {
    create: (parentDir: string, name: string) => Promise<string>
  }
  path: {
    rename: (oldPath: string, newPath: string) => Promise<string>
    trash: (target: string) => Promise<void>
  }
  claude: {
    detect: () => Promise<string | null>
  }
  shell: {
    openExternal: (url: string) => Promise<void>
    reveal: (target: string) => Promise<void>
  }
  pty: {
    spawn: (opts: {
      id: string
      shell: string
      cwd: string
      cols: number
      rows: number
      args?: string[]
    }) => Promise<{ pid: number }>
    write: (id: string, data: string) => Promise<void>
    resize: (id: string, cols: number, rows: number) => Promise<void>
    kill: (id: string) => Promise<void>
    onData: (id: string, cb: (data: string) => void) => () => void
    onExit: (id: string, cb: (code: number) => void) => () => void
  }
}

declare global {
  interface Window {
    obsclone: ObscloneAPI
  }
}
