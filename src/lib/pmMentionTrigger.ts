import { Plugin, PluginKey } from 'prosemirror-state'
import type { EditorState, Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { ReplaceStep } from 'prosemirror-transform'

/**
 * Shape passed to {@link mentionTrigger} consumers — mirrors the contract of
 * the CodeMirror sibling extension (`src/lib/cmMentionTrigger.ts`) so the
 * picker host can be surface-agnostic.
 *
 * - `onOpen` fires once when a freshly inserted `@` lands in a valid trigger
 *   position. `from` is the document offset of the `@` itself; `anchor` is
 *   viewport coords (`view.coordsAtPos(from + 1)` — i.e. just after the
 *   `@`) so the picker pops up next to the caret rather than on top of the
 *   sigil.
 * - `onUpdate` fires every time the query text changes while the trigger
 *   stays active. Includes a fresh `anchor` because the caret moves as the
 *   user types and the picker should follow it.
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

export const mentionTriggerKey = new PluginKey<TriggerState>('marvinz-mention-trigger')

/**
 * `@` is a valid trigger when the preceding character is whitespace, a
 * newline, or there is no preceding character (start of a textblock). This
 * prevents firing for tokens like `user@example.com` mid-word.
 */
function isValidTriggerPosition(state: EditorState, pos: number): boolean {
  const $pos = state.doc.resolve(pos)
  // Start of the parent textblock — no preceding char in this block.
  if ($pos.parentOffset === 0) return true
  const prev = state.doc.textBetween(pos - 1, pos, '\n', '\n')
  if (!/\s/.test(prev)) return false
  // URL gating: if the preceding non-whitespace run contains `://`, the
  // user is mid-URL (e.g. `https://example.com/@handle`) and we suppress
  // the trigger. We only inspect the previous ~30 chars and stop at any
  // whitespace, so this stays an O(1) look-back regardless of doc size.
  const start = Math.max(0, pos - 31)
  const lookBack = state.doc.textBetween(start, pos - 1, '\n', '\n')
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
 * Returns true when `pos` falls inside a `code_block` node or inside an
 * `inlineCode` mark range. Mirrors the CodeMirror extension's code-gating
 * heuristic against the Milkdown commonmark schema (node `code_block`, mark
 * `inlineCode`).
 */
function isInsideCode(state: EditorState, pos: number): boolean {
  const $pos = state.doc.resolve(pos)
  if ($pos.parent.type.name === 'code_block') return true
  const codeMark = state.schema.marks.inlineCode
  if (!codeMark) return false
  // marks() returns the marks at the current cursor position, factoring in
  // the marks of the surrounding text. Use it instead of $pos.parent because
  // an inline mark range can span multiple text nodes within one paragraph.
  return Boolean(codeMark.isInSet($pos.marks()))
}

function readQuery(state: EditorState, from: number): string | null {
  const head = state.selection.from
  if (head < from + 1) return null
  const text = state.doc.textBetween(from + 1, head, '\n', '\n')
  // Whitespace closes the trigger — bail before reporting the query.
  if (/\s/.test(text)) return null
  return text
}

function anchorAt(view: EditorView, pos: number): { x: number; y: number } {
  try {
    const rect = view.coordsAtPos(pos)
    return { x: rect.left, y: rect.bottom }
  } catch {
    return { x: 0, y: 0 }
  }
}

/**
 * Scan a transaction's steps for an inserted `@` and return its position in
 * the *final* doc, or `null` if no such insertion exists. Multi-cursor edits
 * may produce multiple matches — we take the first valid one.
 *
 * Each step's `from` is in the doc-frame *before* that step ran, so we map
 * the candidate position forward through the remaining steps' maps to land
 * in the final doc-frame.
 */
function findInsertedAt(tr: Transaction): number | null {
  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i]
    if (!(step instanceof ReplaceStep)) continue
    const slice = step.slice
    if (slice.size === 0) continue
    const inserted = slice.content.textBetween(0, slice.content.size, '\n', '\n')
    const atIdx = inserted.indexOf('@')
    if (atIdx === -1) continue
    // Position in the doc-frame *after* step `i`. ReplaceStep inserts `slice`
    // starting at `step.from` in the post-step doc.
    const posAfterStep = step.from + atIdx
    // Carry through any subsequent steps' maps to the final doc.
    const restMapping = tr.mapping.slice(i + 1)
    return restMapping.map(posAfterStep, 1)
  }
  return null
}

