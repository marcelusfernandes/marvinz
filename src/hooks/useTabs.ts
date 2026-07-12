import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type Tab, isBrowserTab, isNoteTab } from '../lib/tabs'

// Cap on simultaneously-mounted note editors (#440). The hidden-stack keeps an
// editor mounted per open note tab to preserve undo/cursor/scroll across
// switches; this bounds the memory cost to the K most-recently-active tabs.
const MAX_MOUNTED_EDITORS = 6

type UseTabsDeps = {
  /** Tears down the WebContentsView backing a browser tab on close (IPC). */
  closeBrowserTab: (id: string) => void
}

/**
 * Owns the tab state machine and its content-tracking maps. Side effects
 * (disk I/O, browser IPC, error surfacing) are injected so the hook stays
 * unit-testable without mounting App. open/navigate transitions still live in
 * App and are migrated onto the hook in the remaining slices (#578).
 */
export function useTabs({ closeBrowserTab }: UseTabsDeps) {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)

  // Tracks last on-disk content per path that we have open. Lets us tell our
  // own saves apart from external writes (claude editing the note).
  const lastDiskContentRef = useRef<Map<string, string>>(new Map())
  // Tracks the latest in-memory buffer per open note path. Diverges from
  // lastDiskContentRef while the user is typing between debounced saves —
  // used to detect "dirty" state when an external write lands.
  const bufferContentRef = useRef<Map<string, string>>(new Map())

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  // Latest tabs snapshot for handlers (closeTab) that must read current tab
  // state without taking `tabs` as a dependency (matching the latest-ref pattern).
  const tabsRef = useRef(tabs)
  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  // `editorMru` holds note-tab ids most-recent-first; bounds which editors stay
  // mounted (only the MAX_MOUNTED_EDITORS most-recently-active note tabs).
  const [editorMru, setEditorMru] = useState<string[]>([])
  useEffect(() => {
    if (!activeTabId) return
    setEditorMru((prev) =>
      prev[0] === activeTabId ? prev : [activeTabId, ...prev.filter((id) => id !== activeTabId)]
    )
  }, [activeTabId])

  const mountedNoteTabs = useMemo(() => {
    const noteTabs = tabs.filter(isNoteTab)
    const rank = new Map(editorMru.map((id, i) => [id, i] as const))
    const ordered = [...noteTabs].sort(
      (a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity)
    )
    const keep = new Set(ordered.slice(0, MAX_MOUNTED_EDITORS).map((t) => t.id))
    // Always keep the active tab mounted even if the MRU effect hasn't run yet
    // (a freshly opened tab renders before its effect updates `editorMru`).
    if (activeTabId) keep.add(activeTabId)
    const evicted = noteTabs.filter((t) => !keep.has(t.id))
    if (evicted.length > 0) {
      console.debug(
        `[App] unmounting ${evicted.length} editor(s) beyond MAX_MOUNTED_EDITORS=${MAX_MOUNTED_EDITORS} (rebuild-on-activate):`,
        evicted.map((t) => t.path)
      )
    }
    return noteTabs.filter((t) => keep.has(t.id))
  }, [tabs, editorMru, activeTabId])

  // Removes the tab and its tracked buffer; no dirty checks. Callers gate the
  // entry (see closeTab) so this stays a pure removal step.
  const performCloseTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id)
        if (idx === -1) return prev
        const closing = prev[idx]
        const next = prev.filter((t) => t.id !== id)
        if (closing && isBrowserTab(closing)) {
          closeBrowserTab(id)
        }
        if (closing && isNoteTab(closing)) {
          // Drop tracked buffer/disk content for paths no tab still owns.
          const stillOpen = next.some((t) => isNoteTab(t) && t.path === closing.path)
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
    [activeTabId, closeBrowserTab]
  )

  const renameInTabs = (oldPath: string, newPath: string) => {
    // Snapshot keyed by old path — the remap loop below mutates the ref, so the
    // updater must read buffers captured before that.
    const liveBuffers = new Map(bufferContentRef.current)
    setTabs((prev) =>
      prev.map((t) => {
        if (!isNoteTab(t)) return t
        let path = t.path
        if (path === oldPath) path = newPath
        else if (path.startsWith(`${oldPath}/`)) path = newPath + path.slice(oldPath.length)
        const back = t.back.map((p) =>
          p === oldPath
            ? newPath
            : p.startsWith(`${oldPath}/`)
              ? newPath + p.slice(oldPath.length)
              : p
        )
        const forward = t.forward.map((p) =>
          p === oldPath
            ? newPath
            : p.startsWith(`${oldPath}/`)
              ? newPath + p.slice(oldPath.length)
              : p
        )
        const buffered = liveBuffers.get(t.path)
        const content = buffered !== undefined ? buffered : t.content
        return path === t.path && back === t.back && forward === t.forward && content === t.content
          ? t
          : { ...t, path, back, forward, content }
      })
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
        (t) => !isNoteTab(t) || (t.path !== root && !t.path.startsWith(`${root}/`))
      )
      if (activeTabId && !remaining.find((t) => t.id === activeTabId)) {
        setActiveTabId(remaining[0]?.id ?? null)
      }
      return remaining
    })
    const tracked = lastDiskContentRef.current
    for (const k of Array.from(tracked.keys())) {
      if (k === root || k.startsWith(`${root}/`)) tracked.delete(k)
    }
  }

  return {
    tabs,
    setTabs,
    activeTabId,
    setActiveTabId,
    lastDiskContentRef,
    bufferContentRef,
    tabsRef,
    activeTab,
    editorMru,
    setEditorMru,
    mountedNoteTabs,
    performCloseTab,
    renameInTabs,
    closeTabsUnder,
  }
}
