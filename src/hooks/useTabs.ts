import { useEffect, useMemo, useRef, useState } from 'react'
import { type Tab, isNoteTab } from '../lib/tabs'

// Cap on simultaneously-mounted note editors (#440). The hidden-stack keeps an
// editor mounted per open note tab to preserve undo/cursor/scroll across
// switches; this bounds the memory cost to the K most-recently-active tabs.
const MAX_MOUNTED_EDITORS = 6

/**
 * Owns the tab state machine and its content-tracking maps. This first slice
 * (#578) holds the state, refs, and derivations; open/close/navigate/rename
 * transitions are migrated onto the hook in later slices.
 */
export function useTabs() {
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

  return {
    tabs,
    setTabs,
    activeTabId,
    setActiveTabId,
    lastDiskContentRef,
    bufferContentRef,
    activeTab,
    editorMru,
    setEditorMru,
    mountedNoteTabs,
  }
}
