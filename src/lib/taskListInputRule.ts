import { bulletListSchema, listItemSchema } from '@milkdown/preset-commonmark'
import { InputRule } from '@milkdown/prose/inputrules'
import { findWrapping } from '@milkdown/prose/transform'
import { $inputRule } from '@milkdown/utils'

/**
 * Auto-convert a bare `[ ] ` / `[x] ` typed at the START of a plain paragraph
 * into a GFM task list item (issue #437, AC-B).
 *
 * The gfm `wrapInTaskListInputRule` only fires when the cursor is ALREADY
 * inside a `list_item` (it walks up the tree and bails if there is none), so
 * typing the brackets on an empty line never converts. This rule covers that
 * gap: it wraps the paragraph in `bullet_list > list_item` with the `checked`
 * attr set (false for a space, true for `x`), so it serializes to the standard
 * `- [ ]` / `- [x]` markdown — never literal brackets.
 *
 * Guards: do nothing if the cursor is already inside a `list_item` (gfm owns
 * that case) or if there is text before the brackets — `^` anchors the match
 * to the textblock start, and we additionally require the paragraph to be the
 * wrappable block.
 */
export const taskListBracketInputRule = $inputRule((ctx) => {
  const bulletList = bulletListSchema.type(ctx)
  const listItem = listItemSchema.type(ctx)

  return new InputRule(/^\[(?<checked>\s|x)\]\s$/, (state, match, start, end) => {
    const $start = state.doc.resolve(start)

    // Already inside a list item → let gfm's wrapInTaskListInputRule handle it.
    for (let depth = $start.depth; depth > 0; depth--) {
      if ($start.node(depth).type === listItem) return null
    }

    // Only convert a plain paragraph whose text starts with the brackets.
    const range = $start.blockRange()
    if (!range) return null

    const checked = match.groups?.checked === 'x'
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
