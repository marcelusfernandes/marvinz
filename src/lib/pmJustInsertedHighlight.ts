import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

export type JustInsertedMeta =
  | { type: 'add'; ranges: Array<{ from: number; to: number }> }
  | { type: 'clear' }

export const justInsertedPluginKey = new PluginKey<DecorationSet>('marvinz-just-inserted')

/**
 * Transient decoration applied to a range just inserted via drag-drop. The
 * CSS class `pm-just-inserted` carries a one-shot `scale + fade` animation
 * (`animation-fill-mode: forwards`). The decoration is cleared after the
 * animation so highlights don't accumulate over repeated drops.
 */
export function justInsertedPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: justInsertedPluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const next = set.map(tr.mapping, tr.doc)
        const meta = tr.getMeta(justInsertedPluginKey) as JustInsertedMeta | undefined
        if (!meta) return next
        if (meta.type === 'add') {
          const decorations: Decoration[] = []
          for (const r of meta.ranges) {
            // Always add the inline decoration — works for text spans.
            decorations.push(
              Decoration.inline(r.from, r.to, { class: 'pm-just-inserted' }),
            )
            // Also add a node decoration on any atom inline node in the
            // range (images): inline decorations don't reliably style atoms
            // whose custom node view owns the DOM.
            tr.doc.nodesBetween(r.from, r.to, (node, p) => {
              if (node.isAtom && node.isInline) {
                decorations.push(
                  Decoration.node(p, p + node.nodeSize, { class: 'pm-just-inserted' }),
                )
              }
              return undefined
            })
          }
          return next.add(tr.doc, decorations)
        }
        if (meta.type === 'clear') return DecorationSet.empty
        return next
      },
    },
    props: {
      decorations(state) {
        return justInsertedPluginKey.getState(state)
      },
    },
  })
}
