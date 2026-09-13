// @vitest-environment jsdom

/**
 * Toolbar commands against the REAL Milkdown editor (commonmark + gfm), the
 * same presets LiveMarkdown mounts. The sibling spec uses a hand-built schema
 * with no plugins, which cannot see three things production has:
 *
 *  - `list_item` carries `label` / `listType` attrs and `syncListOrderPlugin`
 *    rewrites a list from them on every transaction;
 *  - `table_*` and `code_block` nodes exist, with content rules that refuse
 *    a leaf block;
 *  - the markdown serializer, which is what ends up in the file.
 *
 * Every case here was a shipped regression the schema-only spec passed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Editor, defaultValueCtx, editorViewCtx, rootCtx } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import { getMarkdown } from '@milkdown/utils'
import { TextSelection } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'
import type { Node as PMNode } from '@milkdown/prose/model'
import { ITEMS, commandFor, isItemActive, type ToolbarItem } from '../../lib/markdownFormatCommands'

let editor: Editor | null = null
let root: HTMLElement | null = null

async function teardown() {
  await editor?.destroy()
  root?.remove()
  editor = null
  root = null
}

/** Mounts a fresh editor, destroying the previous one if a test mounts twice. */
async function mount(markdown: string): Promise<EditorView> {
  await teardown()
  root = document.createElement('div')
  document.body.appendChild(root)
  editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, markdown)
    })
    .use(commonmark)
    .use(gfm)
    .create()
  return editor.ctx.get(editorViewCtx)
}

afterEach(teardown)

function itemById(id: string): ToolbarItem {
  const found = ITEMS.find((item) => item.id === id)
  if (!found) throw new Error(`no toolbar item with id "${id}"`)
  return found
}

/** Start position of the first text node containing `needle`. */
function posOfText(doc: PMNode, needle: string): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (found !== -1) return false
    if (node.isText && node.text?.includes(needle)) {
      found = pos + (node.text.indexOf(needle) ?? 0)
      return false
    }
    return true
  })
  if (found === -1) throw new Error(`text "${needle}" not found in doc`)
  return found
}

function select(view: EditorView, from: number, to = from) {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
}

/** Resolve the command exactly as the toolbar does: from the live state. */
function click(view: EditorView, id: string): boolean {
  const item = itemById(id)
  const active = isItemActive(view.state, item)
  const command = commandFor(view.state, item, active)
  if (!command) throw new Error(`no command for "${id}"`)
  return command(view.state, view.dispatch, view)
}

function dryRun(view: EditorView, id: string): boolean {
  const item = itemById(id)
  const command = commandFor(view.state, item, isItemActive(view.state, item))
  return Boolean(command?.(view.state))
}

const markdown = () => {
  if (!editor) throw new Error('no editor mounted')
  return editor.action(getMarkdown()).trim()
}

// Bullet-list spacing is asserted loosely: Milkdown serialises even a pristine
// tight bullet list as loose (`spread` is parsed as the string "false"), which
// is unrelated to the toolbar.
const tight = (md: string) => md.replace(/\n\n/g, '\n')

const blockNames = (doc: PMNode) => {
  const names: string[] = []
  doc.forEach((child) => names.push(child.type.name))
  return names
}

describe('list retype survives syncListOrderPlugin', () => {
  let view: EditorView
  beforeEach(async () => {
    view = await mount('1. one\n2. two\n')
    select(view, posOfText(view.state.doc, 'one'))
  })

  it('ordered → bullet actually becomes a bullet list', () => {
    expect(click(view, 'bullet_list')).toBe(true)
    const list = view.state.doc.firstChild
    expect(list?.type.name).toBe('bullet_list')
    list?.forEach((item) => {
      expect(item.attrs.listType).toBe('bullet')
      expect(item.attrs.label).toBe('•')
    })
    expect(tight(markdown())).toBe('* one\n* two')
  })

  it('bullet → ordered numbers every item', async () => {
    view = await mount('- one\n- two\n')
    select(view, posOfText(view.state.doc, 'one'))
    expect(click(view, 'ordered_list')).toBe(true)
    const list = view.state.doc.firstChild
    expect(list?.type.name).toBe('ordered_list')
    expect(list?.child(0).attrs.listType).toBe('ordered')
    expect(list?.child(1).attrs.label).toBe('2.')
    expect(markdown()).toBe('1. one\n2. two')
  })

  it('keeps task items as tasks across a retype', async () => {
    view = await mount('- [ ] one\n- [x] two\n')
    select(view, posOfText(view.state.doc, 'one'))
    expect(click(view, 'ordered_list')).toBe(true)
    expect(markdown()).toBe('1. [ ] one\n2. [x] two')
  })
})

