import type {
  AgentRequest,
  AgentEvent,
  ApprovalDecision,
} from './shared/agent-protocol.js'

export type { AgentRequest, AgentEvent, ApprovalDecision }

export type FileNode = {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

// Geometry descriptor for an embedded WebContentsView: the placeholder's
// distance (in DIPs) from each window content edge. Lets main recompute bounds
// synchronously during an OS window resize instead of round-tripping to the
// renderer per frame (issue #259).
export type BrowserViewInsets = {
  leftInset: number
  topInset: number
  rightInset: number
  bottomInset: number
}

export type BrowserEvent =
  | { id: string; kind: 'title'; title: string }
  | { id: string; kind: 'url'; url: string }
  | { id: string; kind: 'loading'; loading: boolean }
  | { id: string; kind: 'nav-state'; canBack: boolean; canForward: boolean }
  | { id: string; kind: 'load-error'; url: string; message: string }

export type FileChangeSource = 'agent' | 'external'

export type MoveResult = { src: string; dest: string; ok: boolean; error?: string }

export type SnapshotTrigger = 'file:write' | 'watcher' | 'restore' | 'cascade' | 'buffer-save' | 'external-rejected'

export type SnapshotStatus = 'active' | 'completed'

export type SnapshotManifestEntry = {
  relPath: string
  sizeBefore: number
  hashBefore: string
}

export type SnapshotManifest = {
  turnId: string
  files: SnapshotManifestEntry[]
  createdAt: string
  timestamp: number
  trigger: SnapshotTrigger
  status: SnapshotStatus
  agentId?: string
}

export type SnapshotEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

// Emitted on 'snapshot:turn-completed' IPC push event
export type SnapshotTurnCompletedEvent = {
  turnId: string
  timestamp: number
  files: string[]
}

export type MenuItemSpec =
  | { kind: 'item'; id: string; label: string; accelerator?: string; enabled?: boolean }
  | { kind: 'separator' }

export type Settings = {
  vaultPath?: string
  iconTheme?: 'codicon' | 'material'
  colorTheme?: 'light' | 'dark' | 'system'
  visualStyle?: 'modern' | 'legacy'
  /**
   * When true, new agent tabs default to the legacy PTY terminal instead of
   * the native chat panel. Per-tab type is preserved across the toggle.
   */
  terminalModeEnabled?: boolean
  saveMode?: 'auto' | 'manual'
}

export type MarvinAPI = {
  settings: {
    get: () => Promise<Settings>
    set: (partial: Partial<Settings>) => Promise<Settings>
  }
  vault: {
    pick: () => Promise<string | null>
    current: () => Promise<string | null>
    tree: (vaultPath: string) => Promise<FileNode[]>
    watch: (vaultPath: string) => Promise<void>
    onChanged: (cb: () => void) => () => void
  }
  file: {
    pick: () => Promise<string | null>
    read: (filePath: string) => Promise<string>
    write: (filePath: string, content: string) => Promise<void>
    exportPdf: (filePath: string) => Promise<void>
    create: (parentDir: string, name: string) => Promise<string>
    writeBinary: (payload: { vaultPath: string; relPath: string; base64Bytes: string; maxBytes?: number }) => Promise<string>
    copy: (srcPath: string, destDir: string) => Promise<string>
    moveBatch: (srcs: string[], destDir: string) => Promise<MoveResult[]>
    onChanged: (cb: (filePath: string, source: FileChangeSource) => void) => () => void
  }
  office: {
    readDocx: (filePath: string) => Promise<{ html: string; messages: unknown[] }>
    writeDocx: (filePath: string, plainText: string) => Promise<void>
    readXlsx: (filePath: string, sheetName?: string) => Promise<{ rows: string[][]; sheetNames: string[] }>
    writeXlsx: (filePath: string, rows: string[][], sheetName: string) => Promise<void>
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
  agent: {
    detect: (name: string) => Promise<string | null>
    request: (req: AgentRequest) => Promise<{ ok: true } | { ok: false; error: string }>
    approve: (sessionId: string, toolUseId: string, decision: ApprovalDecision) => Promise<{ ok: true } | { ok: false; error: string }>
    onEvent: (sessionId: string, cb: (event: AgentEvent) => void) => () => void
  }
  browser: {
    create: (opts: {
      id: string
      url: string
      bounds: { x: number; y: number; width: number; height: number }
    }) => Promise<{ url: string; title: string; canBack: boolean; canForward: boolean }>
    navigate: (id: string, url: string) => Promise<void>
    back: (id: string) => Promise<void>
    forward: (id: string) => Promise<void>
    reload: (id: string) => Promise<void>
    stop: (id: string) => Promise<void>
    setBounds: (id: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<void>
    setGeometry: (id: string, insets: BrowserViewInsets) => Promise<void>
    setActive: (id: string | null) => Promise<void>
    setAllHidden: (hidden: boolean) => Promise<void>
    close: (id: string) => Promise<void>
    onEvent: (cb: (event: BrowserEvent) => void) => () => void
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
  snapshot: {
    listTurns: () => Promise<SnapshotEnvelope<SnapshotManifest[]>>
    listForFile: (relPath: string) => Promise<SnapshotEnvelope<SnapshotManifest[]>>
    read: (turnId: string, relPath: string) => Promise<SnapshotEnvelope<string>>
    restore: (turnId: string, relPath: string) => Promise<SnapshotEnvelope<{ preTurnId: string }>>
    saveBuffer: (relPath: string, content: string) => Promise<SnapshotEnvelope<{ turnId: string; saved: boolean }>>
    saveExternalChange: (relPath: string, content: string) => Promise<SnapshotEnvelope<{ turnId: string; saved: boolean }>>
    onTurnCompleted: (cb: (event: SnapshotTurnCompletedEvent) => void) => () => void
  }
  editor: {
    readClipboard: () => Promise<string>
    writeClipboard: (text: string) => Promise<void>
    writeClipboardRich: (payload: { html: string; text: string }) => Promise<void>
    readClipboardRich: () => Promise<{ html: string; text: string }>
    getSpellcheckContext: () => Promise<{ misspelledWord: string; suggestions: string[] }>
  }
  app: {
    showContextMenu: (items: MenuItemSpec[]) => Promise<string | null>
    canPaste: () => Promise<boolean>
  }
  fs: {
    importExternal: (sources: string[], destDir: string) => Promise<ImportExternalResult>
    getPathForFile: (file: File) => string
  }
  search: {
    content: (query: string) => Promise<SearchResult>
  }
}

export type ImportExternalResult = {
  imported: string[]
  skipped: { source: string; reason: 'not-found' | 'denied' | 'fs-error' }[]
}

export type ContentHit = {
  path: string
  rel: string
  name: string
  line: number
  lineText: string
  matchRanges: Array<{ start: number; end: number }>
}

export type SearchResult =
  | ContentHit[]
  | { unavailable: true }

declare global {
  interface Window {
    marvin: MarvinAPI
  }
}
