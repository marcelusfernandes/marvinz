import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import type { EditorView as PMView } from 'prosemirror-view'

type ReplaceToast = { count: number; nonce: number; phase: 'enter' | 'leave' }

/**
 * Owns the note editor's find/replace bar state and the replace-confirmation
 * toast lifecycle, plus the window-level Cmd+F / Cmd+Alt+F tick handling.
 * Extracted from Editor.tsx (#587) with no behavior change — Editor keeps only
 * the rendering branch (CodeMirrorFindBar vs FindReplaceOverlay).
 */
export function useFindReplaceState({
  openFindTick,
  openReplaceTick,
  isActive,
}: {
  openFindTick?: number
  openReplaceTick?: number
  isActive: boolean
}) {
  // Find / Replace bar state. The bar itself owns the collapsed/expanded
  // state of the Replace row (persisted to localStorage); `forceReplace`
  // here is a one-shot signal from Cmd+Alt+F that overrides the persisted
  // preference for the next open. `pmView` is set by LiveMarkdown via
  // `onViewReady` so the bar can drive prosemirror-search commands; `cmView`
  // mirrors the CodeMirror view from `viewRef` for the same purpose, kept as
  // state so the bar re-renders when the view becomes available.
  const [findOpen, setFindOpen] = useState(false)
  const [forceReplace, setForceReplace] = useState(false)
  const [pmView, setPmView] = useState<PMView | null>(null)
  const [cmView, setCmView] = useState<EditorView | null>(null)

  // Lightweight in-pane confirmation that floats over the editor body
  // (top-center) after Replace / Replace All. Two-phase lifecycle:
  //   'enter' — visible, after 2s flips to 'leave'
  //   'leave' — fade-out class is applied; after the 200ms animation we
  //             null out the toast so the DOM unmounts cleanly.
  // The `nonce` key remounts the element on bursts so each successive
  // replacement re-runs the enter animation from scratch.
  const [replaceToast, setReplaceToast] = useState<ReplaceToast | null>(null)
  useEffect(() => {
    if (!replaceToast || replaceToast.phase !== 'enter') return
    const t = window.setTimeout(
      () => setReplaceToast((prev) => (prev ? { ...prev, phase: 'leave' } : null)),
      2000
    )
    return () => window.clearTimeout(t)
  }, [replaceToast])
  useEffect(() => {
    if (!replaceToast || replaceToast.phase !== 'leave') return
    const t = window.setTimeout(() => setReplaceToast(null), 200)
    return () => window.clearTimeout(t)
  }, [replaceToast])
  const handleReplaced = useCallback((count: number) => {
    setReplaceToast({ count, nonce: Date.now(), phase: 'enter' })
  }, [])

  // Convenience helpers wired into both editor keymaps and the LiveMarkdown
  // `onOpenFind` callback. `openFind('replace')` mirrors the historical
  // Cmd+Alt+F shortcut by forcing the Replace row open on the next mount.
  const openFind = useCallback((variant: 'find' | 'replace') => {
    setForceReplace(variant === 'replace')
    setFindOpen(true)
  }, [])
  const closeFind = useCallback(() => {
    setFindOpen(false)
    setForceReplace(false)
  }, [])

  // Window-level Cmd+F / Cmd+Alt+F: App.tsx bumps these ticks when the
  // shortcut fires outside the editor surface (sidebar / agents / tab bar).
  // The local CM/PM keymaps still handle in-editor presses; the parent
  // listener defers to them by inspecting the event target. Skip the first
  // render (no tick change) so opening a tab doesn't auto-pop the bar.
  // Hidden editors in the stack receive the same tick value as the active one,
  // so gate on isActive: an inactive editor consumes the tick (advances its
  // ref) without opening its find bar, so re-activating it later doesn't replay
  // a tick fired while it was hidden.
  const lastFindTickRef = useRef(openFindTick ?? 0)
  useEffect(() => {
    if (openFindTick === undefined || openFindTick === lastFindTickRef.current) return
    lastFindTickRef.current = openFindTick
    if (isActive) openFind('find')
  }, [openFindTick, openFind, isActive])
  const lastReplaceTickRef = useRef(openReplaceTick ?? 0)
  useEffect(() => {
    if (openReplaceTick === undefined || openReplaceTick === lastReplaceTickRef.current) return
    lastReplaceTickRef.current = openReplaceTick
    if (isActive) openFind('replace')
  }, [openReplaceTick, openFind, isActive])

  return {
    findOpen,
    forceReplace,
    pmView,
    cmView,
    setPmView,
    setCmView,
    openFind,
    closeFind,
    replaceToast,
    handleReplaced,
  }
}
