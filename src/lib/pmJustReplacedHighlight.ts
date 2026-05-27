import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

export type JustReplacedMeta =
  | { type: 'add'; ranges: Array<{ from: number; to: number }> }
  | { type: 'clear' }

export const justReplacedPluginKey = new PluginKey<DecorationSet>('marvinz-just-replaced')

/**
 * ProseMirror plugin that keeps a transient set of decorations marking
 * recently-replaced ranges. Dispatch a transaction with
 * `tr.setMeta(justReplacedPluginKey, { type: 'add', from, to })` (positions
 * in the post-replace document) to flash the range; the visible "flash" is
 * a CSS animation on `.pm-just-replaced` with `animation-fill-mode:
 * forwards`. `{ type: 'clear' }` empties the set when the find bar closes.
 */
export function justReplacedPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: justReplacedPluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const next = set.map(tr.mapping, tr.doc)
        const meta = tr.getMeta(justReplacedPluginKey) as JustReplacedMeta | undefined
        if (!meta) return next
        if (meta.type === 'add') {
          return next.add(
            tr.doc,
            meta.ranges.map((r) =>
              Decoration.inline(r.from, r.to, { class: 'pm-just-replaced' }),
            ),
          )
        }
        if (meta.type === 'clear') return DecorationSet.empty
        return next
      },
    },
    props: {
      decorations(state) {
        return justReplacedPluginKey.getState(state)
      },
    },
  })
}
