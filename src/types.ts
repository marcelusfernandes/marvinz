import type { AgentRequest, AgentEvent, ApprovalDecision } from './shared/agent-protocol.js'
import type { MarvinAPI } from '../electron/preload.js'

export type { AgentRequest, AgentEvent, ApprovalDecision }
export type { MarvinAPI }

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

export type SnapshotTrigger =
  | 'file:write'
  | 'watcher'
  | 'restore'
  | 'cascade'
  | 'buffer-save'
  | 'external-rejected'

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

export type SnapshotEnvelope<T> = { ok: true; data: T } | { ok: false; error: string }

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
  themeFlavor?: 'default' | 'pastel'
  /**
   * When true, new agent tabs default to the legacy PTY terminal instead of
   * the native chat panel. Per-tab type is preserved across the toggle.
   */
  terminalModeEnabled?: boolean
  /**
   * When true, the right-side agents pane renders transparently so the macOS
   * window vibrancy shows through. Defaults to opaque.
   */
  agentsPaneTransparent?: boolean
  /**
   * Master switch for editor micro-animations. When false, every editor effect
   * is suppressed regardless of the per-effect toggles. Defaults to on.
   */
  editorEffectsMaster?: boolean
  /**
   * When true, the editor caret glides to its new position instead of jumping.
   * Gated behind editorEffectsMaster. Defaults to on.
   */
  editorEffectCaretSlide?: boolean
  saveMode?: 'auto' | 'manual'
}

export type ImportExternalResult = {
  imported: string[]
  skipped: { source: string; reason: 'not-found' | 'denied' | 'broken-symlink' | 'fs-error' }[]
}

export type ContentHit = {
  path: string
  rel: string
  name: string
  line: number
  lineText: string
  matchRanges: Array<{ start: number; end: number }>
}

export type SearchResult = ContentHit[] | { unavailable: true }

declare global {
  interface Window {
    marvin: MarvinAPI
  }
}
