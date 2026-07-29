import { setBlockType, toggleMark, wrapIn } from '@milkdown/prose/commands'
import { wrapInList } from '@milkdown/prose/schema-list'
import { findWrapping } from '@milkdown/prose/transform'
import type { Command, EditorState } from '@milkdown/prose/state'

/**
 * Command layer for the Rendered-mode formatting toolbar (#636).
 *
 * Pure derivation over an `EditorState` — no React, no DOM — so the semantics
 * can be tested against real ProseMirror transactions. Lives apart from the
 * component so the `.tsx` exports a component only (react-refresh).
 *
 * Commands come from `@milkdown/prose/*` subpaths; that package is already a
 * dependency, so nothing is added to package.json. Node and mark names are
 * Milkdown's commonmark + gfm schema names — anything absent from the live
 * schema yields `null` and disables its button rather than throwing.
 */

export type ToolbarItem =
  | { kind: 'mark'; id: string; label: string; title: string; mark: string }
  | { kind: 'link'; id: string; label: string; title: string }
  | { kind: 'block'; id: string; label: string; title: string; node: string; level?: number }
  | { kind: 'wrap'; id: string; label: string; title: string; node: string }
  | { kind: 'list'; id: string; label: string; title: string; node: string }
  | { kind: 'insert'; id: string; label: string; title: string; node: string }
  | { kind: 'task'; id: string; label: string; title: string }
  | { kind: 'separator'; id: string }

export type ToolbarButton = Exclude<ToolbarItem, { kind: 'separator' }>

export const ITEMS: ToolbarItem[] = [
  { kind: 'mark', id: 'strong', label: 'B', title: 'Bold', mark: 'strong' },
  { kind: 'mark', id: 'emphasis', label: 'I', title: 'Italic', mark: 'emphasis' },
  { kind: 'mark', id: 'strike', label: 'S', title: 'Strikethrough', mark: 'strike_through' },
  { kind: 'mark', id: 'code', label: '</>', title: 'Inline code', mark: 'inlineCode' },
  { kind: 'link', id: 'link', label: '🔗', title: 'Link' },
  { kind: 'separator', id: 'sep-inline' },
  { kind: 'block', id: 'h1', label: 'H1', title: 'Heading 1', node: 'heading', level: 1 },
  { kind: 'block', id: 'h2', label: 'H2', title: 'Heading 2', node: 'heading', level: 2 },
  { kind: 'block', id: 'h3', label: 'H3', title: 'Heading 3', node: 'heading', level: 3 },
  { kind: 'block', id: 'paragraph', label: '¶', title: 'Paragraph', node: 'paragraph' },
  { kind: 'separator', id: 'sep-block' },
  { kind: 'list', id: 'bullet_list', label: '•—', title: 'Bullet list', node: 'bullet_list' },
  { kind: 'list', id: 'ordered_list', label: '1.', title: 'Ordered list', node: 'ordered_list' },
  { kind: 'wrap', id: 'blockquote', label: '❝', title: 'Quote', node: 'blockquote' },
  { kind: 'separator', id: 'sep-insert' },
  { kind: 'insert', id: 'hr', label: '—', title: 'Horizontal rule', node: 'hr' },
  { kind: 'task', id: 'task', label: '☑', title: 'Task list' },
]

/**
 * True when the mark covers the selection in the sense `toggleMark` uses.
 *
 * `toggleMark` defaults to `removeWhenPresent`, deciding
 * `add = !ranges.some(rangeHasMark)` — so a half-marked selection is REMOVED
 * from end to end on click. Reporting such a selection as active is therefore
 * the honest prediction of what pressing the button does, not an approximation.
 * An empty selection reads stored marks instead, matching the next keystroke.
 */
export function isMarkActive(state: EditorState, name: string): boolean {
  const type = state.schema.marks[name]
  if (!type) return false
  const { from, to, empty, $from } = state.selection
  if (empty) return Boolean(type.isInSet(state.storedMarks || $from.marks()))
  return state.doc.rangeHasMark(from, to, type)
}

/**
 * The block type shared by EVERY textblock in the selection, or null when the
 * selection spans mixed types. Lighting "H2" while the selection also covers a
 * paragraph would misreport what the button is about to do.
 */
