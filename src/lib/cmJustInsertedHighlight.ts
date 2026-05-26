import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'

/** Dispatch with an array of `{ from, to }` ranges (post-insert coordinates)
 * to flash the freshly-dropped content with the entrance animation. */
export const flashInserted = StateEffect.define<Array<{ from: number; to: number }>>()
/** Clears every accumulated entrance decoration. Dispatched on a short
 * timeout after the animation finishes so the StateField doesn't accumulate
 * decorations across multiple drops in the same session. */
export const clearInsertedFlashes = StateEffect.define<null>()

const flashMark = Decoration.mark({ class: 'cm-just-inserted' })

/**
 * Transient decoration set for the drag-drop entrance animation in the
 * source editor. CSS class `cm-just-inserted` carries a one-shot
 * `scale + fade` animation; the field holds the decorations during the
 * animation and gets cleared by a follow-up timer in the drop handler.
 */
export const justInsertedField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(flashInserted)) {
        value = value.update({
          add: e.value.map((r) => flashMark.range(r.from, r.to)),
          sort: true,
        })
      }
      if (e.is(clearInsertedFlashes)) {
        value = Decoration.none
      }
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f),
})
