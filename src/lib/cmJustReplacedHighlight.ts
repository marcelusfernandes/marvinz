import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'

/** Dispatch with an array of `{ from, to }` ranges in the POST-replace
 * document coordinates to flash each just-written range with the success
 * highlight. Carrying ranges in batch (instead of one effect per range)
 * lets Replace All flash N matches via a single dispatch. */
export const flashReplaced = StateEffect.define<Array<{ from: number; to: number }>>()
/** Clears every accumulated flash decoration. Dispatched when the find bar
 * unmounts so the StateField doesn't grow unbounded across a long session. */
export const clearReplacedFlashes = StateEffect.define<null>()

const flashMark = Decoration.mark({ class: 'cm-just-replaced' })

/**
 * Holds a transient decoration set of recently-replaced ranges. Each entry
 * stays in the set until `clearReplacedFlashes` fires; the visible "flash"
 * effect comes from a CSS animation with `animation-fill-mode: forwards`,
 * which fades the highlight to fully transparent and keeps it there. Doc
 * edits remap positions automatically via `value.map(tr.changes)`.
 */
export const justReplacedField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(flashReplaced)) {
        // `sort: true` because Replace All ranges arrive in document order
        // and existing decorations are already sorted, but the safer
        // contract for downstream `update` calls is to let CM normalize.
        value = value.update({
          add: e.value.map((r) => flashMark.range(r.from, r.to)),
          sort: true,
        })
      }
      if (e.is(clearReplacedFlashes)) {
        value = Decoration.none
      }
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f),
})
