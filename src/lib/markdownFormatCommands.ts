import { lift, setBlockType, toggleMark, wrapIn } from '@milkdown/prose/commands'
import { liftListItem, wrapInList } from '@milkdown/prose/schema-list'
import { Selection, type Command, type EditorState } from '@milkdown/prose/state'

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
  | { kind: 'code'; id: string; label: string; title: string }
  | { kind: 'link'; id: string; label: string; title: string }
  | { kind: 'block'; id: string; label: string; title: string; node: string; level?: number }
  | { kind: 'wrap'; id: string; label: string; title: string; node: string }
  | { kind: 'list'; id: string; label: string; title: string; node: string }
  | { kind: 'insert'; id: string; label: string; title: string; node: string }
  | { kind: 'task'; id: string; label: string; title: string }
  | { kind: 'separator'; id: string }

export type ToolbarButton = Exclude<ToolbarItem, { kind: 'separator' }>

/** Kinds that represent a state you can turn off, so `aria-pressed` applies. */
export function isToggleKind(item: ToolbarButton): boolean {
  return item.kind !== 'insert'
}

export const ITEMS: ToolbarItem[] = [
  { kind: 'mark', id: 'strong', label: 'B', title: 'Bold', mark: 'strong' },
  { kind: 'mark', id: 'emphasis', label: 'I', title: 'Italic', mark: 'emphasis' },
  { kind: 'mark', id: 'strike', label: 'S', title: 'Strikethrough', mark: 'strike_through' },
  { kind: 'code', id: 'code', label: '</>', title: 'Inline code' },
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

/** Nearest ancestor with the given name, plus its depth. */
function ancestorNamed(state: EditorState, name: string) {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name === name) return { node, depth }
  }
  return null
}

/**
 * Nearest enclosing list, whichever type it is. Matching on a single name would
 * light both buttons for an ordered list nested inside a bullet list.
 */
function nearestList(state: EditorState) {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list') {
      return { node, depth }
    }
  }
  return null
}

/**
 * Whether the button should render as pressed.
 *
 * The highlight means one specific thing: **clicking un-applies this format**.
 * So `paragraph` is never active — it is an action ("make this plain"), not a
 * state, and `setBlockType(paragraph)` on a paragraph is a no-op. Reporting it
 * pressed produced a permanently lit-and-disabled button.
 */