describe('horizontal rule', () => {
  it('is not applicable inside a table cell, and the click does not shatter the table', async () => {
    const view = await mount('| h |\n| - |\n| c |\n')
    select(view, posOfText(view.state.doc, 'c'))
    expect(dryRun(view, 'hr')).toBe(false)
    expect(click(view, 'hr')).toBe(false)
    expect(blockNames(view.state.doc)).toEqual(['table'])
  })

  it('is not applicable inside a code block', async () => {
    const view = await mount('```\ncode\n```\n')
    select(view, posOfText(view.state.doc, 'code') + 2)
    expect(dryRun(view, 'hr')).toBe(false)
    expect(click(view, 'hr')).toBe(false)
    expect(blockNames(view.state.doc)).toEqual(['code_block'])
  })

  it('splits a paragraph around the rule with no empty paragraphs left behind', async () => {
    const view = await mount('abcd\n')
    select(view, posOfText(view.state.doc, 'abcd') + 2)
    expect(click(view, 'hr')).toBe(true)
    expect(blockNames(view.state.doc)).toEqual(['paragraph', 'hr', 'paragraph'])
    expect(markdown()).toBe('ab\n\n***\n\ncd')
    // Caret lands at the start of the text after the rule.
    expect(view.state.selection.$from.parent.textContent).toBe('cd')
    expect(view.state.selection.$from.parentOffset).toBe(0)
  })

  it('inserts a paragraph only when nothing editable follows the rule', async () => {
    const view = await mount('foo\n')
    select(view, posOfText(view.state.doc, 'foo') + 3)
    expect(click(view, 'hr')).toBe(true)
    expect(blockNames(view.state.doc)).toEqual(['paragraph', 'hr', 'paragraph'])
    expect(markdown()).toBe('foo\n\n***')
    expect(view.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(view.state.selection.$from.parent.textContent).toBe('')
  })

  it('adds no paragraph when a list follows; the caret moves into the list', async () => {
    const view = await mount('foo\n\n- x\n')
    select(view, posOfText(view.state.doc, 'foo') + 3)
    expect(click(view, 'hr')).toBe(true)
    // An empty paragraph left here would be saved as `<br />`.
    expect(blockNames(view.state.doc)).toEqual(['paragraph', 'hr', 'bullet_list'])
    expect(tight(markdown())).toBe('foo\n***\n* x')
    expect(view.state.selection.$from.parent.textContent).toBe('x')
  })

  it('replaces an empty paragraph rather than leaving it above the rule', async () => {
    const view = await mount('foo\n\n\n')
    // Append an empty paragraph explicitly: markdown collapses blank lines.
    const paragraph = view.state.schema.nodes.paragraph
    view.dispatch(view.state.tr.insert(view.state.doc.content.size, paragraph.create()))
    select(view, view.state.doc.content.size - 1)
    expect(click(view, 'hr')).toBe(true)
    expect(blockNames(view.state.doc)).toEqual(['paragraph', 'hr', 'paragraph'])
  })
})

describe('quote inside a list', () => {
  it('unquotes the list instead of lifting the paragraph out of the list', async () => {
    const view = await mount('> - item\n')
    select(view, posOfText(view.state.doc, 'item'))
    expect(isItemActive(view.state, itemById('blockquote'))).toBe(true)
    expect(click(view, 'blockquote')).toBe(true)
    expect(blockNames(view.state.doc)).toEqual(['bullet_list'])
    expect(markdown()).toBe('* item')
    expect(isItemActive(view.state, itemById('blockquote'))).toBe(false)
  })
})

describe('task list over several items', () => {
  it('converts every selected sibling item', async () => {
    const view = await mount('- a\n- b\n- c\n')
    select(view, posOfText(view.state.doc, 'a'), posOfText(view.state.doc, 'c') + 1)
    expect(click(view, 'task')).toBe(true)
    expect(tight(markdown())).toBe('* [ ] a\n* [ ] b\n* [ ] c')
  })

  it('un-tasks every selected sibling item', async () => {
    const view = await mount('- [ ] a\n- [ ] b\n- [ ] c\n')
    select(view, posOfText(view.state.doc, 'a'), posOfText(view.state.doc, 'c') + 1)
    expect(click(view, 'task')).toBe(true)
    expect(tight(markdown())).toBe('* a\n* b\n* c')
  })

  it('leaves the parent item alone when the selection sits in a nested list', async () => {
    const view = await mount('- a\n  - b\n')
    select(view, posOfText(view.state.doc, 'b'))
    expect(click(view, 'task')).toBe(true)
    expect(tight(markdown())).toBe('* a\n  * [ ] b')
  })
})

describe('collapsed caret inside an inline mark', () => {
  it('removes the whole link from a caret inside it', async () => {
    const view = await mount('see [docs](https://x.com) now\n')
    select(view, posOfText(view.state.doc, 'docs') + 2)
    expect(isItemActive(view.state, itemById('link'))).toBe(true)
    expect(dryRun(view, 'link')).toBe(true)
    expect(click(view, 'link')).toBe(true)
    expect(markdown()).toBe('see docs now')
  })

  it('removes the whole inline code span from a caret inside it', async () => {
    const view = await mount('run `npm test` now\n')
    select(view, posOfText(view.state.doc, 'npm test') + 3)
    expect(isItemActive(view.state, itemById('code'))).toBe(true)
    expect(dryRun(view, 'code')).toBe(true)
    expect(click(view, 'code')).toBe(true)
    expect(markdown()).toBe('run npm test now')
  })

  it('still refuses to ADD a link or code on a caret outside any mark', async () => {
    const view = await mount('plain\n')
    select(view, posOfText(view.state.doc, 'plain') + 2)
    expect(dryRun(view, 'link')).toBe(false)
    expect(dryRun(view, 'code')).toBe(false)
  })
})
