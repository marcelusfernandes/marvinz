import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileChangeSource, FileNode } from './types'
import { FileTree } from './components/FileTree'
import { Editor } from './components/Editor'
import { AgentsPane } from './components/AgentsPane'
import type { AgentDef } from './components/AgentTerminal'
import { BrowserPane } from './components/BrowserPane'
import { Splitter } from './components/Splitter'
import { ImageViewer } from './components/ImageViewer'
import { InputDialog } from './components/InputDialog'
import { ContextMenu, type MenuItem } from './components/ContextMenu'
import { FileTreeToolbar } from './components/FileTreeToolbar'
import { Icon } from './components/Icon'
import { TabBar } from './components/TabBar'
import { CommandPalette } from './components/CommandPalette'
import { SettingsModal } from './components/SettingsModal'
import { seedFromMain } from './lib/settingsStore'
import { useColorTheme } from './lib/colorTheme'
import { useVisualStyle } from './lib/visualStyle'
import { SnapshotPanel } from './components/SnapshotPanel'
import { SnapshotToast } from './components/SnapshotToast'
import { ExternalChangeBanner } from './components/ExternalChangeBanner'
import type { PaletteItem } from './lib/paletteRanker'
import type { LayoutMode } from './components/LayoutToggle'
import './App.css'

const LAYOUT_STORAGE_KEY = 'marvin:layoutMode'
const SIDEBAR_WIDTH_KEY = 'marvin:sidebarWidth'
const AGENTS_WIDTH_KEY = 'marvin:agentsWidth'

const DEFAULT_SIDEBAR_WIDTH = 240
const DEFAULT_AGENTS_WIDTH = 588
const MIN_SIDEBAR = 160
const MAX_SIDEBAR = 480
const MIN_AGENTS = 320
const MAX_AGENTS = 900
const MIN_EDITOR = 360 // never let the editor track shrink past this

function readStoredLayout(): LayoutMode {
  try {
    const v = window.localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (v === 'claude-center' || v === 'editor-center') return v
  } catch {
    // ignore
  }
  return 'editor-center'
}

function readStoredWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const n = Number(raw)
    if (!Number.isFinite(n)) return fallback
    return Math.max(min, Math.min(max, Math.round(n)))
  } catch {
    return fallback
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

type PendingExternalChange = {
  diskContent: string
  diskChangedAt: number
  source: FileChangeSource
}

type NoteTab = {
  type: 'note'
  id: string
  path: string
  content: string
  version: number
  back: string[]
  forward: string[]
  pendingExternalChange?: PendingExternalChange
}

type BrowserTabState = {
  type: 'browser'
  id: string
  url: string
  /** What's typed in the URL bar (may differ from `url` while editing). */
  draftUrl: string
  title: string
  canBack: boolean
  canForward: boolean
  loading: boolean
  /** True after the WebContentsView is created in the main process. */
  ready: boolean
}

type ImageTab = {
  type: 'image'
  id: string
  path: string
}

type Tab = NoteTab | BrowserTabState | ImageTab

const isNoteTab = (t: Tab): t is NoteTab => t.type === 'note'
const isBrowserTab = (t: Tab): t is BrowserTabState => t.type === 'browser'
const isImageTab = (t: Tab): t is ImageTab => t.type === 'image'

type Dialog =
  | { kind: 'newNote'; parentDir: string }
  | { kind: 'newFolder'; parentDir: string }
  | { kind: 'rename'; target: string; isDir: boolean }
  | null

type ContextState = {
  x: number
  y: number
  items: MenuItem[]
} | null

let tabCounter = 0
const newTabId = () => `tab-${++tabCounter}`

function isMarkdownPath(p: string): boolean {
  return /\.(md|markdown)$/i.test(p)
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'])
function isImagePath(p: string): boolean {
  const ext = p.toLowerCase().split('.').pop() ?? ''
  return IMAGE_EXTS.has(ext)
}

function isPdfPath(p: string): boolean {
  return /\.pdf$/i.test(p)
}

function isHtmlPath(p: string): boolean {
  return /\.html?$/i.test(p)
}

/** Build a marvin:// URL for a vault-local absolute path. The
 * `localhost` host is a placeholder so the standard URL parser doesn't
 * eat the first path segment as the hostname. */
function marvinFileUrl(absPath: string): string {
  const encoded = absPath.split('/').map(encodeURIComponent).join('/')
  return `marvin://localhost${encoded}`
}

function basenameOf(p: string): string {
  return p.split('/').pop() ?? p
}

function isBinaryReadError(err: unknown): boolean {
  return err instanceof Error && /MARVIN_BINARY/.test(err.message)
}

function isDirectoryReadError(err: unknown): boolean {
  return err instanceof Error && /MARVIN_IS_DIRECTORY/.test(err.message)
}

function isTooLargeReadError(err: unknown): boolean {
  return err instanceof Error && /MARVIN_TOO_LARGE/.test(err.message)
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return 'about:blank'
  // Already absolute (http, https, about, file, mailto, etc.)
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed
  // Heuristic: looks like a hostname (contains a dot, no spaces) → assume https
  if (/^[^\s]+\.[^\s]+$/.test(trimmed)) return `https://${trimmed}`
  // Otherwise treat as a search query against the default engine.
  const q = encodeURIComponent(trimmed)
  return `https://www.google.com/search?q=${q}`
}

function collectDirPaths(nodes: FileNode[]): string[] {
  const out: string[] = []
  const walk = (n: FileNode) => {
    if (!n.isDir) return
    out.push(n.path)
    n.children?.forEach(walk)
  }
  nodes.forEach(walk)
  return out
}

function flattenTree(nodes: FileNode[], vaultPath: string): PaletteItem[] {
  const out: PaletteItem[] = []
  const walk = (n: FileNode) => {
    if (n.isDir) {
      n.children?.forEach(walk)
      return
    }
    const rel = n.path.startsWith(vaultPath + '/')
      ? n.path.slice(vaultPath.length + 1)
      : n.path
    out.push({
      path: n.path,
      rel,
      name: n.name,
      isMarkdown: isMarkdownPath(n.name),
    })
  }
  nodes.forEach(walk)
  return out
}

function dirOf(p: string): string {
  const idx = p.lastIndexOf('/')
  return idx >= 0 ? p.slice(0, idx) : p
}

function humanizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const enoent = raw.match(/ENOENT[^']*'([^']+)'/)
  if (enoent) {
    const base = enoent[1].split('/').pop() ?? enoent[1]
    return `File not found: ${base}`
  }
  const eexist = raw.match(/EEXIST[^']*'([^']+)'/)
  if (eexist) {
    const base = eexist[1].split('/').pop() ?? eexist[1]
    return `Already exists: ${base}`
  }
  if (/MARVIN_BINARY/.test(raw)) return 'Binary file — opened externally instead.'
  if (/MARVIN_IS_DIRECTORY/.test(raw)) return 'This is a folder, not a file.'
  if (/MARVIN_OUTSIDE_VAULT/.test(raw)) return 'File is no longer in the active vault. Refreshing tree…'
  const tooLarge = raw.match(/MARVIN_TOO_LARGE: (\d+)/)
  if (tooLarge) {
    const mb = (Number(tooLarge[1]) / (1024 * 1024)).toFixed(1)
    return `File too large to open inline (${mb} MB).`
  }
  // Strip the IPC noise prefix
  return raw.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, '')
}

export default function App() {
  useColorTheme()
  useVisualStyle()
  const [vaultPath, setVaultPath] = useState<string | null>(null)
  const [tree, setTree] = useState<FileNode[]>([])
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [agents, setAgents] = useState<AgentDef[]>([])
  const [bootstrapped, setBootstrapped] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [ctx, setCtx] = useState<ContextState>(null)
  const [error, setError] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [openPaths, setOpenPaths] = useState<Set<string>>(() => new Set())
  const [snapshotPanel, setSnapshotPanel] = useState<
    | {
        filePath: string
        relPath: string
        currentContent: string
        initialTurnId?: string
      }
    | null
  >(null)
  const [turnToast, setTurnToast] = useState<{ turnId: string; files: string[] } | null>(null)
  const [externalToast, setExternalToast] = useState<{
    filePath: string
    source: FileChangeSource
  } | null>(null)
  const [layoutMode, setLayoutModeState] = useState<LayoutMode>(() => readStoredLayout())
  const [urlBarFocusTick, setUrlBarFocusTick] = useState(0)
  const [newAgentTabTick, setNewAgentTabTick] = useState(0)
  const [sidebarWidth, setSidebarWidthState] = useState<number>(() =>
    readStoredWidth(SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR, MAX_SIDEBAR),
  )
  const [agentsWidth, setAgentsWidthState] = useState<number>(() =>
    readStoredWidth(AGENTS_WIDTH_KEY, DEFAULT_AGENTS_WIDTH, MIN_AGENTS, MAX_AGENTS),
  )

  const persistWidth = useCallback((key: string, value: number) => {
    try {
      window.localStorage.setItem(key, String(value))
    } catch {
      // ignore
    }
  }, [])

  const handleSidebarDelta = useCallback(
    (dx: number) => {
      // Clamp using the current viewport so the editor track never collapses.
      const maxBySpace = window.innerWidth - MIN_EDITOR - agentsWidth - 10
      const max = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, maxBySpace))
      setSidebarWidthState((w) => {
        const next = clamp(w + dx, MIN_SIDEBAR, max)
        persistWidth(SIDEBAR_WIDTH_KEY, next)
        return next
      })
    },
    [agentsWidth, persistWidth],
  )

  const handleAgentsDelta = useCallback(
    (dx: number) => {
      // In editor-center the agents pane sits on the right of the editor,
      // so dragging the splitter right grows the editor and shrinks agents.
      // In claude-center the agents pane is in the middle, so the same
      // splitter (between the agents pane and the editor on the right)
      // grows agents.
      const sign = layoutMode === 'editor-center' ? -1 : 1
      const maxBySpace = window.innerWidth - MIN_EDITOR - sidebarWidth - 10
      const max = Math.min(MAX_AGENTS, Math.max(MIN_AGENTS, maxBySpace))
      setAgentsWidthState((w) => {
        const next = clamp(w + dx * sign, MIN_AGENTS, max)
        persistWidth(AGENTS_WIDTH_KEY, next)
        return next
      })
    },
    [layoutMode, sidebarWidth, persistWidth],
  )

  const setLayoutMode = useCallback((mode: LayoutMode) => {
    setLayoutModeState(mode)
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, mode)
    } catch {
      // ignore quota / disabled storage
    }
  }, [])

  // Tracks last on-disk content per path that we have open. Lets us tell our
  // own saves apart from external writes (claude editing the note).
  const lastDiskContentRef = useRef<Map<string, string>>(new Map())
  // Tracks the latest in-memory buffer per open note path. Diverges from
  // lastDiskContentRef while the user is typing between debounced saves —
  // used to detect "dirty" state when an external write lands.
  const bufferContentRef = useRef<Map<string, string>>(new Map())

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  // Monotonic counter that invalidates in-flight tree responses when a newer
  // load is started (e.g. rapid vault switching). Without this, a slow
  // response from the previous vault can overwrite the tree for the new one.
  const loadGenRef = useRef(0)

  const loadTree = useCallback(async (vp: string) => {
    const gen = ++loadGenRef.current
    const t = await window.marvin.vault.tree(vp)
    if (gen !== loadGenRef.current) return
    setTree(t)
  }, [])

  useEffect(() => {
    ;(async () => {
      const settings = await window.marvin.settings.get()
      const [claudePath, codexPath] = await Promise.all([
        window.marvin.agent.detect('claude'),
        window.marvin.agent.detect('codex'),
      ])
      setAgents([
        {
          id: 'claude',
          name: 'Claude Code',
          binaryPath: claudePath,
          installInstructions: [
            'npm i -g @anthropic-ai/claude-code',
            'curl -fsSL https://claude.ai/install.sh | bash',
          ],
        },
        {
          id: 'codex',
          name: 'Codex',
          binaryPath: codexPath,
          installInstructions: [
            'npm i -g @openai/codex',
            'brew install codex',
          ],
        },
      ])
      if (settings.vaultPath) {
        // Set the watch boundary before vaultPath so any subsequent file IPC
        // observes the active vault as allowed. The tree load is triggered
        // by the dedicated vaultPath effect below.
        await window.marvin.vault.watch(settings.vaultPath)
        setVaultPath(settings.vaultPath)
      }
      seedFromMain(settings)
      setBootstrapped(true)
    })()
  }, [])

  // Single source of truth for loading the tree whenever the active vault
  // changes (bootstrap, switch via handlePickVault). `loadTree`'s generation
  // token discards stale responses from a previous vault.
  useEffect(() => {
    if (!vaultPath) return
    void loadTree(vaultPath)
  }, [vaultPath, loadTree])

  useEffect(() => {
    if (!vaultPath) return
    const off = window.marvin.vault.onChanged(() => {
      loadTree(vaultPath)
    })
    return off
  }, [vaultPath, loadTree])

  useEffect(() => {
    if (!vaultPath) return
    const off = window.marvin.snapshot.onTurnCompleted((event) => {
      if (event.files.length === 0) return
      setTurnToast({ turnId: event.turnId, files: event.files })
    })
    return off
  }, [vaultPath])

  useEffect(() => {
    const off = window.marvin.file.onChanged(async (filePath, source) => {
      const last = lastDiskContentRef.current.get(filePath)
      if (last == null) return
      let fresh: string
      try {
        fresh = await window.marvin.file.read(filePath)
      } catch {
        // file may have been deleted concurrently; the unlink handler will close tabs
        return
      }
      if (fresh === last) return
      lastDiskContentRef.current.set(filePath, fresh)

      // "Dirty" means the editor's live buffer for this path has diverged from
      // the last known disk content. If we don't have a buffer entry yet we
      // assume clean (tab was just opened or no edits happened).
      const buffer = bufferContentRef.current.get(filePath)
      const isDirty = buffer != null && buffer !== last

      if (isDirty) {
        // Keep the buffer intact and surface the conflict via the banner.
        setTabs((prev) =>
          prev.map((t) =>
            isNoteTab(t) && t.path === filePath
              ? {
                  ...t,
                  pendingExternalChange: {
                    diskContent: fresh,
                    diskChangedAt: Date.now(),
                    source,
                  },
                }
              : t,
          ),
        )
        return
      }

      // Buffer is clean — reload silently and notify with a small toast.
      bufferContentRef.current.set(filePath, fresh)
      setTabs((prev) =>
        prev.map((t) =>
          isNoteTab(t) && t.path === filePath
            ? {
                ...t,
                content: fresh,
                version: t.version + 1,
                pendingExternalChange: undefined,
              }
            : t,
        ),
      )
      // For agent writes the snapshot:turn-completed toast already covers
      // multi-file batches, so we don't double-notify here.
      if (source === 'external') {
        setExternalToast({ filePath, source })
      }
    })
    return off
  }, [])

  const readFreshContent = useCallback(async (path: string): Promise<string> => {
    const content = await window.marvin.file.read(path)
    lastDiskContentRef.current.set(path, content)
    bufferContentRef.current.set(path, content)
    return content
  }, [])

  const openSnapshotPanel = useCallback(
    async (filePath: string, initialTurnId?: string) => {
      if (!vaultPath) return
      const prefix = vaultPath + '/'
      if (!filePath.startsWith(prefix)) {
        setError('File is outside the current vault')
        return
      }
      const relPath = filePath.slice(prefix.length)
      const openTab = tabs.find((t) => isNoteTab(t) && t.path === filePath)
      let current: string
      try {
        current =
          openTab && isNoteTab(openTab)
            ? openTab.content
            : await window.marvin.file.read(filePath)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to read file')
        return
      }
      setSnapshotPanel({ filePath, relPath, currentContent: current, initialTurnId })
    },
    [vaultPath, tabs],
  )

  const handleSnapshotRestored = useCallback(
    async (filePath: string) => {
      try {
        const content = await readFreshContent(filePath)
        setTabs((prev) =>
          prev.map((t) =>
            isNoteTab(t) && t.path === filePath
              ? { ...t, content, version: t.version + 1 }
              : t,
          ),
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to reload file')
      }
    },
    [readFreshContent],
  )

  const paletteItems = useMemo<PaletteItem[]>(
    () => (vaultPath ? flattenTree(tree, vaultPath) : []),
    [tree, vaultPath],
  )

  // (Global keyboard shortcuts effect is declared after openNewBrowserTab
  // below so the TDZ for that callback is closed by then.)

  const handlePickVault = async () => {
    const picked = await window.marvin.vault.pick()
    if (!picked) return
    if (picked === vaultPath) {
      // Same vault re-selected: setVaultPath would be a no-op and the
      // vaultPath useEffect wouldn't fire, leaving the tree blank.
      // Refresh explicitly — gen token still guards against any race.
      await loadTree(picked)
      return
    }
    // Set the main-process boundary BEFORE any renderer state changes, so any
    // file IPC that races in observes the new vault as allowed.
    await window.marvin.vault.watch(picked)
    setVaultPath(picked)
    setTree([])
    setTabs([])
    setActiveTabId(null)
    lastDiskContentRef.current.clear()
    bufferContentRef.current.clear()
    // The useEffect on `vaultPath` is the single trigger for loadTree —
    // calling it here would race with a stale prior response.
  }

  // Open a path. If a tab already shows it, focus that tab. Otherwise create a new one.
  const openInTab = useCallback(
    async (path: string) => {
      const existing = tabs.find(
        (t) =>
          (isNoteTab(t) && t.path === path) ||
          (isImageTab(t) && t.path === path),
      )
      if (existing) {
        setActiveTabId(existing.id)
        return
      }
      // Images: don't try to read as text — just open a viewer tab that
      // points at the file via the marvin:// custom protocol.
      if (isImagePath(path)) {
        const id = newTabId()
        setTabs((prev) => [...prev, { type: 'image', id, path }])
        setActiveTabId(id)
        return
      }
      // PDFs: open in a browser tab pointing at the marvin:// URL so
      // Chromium's built-in PDF viewer handles them. HTML files go through
      // the NoteTab branch — Editor.tsx's HTML branch renders the preview
      // via HtmlPreview while keeping the source editable.
      if (isPdfPath(path)) {
        const url = marvinFileUrl(path)
        const id = newTabId()
        setTabs((prev) => [
          ...prev,
          {
            type: 'browser',
            id,
            url,
            draftUrl: url,
            title: basenameOf(path),
            canBack: false,
            canForward: false,
            loading: true,
            ready: false,
          },
        ])
        setActiveTabId(id)
        return
      }
      try {
        const content = await readFreshContent(path)
        const id = newTabId()
        setTabs((prev) => [
          ...prev,
          { type: 'note', id, path, content, version: 0, back: [], forward: [] },
        ])
        setActiveTabId(id)
      } catch (err) {
        if (isBinaryReadError(err)) {
          // Hand binary files off to the OS so the right app handles them.
          setError(`Binary file: ${basenameOf(path)} — opened in Finder`)
          try {
            await window.marvin.shell.reveal(path)
          } catch {
            // ignore secondary failure
          }
          return
        }
        if (isDirectoryReadError(err)) {
          setError(`This is a folder: ${basenameOf(path)} — opened in Finder`)
          try {
            await window.marvin.shell.reveal(path)
          } catch {
            // ignore secondary failure
          }
          return
        }
        if (isTooLargeReadError(err)) {
          setError(humanizeError(err))
          return
        }
        reportError(err)
      }
    },
    [tabs, readFreshContent],
  )

  // Navigate within the active tab (used by link clicks in markdown preview).
  // Pushes current path onto back stack, clears forward.
  const navigateInActiveTab = useCallback(
    async (path: string) => {
      if (!activeTab || !isNoteTab(activeTab)) {
        await openInTab(path)
        return
      }
      if (!isMarkdownPath(path)) return
      if (path === activeTab.path) return
      const noteTab = activeTab
      try {
        const content = await readFreshContent(path)
        setTabs((prev) =>
          prev.map((t) =>
            isNoteTab(t) && t.id === noteTab.id
              ? {
                  ...t,
                  path,
                  content,
                  version: 0,
                  back: [...t.back, t.path],
                  forward: [],
                }
              : t,
          ),
        )
      } catch (err) {
        reportError(err)
      }
    },
    [activeTab, openInTab, readFreshContent],
  )

  const goBack = useCallback(async () => {
    if (!activeTab || !isNoteTab(activeTab) || activeTab.back.length === 0) return
    const noteTab = activeTab
    const target = noteTab.back[noteTab.back.length - 1]
    try {
      const content = await readFreshContent(target)
      setTabs((prev) =>
        prev.map((t) =>
          isNoteTab(t) && t.id === noteTab.id
            ? {
                ...t,
                path: target,
                content,
                version: 0,
                back: t.back.slice(0, -1),
                forward: [...t.forward, t.path],
              }
            : t,
        ),
      )
    } catch (err) {
      reportError(err)
    }
  }, [activeTab, readFreshContent])

  const goForward = useCallback(async () => {
    if (!activeTab || !isNoteTab(activeTab) || activeTab.forward.length === 0) return
    const noteTab = activeTab
    const target = noteTab.forward[noteTab.forward.length - 1]
    try {
      const content = await readFreshContent(target)
      setTabs((prev) =>
        prev.map((t) =>
          isNoteTab(t) && t.id === noteTab.id
            ? {
                ...t,
                path: target,
                content,
                version: 0,
                back: [...t.back, t.path],
                forward: t.forward.slice(0, -1),
              }
            : t,
        ),
      )
    } catch (err) {
      reportError(err)
    }
  }, [activeTab, readFreshContent])

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id)
        if (idx === -1) return prev
        const closing = prev[idx]
        const next = prev.filter((t) => t.id !== id)
        if (closing && isBrowserTab(closing)) {
          void window.marvin.browser.close(id)
        }
        if (closing && isNoteTab(closing)) {
          // Drop tracked buffer/disk content for paths no tab still owns.
          const stillOpen = next.some(
            (t) => isNoteTab(t) && t.path === closing.path,
          )
          if (!stillOpen) {
            bufferContentRef.current.delete(closing.path)
          }
        }
        // pick neighbor as new active if we closed the active one
        if (activeTabId === id) {
          const neighbor = next[idx] ?? next[idx - 1] ?? null
          setActiveTabId(neighbor ? neighbor.id : null)
        }
        return next
      })
    },
    [activeTabId],
  )

  const handleSelectFile = (node: FileNode) => {
    if (node.isDir) return
    void openInTab(node.path)
  }

  // Path-field navigation. `replaceCurrent` swaps the active note tab's
  // content (preserving its history); falls back to opening a new tab when
  // the target can't live in a note tab (image/pdf) or the active tab isn't
  // a note.
  const navigateOrOpen = useCallback(
    async (path: string, replaceCurrent: boolean) => {
      if (
        replaceCurrent &&
        activeTab &&
        isNoteTab(activeTab) &&
        !isImagePath(path) &&
        !isPdfPath(path) &&
        path !== activeTab.path
      ) {
        const noteTab = activeTab
        try {
          const content = await readFreshContent(path)
          setTabs((prev) =>
            prev.map((t) =>
              isNoteTab(t) && t.id === noteTab.id
                ? {
                    ...t,
                    path,
                    content,
                    version: 0,
                    back: [...t.back, t.path],
                    forward: [],
                  }
                : t,
            ),
          )
          return
        } catch (err) {
          if (!isBinaryReadError(err) && !isTooLargeReadError(err) && !isDirectoryReadError(err)) {
            reportError(err)
            return
          }
          // Binary/too-large — fall through to openInTab which handles them.
        }
      }
      await openInTab(path)
    },
    [activeTab, readFreshContent, openInTab],
  )

  // --- Browser tabs ----------------------------------------------------

  const openNewBrowserTab = useCallback(() => {
    const id = newTabId()
    const url = 'https://www.google.com'
    setTabs((prev) => [
      ...prev,
      {
        type: 'browser',
        id,
        url,
        draftUrl: url,
        title: 'New tab',
        canBack: false,
        canForward: false,
        loading: true,
        ready: false,
      },
    ])
    setActiveTabId(id)
    // Focus URL bar on open so the user can immediately type a different URL.
    setUrlBarFocusTick((t) => t + 1)
  }, [])

  const handleBrowserDraftChange = useCallback((id: string, value: string) => {
    setTabs((prev) =>
      prev.map((t) => (isBrowserTab(t) && t.id === id ? { ...t, draftUrl: value } : t)),
    )
  }, [])

  const handleBrowserNavigate = useCallback(async (id: string, url: string) => {
    const normalized = normalizeUrl(url)
    setTabs((prev) =>
      prev.map((t) =>
        isBrowserTab(t) && t.id === id
          ? { ...t, draftUrl: normalized, loading: true }
          : t,
      ),
    )
    try {
      await window.marvin.browser.navigate(id, normalized)
    } catch {
      // surfaced via load-error event
    }
  }, [])

  const handleBrowserReady = useCallback((id: string) => {
    setTabs((prev) =>
      prev.map((t) => (isBrowserTab(t) && t.id === id ? { ...t, ready: true } : t)),
    )
  }, [])

  // Subscribe to browser events from the main process and reflect them on
  // the relevant tab's state.
  useEffect(() => {
    const off = window.marvin.browser.onEvent((event) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (!isBrowserTab(t) || t.id !== event.id) return t
          switch (event.kind) {
            case 'title':
              return { ...t, title: event.title || t.title }
            case 'url':
              return { ...t, url: event.url, draftUrl: event.url }
            case 'loading':
              return { ...t, loading: event.loading }
            case 'nav-state':
              return { ...t, canBack: event.canBack, canForward: event.canForward }
            case 'load-error':
              return { ...t, loading: false }
            default:
              return t
          }
        }),
      )
    })
    return off
  }, [])

  // Tell main which browser is currently the active visible one (or null).
  // HtmlPreview also rides on the browser-view IPC, so when an HTML NoteTab
  // is active we point the active id at its synthetic preview id.
  useEffect(() => {
    let activeBrowserId: string | null = null
    if (activeTab && isBrowserTab(activeTab)) {
      activeBrowserId = activeTab.id
    } else if (activeTab && isNoteTab(activeTab) && isHtmlPath(activeTab.path)) {
      activeBrowserId = `html-preview-${activeTab.path}`
    }
    void window.marvin.browser.setActive(activeBrowserId)
  }, [activeTab])

  // Hide all browser views while any React modal/popover is open, so they
  // don't paint over the modal (WebContentsView is always above the renderer).
  const modalOpen = paletteOpen || settingsOpen || dialog != null || ctx != null || error != null
  useEffect(() => {
    void window.marvin.browser.setAllHidden(modalOpen)
  }, [modalOpen])

  // Global keyboard shortcuts. Declared after openNewBrowserTab so the
  // dependency array can reference it without TDZ.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCmd = e.metaKey || e.ctrlKey
      if (!isCmd) return
      // Cmd+P → file palette
      if (!e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        if (!vaultPath) return
        e.preventDefault()
        setPaletteOpen(true)
        return
      }
      // Cmd+T → new browser tab (browser convention)
      if (!e.shiftKey && (e.key === 't' || e.key === 'T')) {
        if (!vaultPath) return
        e.preventDefault()
        openNewBrowserTab()
        return
      }
      // Cmd+Shift+T → new agent terminal in the agents column
      if (e.shiftKey && (e.key === 't' || e.key === 'T')) {
        if (!vaultPath) return
        e.preventDefault()
        setNewAgentTabTick((t) => t + 1)
        return
      }
      // Cmd+L → focus URL bar of the active browser tab
      if (!e.shiftKey && (e.key === 'l' || e.key === 'L')) {
        if (!vaultPath) return
        e.preventDefault()
        setUrlBarFocusTick((t) => t + 1)
        return
      }
      // Cmd+, → settings
      if (!e.shiftKey && e.key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [vaultPath, openNewBrowserTab])

  const handlePalettePick = useCallback(
    async (item: PaletteItem, replaceCurrent: boolean) => {
      setPaletteOpen(false)
      // Try to open any file in a tab; openInTab gracefully reveals binaries
      // in Finder. Markdown link semantics (replace current tab) only apply
      // when the picked item is markdown — for other text files we always
      // open in a new tab.
      if (item.isMarkdown && replaceCurrent && activeTab) {
        await navigateInActiveTab(item.path)
      } else {
        await openInTab(item.path)
      }
    },
    [activeTab, navigateInActiveTab, openInTab],
  )

  const handleSave = useCallback(
    async (content: string) => {
      if (!activeTab || !isNoteTab(activeTab)) return
      await window.marvin.file.write(activeTab.path, content)
      lastDiskContentRef.current.set(activeTab.path, content)
      bufferContentRef.current.set(activeTab.path, content)
    },
    [activeTab],
  )

  const handleBufferChange = useCallback((path: string, content: string) => {
    bufferContentRef.current.set(path, content)
  }, [])

  const clearPendingExternalChange = useCallback((filePath: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        isNoteTab(t) && t.path === filePath
          ? { ...t, pendingExternalChange: undefined }
          : t,
      ),
    )
  }, [])

  // "Reload": snapshot the user's current buffer (so they can recover it) and
  // then swap the buffer to whatever's on disk now. If the buffer can't be
  // snapshotted (binary content), block the reload so the user doesn't lose
  // data they can't recover from the versions panel.
  const handleAcceptDisk = useCallback(
    async (filePath: string, diskContent: string, currentBuffer: string) => {
      if (!vaultPath) return
      const prefix = vaultPath + '/'
      if (filePath.startsWith(prefix)) {
        const relPath = filePath.slice(prefix.length)
        try {
          const res = await window.marvin.snapshot.saveBuffer(relPath, currentBuffer)
          if (!res.ok) {
            setError(`Could not snapshot your buffer before reloading (${res.error}).`)
            return
          }
          if (res.data.saved === false) {
            setError(
              "Couldn't snapshot current buffer (binary content) — use 'Keep my version' instead.",
            )
            return
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to snapshot buffer')
          return
        }
      }
      lastDiskContentRef.current.set(filePath, diskContent)
      bufferContentRef.current.set(filePath, diskContent)
      setTabs((prev) =>
        prev.map((t) =>
          isNoteTab(t) && t.path === filePath
            ? {
                ...t,
                content: diskContent,
                version: t.version + 1,
                pendingExternalChange: undefined,
              }
            : t,
        ),
      )
    },
    [vaultPath],
  )

  // "Keep my version": dismiss the banner without touching the buffer. The
  // editor's pending debounced save will eventually overwrite disk. For
  // agent-sourced changes the file:write hook already snapshots the on-disk
  // version (aiActive=true). For external sources the hook skips, so we
  // snapshot the disk content explicitly here as 'external-rejected' so the
  // user can still recover it from the versions panel. Fail-soft: a snapshot
  // failure does not block dismissing the banner.
  const handleKeepMine = useCallback(
    async (filePath: string, source: FileChangeSource, diskContent: string) => {
      if (source === 'external' && vaultPath) {
        const prefix = vaultPath + '/'
        if (filePath.startsWith(prefix)) {
          const relPath = filePath.slice(prefix.length)
          try {
            const res = await window.marvin.snapshot.saveExternalChange(relPath, diskContent)
            if (!res.ok) {
              setError(`Could not snapshot external change (${res.error}).`)
            }
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to snapshot external change')
          }
        }
      }
      clearPendingExternalChange(filePath)
    },
    [clearPendingExternalChange, vaultPath],
  )

  const reportError = (err: unknown) => {
    setError(humanizeError(err))
    const raw = err instanceof Error ? err.message : String(err)
    if (/MARVIN_OUTSIDE_VAULT/.test(raw) && vaultPath) {
      void loadTree(vaultPath).catch(() => {})
    }
  }

  const renameInTabs = (oldPath: string, newPath: string) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (!isNoteTab(t)) return t
        let path = t.path
        if (path === oldPath) path = newPath
        else if (path.startsWith(`${oldPath}/`)) path = newPath + path.slice(oldPath.length)
        const back = t.back.map((p) =>
          p === oldPath ? newPath : p.startsWith(`${oldPath}/`) ? newPath + p.slice(oldPath.length) : p,
        )
        const forward = t.forward.map((p) =>
          p === oldPath ? newPath : p.startsWith(`${oldPath}/`) ? newPath + p.slice(oldPath.length) : p,
        )
        return path === t.path && back === t.back && forward === t.forward
          ? t
          : { ...t, path, back, forward }
      }),
    )
    // remap tracked content for both the on-disk and live buffer maps
    for (const tracked of [lastDiskContentRef.current, bufferContentRef.current]) {
      for (const [k, v] of Array.from(tracked.entries())) {
        if (k === oldPath) {
          tracked.delete(k)
          tracked.set(newPath, v)
        } else if (k.startsWith(`${oldPath}/`)) {
          tracked.delete(k)
          tracked.set(newPath + k.slice(oldPath.length), v)
        }
      }
    }
  }

  const closeTabsUnder = (root: string) => {
    setTabs((prev) => {
      const remaining = prev.filter(
        (t) => !isNoteTab(t) || (t.path !== root && !t.path.startsWith(`${root}/`)),
      )
      if (
        activeTabId &&
        !remaining.find((t) => t.id === activeTabId)
      ) {
        setActiveTabId(remaining[0]?.id ?? null)
      }
      return remaining
    })
    const tracked = lastDiskContentRef.current
    for (const k of Array.from(tracked.keys())) {
      if (k === root || k.startsWith(`${root}/`)) tracked.delete(k)
    }
  }

  const handleCreate = async (name: string) => {
    if (!dialog || !vaultPath) return
    const d = dialog
    setDialog(null)
    try {
      if (d.kind === 'newNote') {
        const newPath = await window.marvin.file.create(d.parentDir, name)
        await loadTree(vaultPath)
        await openInTab(newPath)
      } else if (d.kind === 'newFolder') {
        await window.marvin.folder.create(d.parentDir, name)
        await loadTree(vaultPath)
      } else if (d.kind === 'rename') {
        const newPath = `${dirOf(d.target)}/${name}`
        await window.marvin.path.rename(d.target, newPath)
        renameInTabs(d.target, newPath)
        await loadTree(vaultPath)
      }
    } catch (err) {
      reportError(err)
    }
  }

  const handleTrash = async (target: string) => {
    if (!vaultPath) return
    try {
      await window.marvin.path.trash(target)
      closeTabsUnder(target)
      await loadTree(vaultPath)
    } catch (err) {
      reportError(err)
    }
  }

  // Drag-and-drop: move src into destDir via rename.
  const handleDropMove = async (srcPath: string, destDir: string) => {
    if (!vaultPath) return
    if (srcPath === destDir) return
    if (destDir.startsWith(`${srcPath}/`) || destDir === srcPath) return // dest is descendant of src
    const baseName = srcPath.split('/').pop() ?? srcPath
    const newPath = `${destDir}/${baseName}`
    if (newPath === srcPath) return // same parent
    try {
      await window.marvin.path.rename(srcPath, newPath)
      renameInTabs(srcPath, newPath)
      await loadTree(vaultPath)
    } catch (err) {
      reportError(err)
    }
  }

  const handleNodeContextMenu = (e: React.MouseEvent, node: FileNode) => {
    e.preventDefault()
    e.stopPropagation()
    const items: MenuItem[] = []
    if (node.isDir) {
      items.push(
        {
          kind: 'item',
          label: 'New note here',
          icon: 'new-file',
          onClick: () => setDialog({ kind: 'newNote', parentDir: node.path }),
        },
        {
          kind: 'item',
          label: 'New folder here',
          icon: 'new-folder',
          onClick: () => setDialog({ kind: 'newFolder', parentDir: node.path }),
        },
        { kind: 'separator' },
      )
    }
    items.push(
      {
        kind: 'item',
        label: 'Rename',
        icon: 'edit',
        onClick: () => setDialog({ kind: 'rename', target: node.path, isDir: node.isDir }),
      },
      {
        kind: 'item',
        label: 'Reveal in Finder',
        icon: 'go-to-file',
        onClick: () => void window.marvin.shell.reveal(node.path),
      },
    )
    if (!node.isDir) {
      items.push({
        kind: 'item',
        label: 'View versions…',
        onClick: () => void openSnapshotPanel(node.path),
      })
    }
    items.push(
      { kind: 'separator' },
      {
        kind: 'item',
        label: node.isDir ? 'Move folder to Trash' : 'Move file to Trash',
        icon: 'trash',
        danger: true,
        onClick: () => handleTrash(node.path),
      },
    )
    setCtx({ x: e.clientX, y: e.clientY, items })
  }

  if (!bootstrapped) {
    return <div className="bootstrap">Loading…</div>
  }

  if (!vaultPath) {
    return (
      <div className="welcome">
        <h1>Marvin</h1>
        <p>Markdown notes with Claude Code in your sidebar.</p>
        <button type="button" onClick={handlePickVault}>
          Open vault folder
        </button>
      </div>
    )
  }

  const dialogConfig = (() => {
    if (!dialog) return null
    if (dialog.kind === 'newNote') {
      return { title: 'New note', placeholder: 'note-name', submit: 'Create', initial: '' }
    }
    if (dialog.kind === 'newFolder') {
      return { title: 'New folder', placeholder: 'folder-name', submit: 'Create', initial: '' }
    }
    return {
      title: dialog.isDir ? 'Rename folder' : 'Rename file',
      placeholder: '',
      submit: 'Rename',
      initial: dialog.target.split('/').pop() ?? '',
    }
  })()

  return (
    <div className="shell">
      <div
        className="app"
        data-layout={layoutMode}
        style={
          {
            ['--sidebar-w' as string]: `${sidebarWidth}px`,
            ['--agents-w' as string]: `${agentsWidth}px`,
          } as React.CSSProperties
        }
      >
      <aside className="sidebar">
        <div className="sidebar-search">
          <button
            type="button"
            className="sidebar-search-btn"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search (⌘P)"
          >
            <Icon name="search" size={14} />
            <span className="sidebar-search-placeholder">Search…</span>
            <span className="sidebar-search-kbd">⌘P</span>
          </button>
        </div>
        <div className="sidebar-header">
          <div className="sidebar-project-info">
            <div className="sidebar-project-text">
              <span className="sidebar-project-name">{vaultPath.split('/').pop()}</span>
              <span className="sidebar-branch-name">
                <Icon name="git-branch" size={14} />
                main
              </span>
            </div>
          </div>
          <FileTreeToolbar
            isAnyOpen={openPaths.size > 0}
            onNewFile={() => setDialog({ kind: 'newNote', parentDir: vaultPath })}
            onNewFolder={() => setDialog({ kind: 'newFolder', parentDir: vaultPath })}
            onRefresh={() => void loadTree(vaultPath)}
            onToggleAll={() =>
              setOpenPaths((prev) =>
                prev.size > 0 ? new Set() : new Set(collectDirPaths(tree)),
              )
            }
          />
        </div>
        <FileTree
          nodes={tree}
          vaultPath={vaultPath}
          selectedPath={activeTab && isNoteTab(activeTab) ? activeTab.path : null}
          openPaths={openPaths}
          onToggleOpen={(p) =>
            setOpenPaths((prev) => {
              const next = new Set(prev)
              if (next.has(p)) next.delete(p)
              else next.add(p)
              return next
            })
          }
          onSelect={handleSelectFile}
          onContextMenu={handleNodeContextMenu}
          onMove={handleDropMove}
        />
        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-footer-btn"
            onClick={handlePickVault}
          >
            <Icon name="folder" size={16} />
            <span>Switch Folder</span>
          </button>
          <button
            type="button"
            className="sidebar-footer-btn"
            onClick={() => setSettingsOpen(true)}
          >
            <Icon name="gear" size={16} />
            <span>Settings</span>
          </button>
        </div>
      </aside>

      <Splitter onDelta={handleSidebarDelta} ariaLabel="Resize sidebar" />

      <main className="editor-pane">
        <TabBar
          tabs={tabs}
          activeId={activeTabId}
          onActivate={setActiveTabId}
          onClose={closeTab}
          onNewBrowserTab={openNewBrowserTab}
        />
        <div className="editor-stack">
          {activeTab && isNoteTab(activeTab) && (
            <div className="note-tab-container">
              {activeTab.pendingExternalChange && (
                <ExternalChangeBanner
                  filePath={activeTab.path}
                  getCurrentBuffer={() =>
                    bufferContentRef.current.get(activeTab.path) ?? activeTab.content
                  }
                  diskContent={activeTab.pendingExternalChange.diskContent}
                  diskChangedAt={activeTab.pendingExternalChange.diskChangedAt}
                  source={activeTab.pendingExternalChange.source}
                  onAcceptDisk={() =>
                    handleAcceptDisk(
                      activeTab.path,
                      activeTab.pendingExternalChange!.diskContent,
                      bufferContentRef.current.get(activeTab.path) ?? activeTab.content,
                    )
                  }
                  onKeepMine={() =>
                    handleKeepMine(
                      activeTab.path,
                      activeTab.pendingExternalChange!.source,
                      activeTab.pendingExternalChange!.diskContent,
                    )
                  }
                  onDismiss={() => clearPendingExternalChange(activeTab.path)}
                />
              )}
              <Editor
                key={`${activeTab.id}#${activeTab.path}`}
                filePath={activeTab.path}
                vaultPath={vaultPath}
                initialContent={activeTab.content}
                version={activeTab.version}
                geometryKey={`${layoutMode}#${sidebarWidth}#${agentsWidth}`}
                paletteItems={paletteItems}
                onSave={handleSave}
                onBufferChange={(content) => handleBufferChange(activeTab.path, content)}
                onNavigate={navigateOrOpen}
                canBack={activeTab.back.length > 0}
                canForward={activeTab.forward.length > 0}
                onBack={goBack}
                onForward={goForward}
              />
            </div>
          )}
          {activeTab && isImageTab(activeTab) && (
            <ImageViewer
              key={activeTab.id}
              path={activeTab.path}
              onRevealInFinder={(p) => void window.marvin.shell.reveal(p)}
            />
          )}
          {!activeTab && (
            <div className="empty-editor">Select a note or create a new one.</div>
          )}
          {/* Browser tabs are rendered as a stack (lazy mount, hidden when
              inactive) so each WebContentsView keeps its session alive across
              switches. */}
          {tabs.filter(isBrowserTab).map((bt) => (
            <BrowserPane
              key={bt.id}
              tab={bt}
              isActive={bt.id === activeTabId}
              onUrlBarChange={handleBrowserDraftChange}
              onNavigate={handleBrowserNavigate}
              onReady={handleBrowserReady}
              urlBarFocusTick={urlBarFocusTick}
              geometryKey={`${layoutMode}#${sidebarWidth}#${agentsWidth}`}
            />
          ))}
        </div>
      </main>

      <Splitter onDelta={handleAgentsDelta} ariaLabel="Resize agents pane" />

      <aside className="claude-pane">
        <AgentsPane
          agents={agents}
          vaultPath={vaultPath}
          newTabTick={newAgentTabTick}
        />
      </aside>

      {dialog && dialogConfig && (
        <InputDialog
          title={dialogConfig.title}
          placeholder={dialogConfig.placeholder}
          initialValue={dialogConfig.initial}
          submitLabel={dialogConfig.submit}
          onSubmit={handleCreate}
          onCancel={() => setDialog(null)}
        />
      )}

      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          items={ctx.items}
          onClose={() => setCtx(null)}
        />
      )}

      {error && (
        <div className="error-toast" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {paletteOpen && (
        <CommandPalette
          items={paletteItems}
          onPick={handlePalettePick}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          layoutMode={layoutMode}
          onLayoutChange={setLayoutMode}
        />
      )}

      {snapshotPanel && (
        <SnapshotPanel
          filePath={snapshotPanel.filePath}
          relPath={snapshotPanel.relPath}
          currentContent={snapshotPanel.currentContent}
          initialTurnId={snapshotPanel.initialTurnId}
          onClose={() => setSnapshotPanel(null)}
          onRestored={handleSnapshotRestored}
          onError={setError}
        />
      )}

      {turnToast && vaultPath && (
        <SnapshotToast
          files={turnToast.files}
          onOpenVersions={() => {
            const firstRel = turnToast.files[0]
            if (!firstRel) return
            const absPath = `${vaultPath}/${firstRel}`
            void openSnapshotPanel(absPath, turnToast.turnId)
            setTurnToast(null)
          }}
          onDismiss={() => setTurnToast(null)}
        />
      )}

      {externalToast && vaultPath && (
        <SnapshotToast
          files={[externalToast.filePath.startsWith(vaultPath + '/')
            ? externalToast.filePath.slice(vaultPath.length + 1)
            : externalToast.filePath]}
          agentLabel="External change"
          verb="updated"
          onOpenVersions={() => {
            void openSnapshotPanel(externalToast.filePath)
            setExternalToast(null)
          }}
          onDismiss={() => setExternalToast(null)}
        />
      )}
      </div>
    </div>
  )
}
