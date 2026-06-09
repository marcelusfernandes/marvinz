import { bulletListSchema, listItemSchema } from '@milkdown/preset-commonmark'
import { InputRule } from '@milkdown/prose/inputrules'
import { findWrapping } from '@milkdown/prose/transform'
import { $inputRule } from '@milkdown/utils'

/**
 * Auto-convert a bare `[ ] ` / `[x] ` typed at the START of a line into a GFM
 * task list item (issue #437, AC-B), covering the cases gfm's own rule misses.
 *
 * The gfm `wrapInTaskListInputRule` only fires inside a `list_item` whose
 * `checked` attr is still null (a plain bullet); it bails on a bare paragraph
 * and on an item that is ALREADY a task. This rule fills both gaps:
 *
 *  - Plain paragraph → wrap in `bullet_list > list_item` with `checked` set, so
 *    it serializes to standard `- [ ]` / `- [x]` markdown (never literal
 *    brackets).
 *  - Already inside a task item (`checked != null`, e.g. a fresh item created
 *    by pressing Enter from another task) → consume the brackets and set the
 *    item's `checked` instead of leaving literal `[x] ` text (issue #439).
 *  - Plain (non-task) list item (`checked == null`) → defer to gfm's rule.
 *
 * `^` anchors the match to the textblock start, so text before the brackets
 * never triggers a conversion.
 */
export const taskListBracketInputRule = $inputRule((ctx) => {
  const bulletList = bulletListSchema.type(ctx)
  const listItem = listItemSchema.type(ctx)

  return new InputRule(/^\[(?<checked>\s|x)\]\s$/, (state, match, start, end) => {
    const $start = state.doc.resolve(start)
    const checked = match.groups?.checked === 'x'

    // Inside a list item: a non-task item is gfm's to convert; a task item
    // would otherwise leave the brackets literal, so set its checked here.
    for (let depth = $start.depth; depth > 0; depth--) {
      const node = $start.node(depth)
      if (node.type === listItem) {
        if (node.attrs.checked == null) return null
        return state.tr
          .deleteRange(start, end)
          .setNodeMarkup($start.before(depth), undefined, {
            ...node.attrs,
            checked,
          })
      }
    }

    // Plain paragraph: wrap into a bullet_list > list_item task.
    const range = $start.blockRange()
    if (!range) return null

    const wrappers = [
      { type: bulletList },
      { type: listItem, attrs: { checked } },
    ]
    // Validate the wrapping is allowed at this range before mutating.
    if (!findWrapping(range, bulletList)) return null

    const tr = state.tr.deleteRange(start, end)
    const wrapRange = tr.doc.resolve(tr.mapping.map(start)).blockRange()
    if (!wrapRange) return null
    tr.wrap(wrapRange, wrappers)
    return tr
  })
})