export function isItemActive(state: EditorState, item: ToolbarItem): boolean {
  switch (item.kind) {
    case 'mark':
      return isMarkActive(state, item.mark)
    case 'code':
      return isMarkActive(state, 'inlineCode')
    case 'link':
      return isMarkActive(state, 'link')
    case 'block': {
      if (item.node === 'paragraph') return false
      const block = uniformBlock(state)
      return block?.name === item.node && block.level === item.level
    }
    case 'list':
      return nearestList(state)?.node.type.name === item.node
    case 'wrap':
      return ancestorNamed(state, item.node) !== null
    case 'task': {
      // A task item is a list_item carrying a non-null `checked` attr — the
      // representation gfm's list_item extension uses and taskListNodeView reads.
      const listItem = ancestorNamed(state, 'list_item')
      return listItem !== null && listItem.node.attrs.checked != null
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
  const toggle = active ? toggleMark(type) : toggleMark(type, { href: href ?? '' })
  // A collapsed caret would only write storedMarks: the user completes a modal
  // dialog and nothing appears in the document. Require real text to mark.
  return (state, dispatch, view) => {
    if (state.selection.empty) return false
    return toggle(state, dispatch, view)
  }
}

/**
 * Mirrors `toggleInlineCodeCommand` from preset-commonmark rather than using a
 * bare `toggleMark`: it refuses an empty selection and strips every other mark
 * over the range before adding `inlineCode`. A plain `toggleMark` left
 * `['strong','inlineCode']` where Mod-e leaves `['inlineCode']`, so the button
 * and the shortcut produced different documents.
 */
function inlineCodeCommand(schema: Schema): Command | null {
  const type = schema.marks.inlineCode
  if (!type) return null
  return (state, dispatch) => {
    const { selection, tr } = state
    if (selection.empty) return false
    const { from, to } = selection
    if (state.doc.rangeHasMark(from, to, type)) {
      dispatch?.(tr.removeMark(from, to, type))
      return true
    }
    Object.keys(schema.marks)
      .filter((name) => name !== type.name)
      .forEach((name) => tr.removeMark(from, to, schema.marks[name]))
    dispatch?.(tr.addMark(from, to, type.create()))
    return true
  }
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

/**
 * Insert a leaf block (horizontal rule) and leave the caret in a real textblock
 * AFTER it.
 *
 * `replaceSelectionWith` alone leaves a NodeSelection over the rule, so the
 * user's next keystroke replaces the rule they just inserted — and inserting
 * into an empty paragraph consumed the document's last textblock entirely.
 *
 * preset-commonmark's own `insertHrCommand` fixes the same problem by doing
 * `.insert(from, paragraph)` at the ORIGINAL from, which lands the paragraph
 * *before* the rule. We deliberately deviate and append after instead: you
 * insert a divider in order to keep writing below it. `hr` has no keyboard
 * shortcut, so there is no shortcut parity to preserve here.
 */
function insertCommand(schema: Schema, nodeName: string): Command | null {
  const type = schema.nodes[nodeName]
  const paragraph = schema.nodes.paragraph
  if (!type || !paragraph) return null
  return (state, dispatch) => {
    if (!dispatch) return true
    const tr = state.tr.replaceSelectionWith(type.create())
    const after = tr.selection.to
    tr.insert(after, paragraph.create())
    const selection = Selection.findFrom(tr.doc.resolve(after), 1, true)
    if (selection) tr.setSelection(selection)
    dispatch(tr.scrollIntoView())
    return true
  }
}

/**
 * Task list. Inside an existing `list_item` this flips the item's `checked`
 * attr; only a bare block gets wrapped. Wrapping was the sole path before, and
 * `findWrapping` always rejects it inside a list item (`paragraph block*`
 * cannot start with a `bullet_list`), so the button was dead in a list — the
 * most natural way to reach it. `taskListInputRule.ts` does the same ancestor
 * walk, which is what keeps the button and typing `- [ ] ` in agreement.
 */
function taskCommand(schema: Schema, active: boolean): Command | null {
  const list = schema.nodes.bullet_list
  const listItemType = schema.nodes.list_item
  if (!list || !listItemType) return null
  const wrap = wrapInList(list)

  return (state, dispatch, view) => {
    const { $from } = state.selection

    // Already a list item — flip its `checked` in place. This is the branch
    // `findWrapping` could never satisfy, and the one the input rule also takes.
    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth).type !== listItemType) continue
      const item = $from.node(depth)
      if (dispatch) {
        dispatch(
          state.tr.setNodeMarkup($from.before(depth), undefined, {
            ...item.attrs,
            checked: active ? null : false,
          })
        )
      }
      return true
    }

    // Bare blocks. `wrapInList` (not tr.wrap) so a multi-block selection yields
    // one item per block, matching the bullet button; tr.wrap put all of them
    // inside a single item. Then mark each new item as a task.
    if (!dispatch) return wrap(state)
    return wrap(
      state,
      (tr) => {
        const from = tr.mapping.map(state.selection.from)
        const to = tr.mapping.map(state.selection.to)
        const itemPositions: number[] = []
        tr.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type === listItemType) itemPositions.push(pos)
        })
        // setNodeMarkup preserves node size, so earlier edits never shift the
        // positions collected above.
        for (const pos of itemPositions) {
          const node = tr.doc.nodeAt(pos)
          if (node) tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false })
        }
        dispatch(tr)
      },
      view
    )
  }
}

/**
 * Lists need three behaviours, not one. `wrapInList` alone nested a sublist when
 * the caret was already in a list, and made bullet↔ordered conversion
 * unreachable.
 */
function listCommand(
  schema: Schema,
  item: Extract<ToolbarItem, { kind: 'list' }>,
  active: boolean
): Command | null {
  const target = schema.nodes[item.node]
  const listItemType = schema.nodes.list_item
  if (!target || !listItemType) return null
  return (state, dispatch, view) => {
    const enclosing = nearestList(state)
    if (!enclosing) return wrapInList(target)(state, dispatch, view)
    // Same type → the click means "un-list this".
    if (active) return liftListItem(listItemType)(state, dispatch, view)
    // Different type → retype the list in place. commonmark's
    // syncListOrderPlugin then normalises each item's label and listType.
    if (dispatch) {
      dispatch(state.tr.setNodeMarkup(state.selection.$from.before(enclosing.depth), target))
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
    case 'code':
      return inlineCodeCommand(schema)
    case 'link':
      return linkCommand(schema, active, payload?.href)
    case 'block':
      return blockCommand(schema, item, active)
    case 'wrap': {
      const type = schema.nodes[item.node]
      if (!type) return null
      // Clicking a lit quote button must unwrap, not add a second level —
      // "> quoted" was becoming "> > quoted".
      return active ? lift : wrapIn(type)
    }
    case 'list':
      return listCommand(schema, item, active)
    case 'insert':
      return insertCommand(schema, item.node)
    case 'task':
      return taskCommand(schema, active)
    default:
      return null
  }
}

/**
 * Block-level actions apply to the whole block, not just the selected text —
 * say so where the user looks, so a half-sentence selection is no surprise.
 */
export function titleFor(item: ToolbarButton): string {
  const isBlockLevel =
    item.kind === 'block' || item.kind === 'list' || item.kind === 'wrap' || item.kind === 'task'
  return isBlockLevel ? `${item.title} — applies to the whole block` : item.title
}
