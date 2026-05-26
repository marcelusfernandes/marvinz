import { type EditorState, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'

/**
 * Shape passed to {@link mentionTrigger} consumers.
 *
 * - `onOpen` fires once when a freshly inserted `@` lands in a valid trigger
 *   position. `from` is the document offset of the `@` itself; `anchor`
 *   is viewport coords (`view.coordsAtPos(from + 1)` — i.e. just after the
 *   `@`) so the picker pops up next to the caret rather than on top of the
 *   sigil.
 * - `onUpdate` fires every time the query text changes while the trigger
 *   stays active. Includes a fresh `anchor` because the caret moves as the
 *   user types and the picker should follow it. (Some hosts may choose to
 *   pin to the original `@` anchor — they can ignore this field.)
 * - `onClose` fires when the trigger deactivates: backspacing the `@`,
 *   moving the caret out of the query range, or inserting whitespace.
 */
export type MentionTriggerCallbacks = {
  onOpen: (from: number, anchor: { x: number; y: number }) => void
  onUpdate: (query: string, anchor: { x: number; y: number }) => void
  onClose: () => void
}

type TriggerState =
  | { active: false }
  | { active: true; from: number; query: string }

const INACTIVE: TriggerState = { active: false }

/**
 * `@` is a valid trigger when the preceding character is whitespace, a
 * newline, or there is no preceding character (start of document). This
 * prevents firing for tokens like `user@example.com` mid-word.
 */
function isValidTriggerPosition(state: EditorState, pos: number): boolean {
  if (pos === 0) return true
  const prev = state.doc.sliceString(pos - 1, pos)
  if (!/\s/.test(prev)) return false
  // URL gating: if the preceding non-whitespace run contains `://`, the
  // user is mid-URL (e.g. `https://example.com/@handle`) and we suppress
  // the trigger. We only inspect the previous ~30 chars and stop at any
  // whitespace, so this stays an O(1) look-back regardless of doc size.
  const start = Math.max(0, pos - 31)
  const lookBack = state.doc.sliceString(start, pos - 1)
  const lastWs = Math.max(
    lookBack.lastIndexOf(' '),
    lookBack.lastIndexOf('\t'),
    lookBack.lastIndexOf('\n'),
  )
  const run = lastWs >= 0 ? lookBack.slice(lastWs + 1) : lookBack
  if (run.includes('://')) return false
  return true
}

/**
 * Returns true when `pos` falls inside an `InlineCode`, `FencedCode`, or
 * `CodeBlock` node. The markdown lezer parser exposes those exact names;
 * for non-markdown buffers the parser tree doesn't carry those types and
 * we fall through to `false`.
 */
function isInsideCode(state: EditorState, pos: number): boolean {
  let node: { name: string; parent: typeof node | null } | null = syntaxTree(
    state,
  ).resolveInner(pos, -1) as unknown as typeof node
  while (node) {
    if (
      node.name === 'InlineCode' ||
      node.name === 'FencedCode' ||
      node.name === 'CodeBlock'
    ) {
      return true
    }
    node = node.parent
  }
  return false
}

function readQuery(state: EditorState, from: number): string | null {
  const head = state.selection.main.head
  if (head < from + 1) return null
  const text = state.doc.sliceString(from + 1, head)
  // Whitespace closes the trigger — bail before reporting the query.
  if (/\s/.test(text)) return null
  return text
}

function anchorAt(view: EditorView, pos: number): { x: number; y: number } {
  const rect = view.coordsAtPos(pos)
  if (!rect) return { x: 0, y: 0 }
  return { x: rect.left, y: rect.bottom }
}

/**
 * CodeMirror extension that watches for `@`-mention triggers and emits
 * lifecycle callbacks. It does not render any UI — the caller is expected
 * to mount a picker in response to `onOpen`/`onUpdate` and tear it down on
 * `onClose`.
 *
 * Trigger rules:
 *  - Activates when the user types `@` and the character before it is
 *    whitespace or the start of the document.
 *  - Suppresses inside inline code (`` `…` ``) and code blocks (fenced or
 *    indented), detected via the markdown lezer parser tree.
 *  - Tracks the query as text typed after `@`; deactivates when the
 *    caret leaves that range, when the `@` is deleted, or when whitespace
 *    enters the query.
 *
 * @example
 * mentionTrigger({
 *   onOpen: (from, anchor) => setPicker({ from, query: '', anchor }),
 *   onUpdate: (query, anchor) => setPicker((p) => p && { ...p, query, anchor }),
 *   onClose: () => setPicker(null),
 * })
 */
export function mentionTrigger(callbacks: MentionTriggerCallbacks): Extension {
  return ViewPlugin.define((view) => {
    let trigger: TriggerState = INACTIVE

    function close() {
      if (trigger.active) {
        trigger = INACTIVE
        callbacks.onClose()
      }
    }

    function detectOpen(update: ViewUpdate): boolean {
      // Look for an `@` insertion in this transaction's changes. We scan
      // every range; in practice there's usually one but multi-cursor edits
      // can produce several — we take the first valid one.
      let opened = false
      update.changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
        if (opened) return
        const text = inserted.toString()
        const atIdx = text.indexOf('@')
        if (atIdx === -1) return
        const atPos = fromB + atIdx
        const state = update.state
        if (!isValidTriggerPosition(state, atPos)) return
        if (isInsideCode(state, atPos)) return
        // Activate. The query is whatever follows `@` up to the caret;
        // typically empty on first keystroke but multi-char paste of
        // "@foo" should still register "foo".
        const head = state.selection.main.head
        if (head < atPos + 1) return
        const tail = state.doc.sliceString(atPos + 1, head)
        if (/\s/.test(tail)) return
        trigger = { active: true, from: atPos, query: tail }
        callbacks.onOpen(atPos, anchorAt(view, atPos + 1))
        if (tail.length > 0) callbacks.onUpdate(tail, anchorAt(view, head))
        opened = true
      })
      return opened
    }

    return {
      update(update: ViewUpdate) {
        if (!update.docChanged && !update.selectionSet) return

        if (!trigger.active) {
          detectOpen(update)
          return
        }

        // Trigger is active — re-validate its state against the new doc.
        const state = update.state
        const from = trigger.from
        // The `@` must still be at `from`.
        if (from >= state.doc.length || state.doc.sliceString(from, from + 1) !== '@') {
          close()
          // It's possible the deletion/replacement re-introduced an `@`
          // elsewhere in this same transaction — try to detect that.
          if (update.docChanged) detectOpen(update)
          return
        }
        // Code-block status can change if the user wraps the trigger in
        // a fence; close in that case too.
        if (isInsideCode(state, from)) {
          close()
          return
        }
        const query = readQuery(state, from)
        if (query === null) {
          close()
          return
        }
        if (query !== trigger.query) {
          trigger = { active: true, from, query }
          callbacks.onUpdate(query, anchorAt(view, state.selection.main.head))
        }
      },
      destroy() {
        if (trigger.active) {
          trigger = INACTIVE
          callbacks.onClose()
        }
      },
    }
  })
}