export function uniformBlock(state: EditorState): { name: string; level?: number } | null {
  const { from, to } = state.selection
  const blocks: { name: string; level?: number }[] = []
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isTextblock) return
    blocks.push({ name: node.type.name, level: node.attrs.level as number | undefined })
  })
  const first = blocks[0]
  if (!first) return null
  const uniform = blocks.every((b) => b.name === first.name && b.level === first.level)
  return uniform ? first : null
}

/** Walks the ancestor chain for a wrapping node (list, blockquote). */
function ancestorNamed(state: EditorState, name: string) {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name === name) return node
  }
  return null
}

export function isItemActive(state: EditorState, item: ToolbarItem): boolean {
  switch (item.kind) {
    case 'mark':
      return isMarkActive(state, item.mark)
    case 'link':
      return isMarkActive(state, 'link')
    case 'block': {
      const block = uniformBlock(state)
      return block?.name === item.node && block.level === item.level
    }
    case 'list':
    case 'wrap':
      // Lists and blockquote wrap the textblock instead of replacing it, so the
      // ancestor chain is what says whether we are already inside one.
      return ancestorNamed(state, item.node) !== null
    case 'task': {
      // A task item is a list_item carrying a non-null `checked` attr — the
      // representation gfm's list_item extension uses and taskListNodeView reads.
      const listItem = ancestorNamed(state, 'list_item')
      return listItem !== null && listItem.attrs.checked != null
    }
    default:
      // Insertions have no "current" state to reflect.
      return false
  }
}

type Schema = EditorState['schema']

function linkCommand(schema: Schema, active: boolean, href: string | undefined): Command | null {
  const type = schema.marks.link
  if (!type) return null
  // Removing needs no attrs. Adding needs a href, which only the dialog can
  // supply — callers without one still get a valid command so the applicability
  // check works; the component intercepts the add path.
  return active ? toggleMark(type) : toggleMark(type, { href: href ?? '' })
}

function blockCommand(
  schema: Schema,
  item: Extract<ToolbarItem, { kind: 'block' }>,
  active: boolean
): Command | null {
  // Clicking the already-active heading returns to paragraph, mirroring the
  // preset's own wrapInHeadingCommand(0).
  const type = active ? schema.nodes.paragraph : schema.nodes[item.node]
  if (!type) return null
  const attrs = !active && item.level !== undefined ? { level: item.level } : undefined
  return setBlockType(type, attrs)
}

function insertCommand(schema: Schema, nodeName: string): Command | null {
  const type = schema.nodes[nodeName]
  if (!type) return null
  return (state, dispatch) => {
    if (dispatch) dispatch(state.tr.replaceSelectionWith(type.create()).scrollIntoView())
    return true
  }
}

function taskCommand(schema: Schema): Command | null {
  const list = schema.nodes.bullet_list
  const listItem = schema.nodes.list_item
  if (!list || !listItem) return null
  // Same wrapping taskListInputRule.ts performs for `- [ ] `, so a button press
  // and typing the syntax produce an identical document.
  return (state, dispatch) => {
    const range = state.selection.$from.blockRange()
    if (!range || !findWrapping(range, list)) return false
    if (dispatch) {
      dispatch(
        state.tr.wrap(range, [{ type: list }, { type: listItem, attrs: { checked: false } }])
      )
    }
    return true
  }
}

export function commandFor(
  state: EditorState,
  item: ToolbarItem,
  active: boolean,
  payload?: { href?: string }
): Command | null {
  const { schema } = state
  switch (item.kind) {
    case 'mark': {
      const type = schema.marks[item.mark]
      return type ? toggleMark(type) : null
    }
    case 'link':
      return linkCommand(schema, active, payload?.href)
    case 'block':
      return blockCommand(schema, item, active)
    case 'wrap': {
      const type = schema.nodes[item.node]
      return type ? wrapIn(type) : null
    }
    case 'list': {
      const type = schema.nodes[item.node]
      return type ? wrapInList(type) : null
    }
    case 'insert':
      return insertCommand(schema, item.node)
    case 'task':
      return taskCommand(schema)
    default:
      return null
  }
}

/**
 * Block-level actions apply to the whole block, not just the selected text —
 * say so where the user looks, so a half-sentence selection is no surprise.
 */
export function titleFor(item: ToolbarButton): string {
  const isBlockLevel = item.kind === 'block' || item.kind === 'list' || item.kind === 'wrap'
  return isBlockLevel ? `${item.title} — applies to the whole block` : item.title
}
