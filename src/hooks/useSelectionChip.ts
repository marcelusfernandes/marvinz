import { useCallback, useEffect, useState, type RefObject } from 'react'
import type { EditorView } from '@codemirror/view'
import type { AgentKind } from '../lib/agent-drop-format'
import { clampToViewport } from '../lib/chipViewportClamp'
import { formatSelectionForAgent } from '../lib/agent-selection-format'

type ChipCoords = { left: number; right: number; top: number; bottom: number }

// CodeMirror sets `from`/`to` (doc offsets) and the `view` so the click can
// slice the doc and derive an exact line range (the view object is stable per
// mount and exposes live `state`); the DOM source leaves them undefined and
// reads the live selection at click time.
type ChipState = { coords: ChipCoords; from?: number; to?: number; view?: EditorView }

export type CmSelectionUpdate = {
  selectionSet?: boolean
  state: { selection: { main: { from: number; to: number; empty: boolean } } }
  view: EditorView
}

export type SelectionChipSource =
  | { kind: 'codemirror'; viewRef: RefObject<EditorView | null>; isActive: boolean }
  | { kind: 'dom'; containerRef: RefObject<HTMLElement | null>; body: string }

// Locates the line range of a rendered selection inside the markdown source.
// Returns "N" or "N-M" if an unambiguous match exists; null otherwise (caller
// falls back to no range). Best-effort: rendered text equals source for plain
// paragraphs, but markdown decorations (bold, headings, emphasis) strip on
// render — those selections fail to match and gracefully degrade. Moved here
// from LiveMarkdown (#587) so the shared chip hook owns it.
export function findSelectionLineRange(selectedText: string, source: string): string | null {
  const trimmed = selectedText.replace(/\s+$/, '')
  if (!trimmed || !source) return null
  const idx = source.indexOf(trimmed)
  if (idx === -1) return null
  if (source.indexOf(trimmed, idx + 1) !== -1) return null
  const startLine = source.slice(0, idx).split('\n').length
  const endLine = source.slice(0, idx + trimmed.length).split('\n').length
  return startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`
}

// The single prefix-building path shared by both position sources. Range is
// always present for the CodeMirror source (from `doc.lineAt`) and best-effort
// for the DOM source (`findSelectionLineRange` → may be null, dropping the
// `:range` so the prefix is just the file path).
export function buildSelectionPrefix(
  filePath: string,
  range: string | null,
  agentKind: AgentKind | undefined
): string {
  const pathRef = range ? `${filePath}:${range}` : filePath
  return agentKind === 'codex' ? `@${pathRef}` : pathRef
}

/**
 * Selection-to-agent chip: derives the chip's viewport position and builds the
 * click-to-send payload. One hook, two interchangeable position sources behind
 * a discriminated `source` — a CodeMirror view (`coordsAtPos` + scroll/resize
 * reposition) or a DOM container (`selectionchange` + `Range.getClientRects`).
 * Both route through one `clampToViewport` + `formatSelectionForAgent` +
 * `buildSelectionPrefix` tail. Extracted from Editor.tsx / LiveMarkdown.tsx
 * (#587) with no behavior change; each source keeps its own asymmetries (only
 * the CodeMirror source repositions on scroll/resize; only the DOM source
 * debounces and best-effort-resolves the line range).
 */
export function useSelectionChip(opts: {
  source: SelectionChipSource
  filePath: string
  agentKind?: AgentKind
  onSendSelection?: (formatted: string) => void
}): {
  chip: ChipState | null
  handleChipClick: () => void
  onCmSelectionChange: (update: CmSelectionUpdate) => void
} {
  const { source, filePath, agentKind = 'codex', onSendSelection } = opts
  const kind = source.kind
  const cmViewRef = source.kind === 'codemirror' ? source.viewRef : null
  const isActive = source.kind === 'codemirror' ? source.isActive : false
  const domContainerRef = source.kind === 'dom' ? source.containerRef : null
  const body = source.kind === 'dom' ? source.body : ''

  const [chip, setChip] = useState<ChipState | null>(null)

  // CodeMirror source: fed by Editor's onUpdate (which owns the viewRef
  // mirror). Chip coords come from `view.coordsAtPos(sel.to)`. Set
  // unconditionally — the render gates on onSendSelection.
  const onCmSelectionChange = useCallback((update: CmSelectionUpdate) => {
    if (!update.selectionSet) return
    const sel = update.state.selection.main
    if (sel.empty) {
      setChip(null)
      return
    }
    const c = update.view.coordsAtPos(sel.to)
    if (!c) {
      setChip(null)
      return
    }
    setChip({
      coords: clampToViewport({ left: c.left, right: c.right, top: c.top, bottom: c.bottom }),
      from: sel.from,
      to: sel.to,
      view: update.view,
    })
  }, [])

  // Reposition the chip when the editor scrolls or the viewport resizes
  // (CodeMirror source only — the DOM source re-derives on selectionchange).
  // The chip's coords are viewport-relative, so the doc offsets stay stable but
  // the screen position drifts as the user scrolls. rAF-throttle so a burst of
  // wheel events collapses into one re-measure. Hidden editors don't repaint
  // and must not attach window-level (resize) listeners.
  const chipTo = chip?.to ?? null
  useEffect(() => {
    if (kind !== 'codemirror' || !isActive || chipTo === null || !cmViewRef) return
    const view = cmViewRef.current
    if (!view) return
    let frame = 0
    const reposition = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const liveView = cmViewRef.current
        if (!liveView) return
        const c = liveView.coordsAtPos(chipTo)
        if (!c) {
          setChip(null)
          return
        }
        setChip((prev) =>
          prev
            ? {
                ...prev,
                coords: clampToViewport({
                  left: c.left,
                  right: c.right,
                  top: c.top,
                  bottom: c.bottom,
                }),
              }
            : prev
        )
      })
    }
    const scrollEl = view.scrollDOM
    scrollEl.addEventListener('scroll', reposition, { passive: true })
    window.addEventListener('resize', reposition)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      scrollEl.removeEventListener('scroll', reposition)
      window.removeEventListener('resize', reposition)
    }
  }, [kind, isActive, chipTo, cmViewRef])

  // DOM source: owns a `selectionchange` listener with a ~50ms debounce that
  // keeps the chip steady during drag-to-extend. Picks the last non-empty
  // client rect (trailing edge of the selection's final line); skips zero-width
  // caret rects ProseMirror emits at paragraph boundaries — those collapse to
  // the right edge of the formatting context, pulling the chip far off. A
  // bounding rect would be the union of all lines, placing the chip past the
  // longest line.
  useEffect(() => {
    if (kind !== 'dom' || !onSendSelection || !domContainerRef) return
    let debounceId: number | null = null
    const evaluate = () => {
      debounceId = null
      const root = domContainerRef.current
      if (!root) {
        setChip(null)
        return
      }
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.toString() === '') {
        setChip(null)
        return
      }
      const anchor = sel.anchorNode
      if (!anchor || !root.contains(anchor)) {
        setChip(null)
        return
      }
      const range = sel.getRangeAt(0)
      const rects = range.getClientRects()
      let rect: DOMRect | null = null
      for (let i = rects.length - 1; i >= 0; i--) {
        if (rects[i].width > 0 && rects[i].height > 0) {
          rect = rects[i]
          break
        }
      }
      if (!rect) rect = range.getBoundingClientRect()
      setChip({
        coords: clampToViewport({
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        }),
      })
    }
    const onSelectionChange = () => {
      if (debounceId !== null) window.clearTimeout(debounceId)
      debounceId = window.setTimeout(evaluate, 50)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      if (debounceId !== null) window.clearTimeout(debounceId)
    }
  }, [kind, onSendSelection, domContainerRef])

  // Shared click-to-send tail. Text + line range are resolved per source, then
  // both flow through the same prefix builder and formatter.
  const handleChipClick = useCallback(() => {
    if (!onSendSelection) return
    if (kind === 'codemirror') {
      const view = chip?.view
      if (!view || !chip || chip.from === undefined || chip.to === undefined) return
      const text = view.state.sliceDoc(chip.from, chip.to)
      const formatted = formatSelectionForAgent(text, agentKind)
      if (formatted === '') return
      const startLine = view.state.doc.lineAt(chip.from).number
      const endLine = view.state.doc.lineAt(chip.to).number
      const range = startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`
      onSendSelection(`${buildSelectionPrefix(filePath, range, agentKind)}\n\n${formatted}`)
    } else {
      const text = window.getSelection()?.toString()
      if (!text) return
      const formatted = formatSelectionForAgent(text, agentKind)
      if (formatted === '') return
      const range = findSelectionLineRange(text, body)
      onSendSelection(`${buildSelectionPrefix(filePath, range, agentKind)}\n\n${formatted}`)
    }
  }, [kind, onSendSelection, agentKind, filePath, body, chip])

  return { chip, handleChipClick, onCmSelectionChange }
}