/**
 * ProseMirror plugin that watches for `@`-mention triggers and emits
 * lifecycle callbacks. It does not render any UI — the caller is expected
 * to mount a picker in response to `onOpen`/`onUpdate` and tear it down on
 * `onClose`.
 *
 * Trigger rules:
 *  - Activates when the user types `@` and the character before it is
 *    whitespace or the start of the surrounding textblock.
 *  - Suppresses inside inline code (`inlineCode` mark) and code blocks
 *    (`code_block` node) detected against the Milkdown commonmark schema.
 *  - Tracks the query as text typed after `@`; deactivates when the
 *    caret leaves that range, when the `@` is deleted, or when whitespace
 *    enters the query.
 *
 * The plugin keeps its `TriggerState` in `state.apply` (pure) and fires the
 * `onOpen` / `onUpdate` / `onClose` side effects from a `view`-level effect
 * that diffs the previous and current plugin state on every transaction.
 *
 * @example
 * mentionTrigger({
 *   onOpen: (from, anchor) => setPicker({ from, query: '', anchor }),
 *   onUpdate: (query, anchor) => setPicker((p) => p && { ...p, query, anchor }),
 *   onClose: () => setPicker(null),
 * })
 */
export function mentionTrigger(callbacks: MentionTriggerCallbacks): Plugin<TriggerState> {
  return new Plugin<TriggerState>({
    key: mentionTriggerKey,
    state: {
      init: () => INACTIVE,
      apply(tr, prev, _oldState, newState) {
        // Fast path: no doc/selection change → state stays put.
        if (!tr.docChanged && !tr.selectionSet) return prev

        if (prev.active) {
          // Remap the `@` position through this transaction's mapping. If the
          // mapping deletes the position (deleted: true), the `@` was wiped
          // and the trigger must close — try to detect a fresh `@` insertion
          // in the same transaction below.
          const mapped = tr.mapping.mapResult(prev.from, 1)
          if (!mapped.deleted) {
            const from = mapped.pos
            const at = newState.doc.textBetween(from, from + 1, '\n', '\n')
            if (at === '@' && !isInsideCode(newState, from)) {
              const query = readQuery(newState, from)
              if (query !== null) {
                if (query === prev.query && from === prev.from) return prev
                return { active: true, from, query }
              }
            }
          }
          // Trigger broke — fall through to detect a new one in the same tx.
        }

        // Look for a freshly inserted `@` in a valid position.
        if (tr.docChanged) {
          const atPos = findInsertedAt(tr)
          if (atPos !== null) {
            if (
              isValidTriggerPosition(newState, atPos) &&
              !isInsideCode(newState, atPos)
            ) {
              const head = newState.selection.from
              if (head >= atPos + 1) {
                const tail = newState.doc.textBetween(atPos + 1, head, '\n', '\n')
                if (!/\s/.test(tail)) {
                  return { active: true, from: atPos, query: tail }
                }
              }
            }
          }
        }
        return INACTIVE
      },
    },
    view: (_view) => {
      let prev: TriggerState = INACTIVE
      return {
        update(view, _prevEditorState) {
          const next = mentionTriggerKey.getState(view.state) ?? INACTIVE
          if (!prev.active && next.active) {
            callbacks.onOpen(next.from, anchorAt(view, next.from + 1))
            if (next.query.length > 0) {
              callbacks.onUpdate(next.query, anchorAt(view, view.state.selection.from))
            }
          } else if (prev.active && next.active) {
            if (prev.query !== next.query || prev.from !== next.from) {
              callbacks.onUpdate(next.query, anchorAt(view, view.state.selection.from))
            }
          } else if (prev.active && !next.active) {
            callbacks.onClose()
          }
          prev = next
        },
        destroy() {
          if (prev.active) {
            prev = INACTIVE
            callbacks.onClose()
          }
        },
      }
    },
  })
}
