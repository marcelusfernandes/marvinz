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
            decorations.push(
              Decoration.inline(r.from, r.to, { class: 'pm-just-inserted' }),
            )
            // Find inline atom nodes (images, hard breaks) inside the range
            // and emit node decorations so custom node views can mirror the
            // class onto their wrapper element. `descendants` traverses
            // both block-level and inline nodes; we filter to atoms within
            // the highlight range.
            tr.doc.descendants((node, p) => {
              if (p >= r.to) return false
              if (p + node.nodeSize <= r.from) return false
              if (node.isAtom && node.isInline) {
                decorations.push(
                  Decoration.node(p, p + node.nodeSize, { class: 'pm-just-inserted' }),
                )
                return false
              }
              return true
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
