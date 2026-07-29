// @vitest-environment jsdom

/**
 * TDD contracts for issue #636 — fixed formatting toolbar in Rendered mode.
 *
 * Two layers, deliberately separated:
 *
 *  1. Pure derivation (isMarkActive / uniformBlock / isItemActive / commandFor)
 *     tested against a real EditorState built on a minimal schema that mirrors
 *     Milkdown's commonmark + gfm node and mark NAMES. Real PM transactions,
 *     no mocks — these functions are where the semantics live.
 *
 *  2. Interaction contracts of the component itself, driven by a fake view.
 *     Unlike Editor-selection-chip.spec.tsx we need no module mocking: the
 *     toolbar receives the view as a prop instead of creating one.
 *
 * The two risks that are invisible when reading the code get explicit tests:
 *  - R1: mousedown must be defaultPrevented, or the click blurs the view and
 *    collapses the selection before the command runs.
 *  - R6: the active highlight must update from the click itself, NOT from a
 *    'selectionchange' event — that event may never fire, precisely because
 *    R1's preventDefault keeps the DOM selection still.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Schema, type Node as PMNode } from '@milkdown/prose/model'
import { EditorState, TextSelection, type Command } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'
import { MarkdownFormatToolbar } from '../MarkdownFormatToolbar'
import {
  ITEMS,
  commandFor,
  isItemActive,
  isMarkActive,
  uniformBlock,
  type ToolbarItem,
} from '../../lib/markdownFormatCommands'

// ---------------------------------------------------------------------------
// Minimal schema — node/mark names match @milkdown/preset-commonmark and
// preset-gfm ($nodeSchema/$markSchema declarations), which is what the
// production code looks up by name on view.state.schema.
// ---------------------------------------------------------------------------

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block', toDOM: () => ['p', 0] },
    heading: {
      attrs: { level: { default: 1 } },
      content: 'inline*',
      group: 'block',
      toDOM: (n: PMNode) => [`h${n.attrs.level}`, 0],
    },
    blockquote: { content: 'block+', group: 'block', toDOM: () => ['blockquote', 0] },
    bullet_list: { content: 'list_item+', group: 'block', toDOM: () => ['ul', 0] },
    ordered_list: { content: 'list_item+', group: 'block', toDOM: () => ['ol', 0] },
    list_item: {
      content: 'paragraph block*',
      attrs: { checked: { default: null } },
      toDOM: () => ['li', 0],
    },
    hr: { group: 'block', toDOM: () => ['hr'] },
    text: { group: 'inline' },
  },
  marks: {
    strong: { toDOM: () => ['strong', 0] },
    emphasis: { toDOM: () => ['em', 0] },
    inlineCode: { toDOM: () => ['code', 0] },
    strike_through: { toDOM: () => ['del', 0] },
    link: { attrs: { href: {} }, toDOM: () => ['a', 0] },
  },
})

const { doc, paragraph, heading, text } = {
  doc: (...children: PMNode[]) => schema.node('doc', null, children),
  paragraph: (...children: PMNode[]) => schema.node('paragraph', null, children),
  heading: (level: number, ...children: PMNode[]) => schema.node('heading', { level }, children),
  text: (s: string, marks?: ReturnType<typeof schema.mark>[]) => schema.text(s, marks),
}

function stateWith(node: PMNode, from?: number, to?: number): EditorState {
  const state = EditorState.create({ schema, doc: node })
  if (from === undefined) return state
  return state.apply(
    state.tr.setSelection(
      TextSelection.create(state.doc, from, to ?? from)
    )
  )
}

/** Fake EditorView that applies transactions to itself, like the real one. */
function fakeView(initial: EditorState) {
  const focus = vi.fn()
  const view = {
    state: initial,
    // The real view owns a contentEditable element; the toolbar listens on it
    // for keyboard-driven changes that emit no selectionchange.
    dom: document.createElement('div'),
    focus,
    dispatch: vi.fn((tr) => {
      view.state = view.state.apply(tr)
    }),
  }
  return view as unknown as EditorView & {
    focus: ReturnType<typeof vi.fn>
    dom: HTMLElement
  }
}

const listItem = (checked: boolean | null, ...children: PMNode[]) =>
  schema.node('list_item', { checked }, children)
const bulletList = (...items: PMNode[]) => schema.node('bullet_list', null, items)
const orderedList = (...items: PMNode[]) => schema.node('ordered_list', null, items)
const blockquote = (...children: PMNode[]) => schema.node('blockquote', null, children)

/**
 * Start position of the named text node — avoids brittle hardcoded offsets.
 * `pos + needle.length` is its end, so a full-text selection is [pos, pos+len].
 */
function posOfText(node: PMNode, needle: string): number {
  let found = -1
  node.descendants((child, pos) => {
    if (found !== -1) return false
    if (child.isText && child.text === needle) found = pos
    return true
  })
  if (found === -1) throw new Error(`text "${needle}" not found in doc`)
  return found
}

/** Runs a command and returns the resulting state, plus whether it applied. */
function apply(state: EditorState, command: Command | null) {
  let next = state
  const applied = command ? command(state, (tr) => (next = state.apply(tr))) : false
  return { applied, next }
}

function itemById(id: string): ToolbarItem {
  const found = ITEMS.find((i) => i.kind !== 'separator' && i.id === id)
  if (!found) throw new Error(`no toolbar item with id "${id}"`)
  return found
}

// ---------------------------------------------------------------------------
// 1. Pure derivation
// ---------------------------------------------------------------------------

describe('isMarkActive', () => {
  it('is true when the mark covers the whole selection', () => {
    const strong = schema.mark('strong')
    const state = stateWith(doc(paragraph(text('bold text', [strong]))), 1, 10)
    expect(isMarkActive(state, 'strong')).toBe(true)
  })

  // Partial coverage counts as active, and that is not a shortcut: toggleMark
  // defaults to removeWhenPresent, deciding `add = !ranges.some(rangeHasMark)`
  // (prosemirror-commands/dist/index.js:699). So on a half-bold selection the
  // click REMOVES bold from the whole range — "active" is exactly the honest
  // prediction of what pressing the button does.
  it('is true when only part of the selection carries the mark, matching toggleMark', () => {
    const strong = schema.mark('strong')
    const state = stateWith(doc(paragraph(text('bold', [strong]), text(' plain'))), 1, 11)
    expect(isMarkActive(state, 'strong')).toBe(true)
  })

  // The invariant behind the rule above: whatever isMarkActive reports, running
  // the command must move the document the other way.
  it('predicts the direction of the toggle for a partially marked selection', () => {
    const strong = schema.mark('strong')
    const state = stateWith(doc(paragraph(text('bold', [strong]), text(' plain'))), 1, 11)
    const command = commandFor(state, itemById('strong'), isMarkActive(state, 'strong'))
    let next: EditorState = state
    command?.(state, (tr) => {
      next = state.apply(tr)
    })
    expect(isMarkActive(next, 'strong')).toBe(false)
  })

  it('falls back to stored marks on an empty selection', () => {
    const base = stateWith(doc(paragraph(text('abc'))), 2)
    const withStored = base.apply(base.tr.addStoredMark(schema.mark('strong')))
    expect(isMarkActive(withStored, 'strong')).toBe(true)
    expect(isMarkActive(base, 'strong')).toBe(false)
  })

  it('is false for a mark name absent from the schema', () => {
    const state = stateWith(doc(paragraph(text('abc'))), 1, 4)
    expect(isMarkActive(state, 'not_a_real_mark')).toBe(false)
  })
})

describe('uniformBlock', () => {
  it('reports the heading level when the selection sits in one heading', () => {
    const state = stateWith(doc(heading(2, text('Title'))), 1, 6)
    expect(uniformBlock(state)).toEqual({ name: 'heading', level: 2 })
  })

  it('reports paragraph for a plain paragraph', () => {
    const state = stateWith(doc(paragraph(text('body'))), 1, 5)
    expect(uniformBlock(state)).toEqual({ name: 'paragraph', level: undefined })
  })

  it('returns null when the selection spans different block types', () => {
    const state = stateWith(doc(heading(2, text('Title')), paragraph(text('body'))), 1, 12)
    expect(uniformBlock(state)).toBeNull()
  })

  it('returns null when the selection spans two heading levels', () => {
    const state = stateWith(doc(heading(1, text('One')), heading(2, text('Two'))), 1, 10)
    expect(uniformBlock(state)).toBeNull()
  })
})

describe('isItemActive', () => {
  it('lights the matching heading button', () => {
    const state = stateWith(doc(heading(2, text('Title'))), 1, 6)
    expect(isItemActive(state, itemById('h2'))).toBe(true)
    expect(isItemActive(state, itemById('h1'))).toBe(false)
  })

  // R5: a mixed selection must not report any block format as active — doing so
  // would claim something false about the document.
  it('lights NO block button when the selection spans mixed block types', () => {
    const state = stateWith(doc(heading(2, text('Title')), paragraph(text('body'))), 1, 12)
    const blockIds = ['h1', 'h2', 'h3', 'paragraph']
    for (const id of blockIds) {
      expect(isItemActive(state, itemById(id))).toBe(false)
    }
  })

  it('lights the list button when the selection sits inside a list', () => {
    const list = schema.node('bullet_list', null, [
      schema.node('list_item', null, [paragraph(text('item'))]),
    ])
    const state = stateWith(doc(list), 3, 7)
    expect(isItemActive(state, itemById('bullet_list'))).toBe(true)
    expect(isItemActive(state, itemById('ordered_list'))).toBe(false)
  })
})

describe('commandFor', () => {
  it('turns a paragraph into the requested heading', () => {
    const state = stateWith(doc(paragraph(text('body'))), 1, 5)
    const command = commandFor(state, itemById('h2'), false)
    expect(command).not.toBeNull()
    let next: EditorState = state
    command?.(state, (tr) => {
      next = state.apply(tr)
    })
    expect(next.doc.firstChild?.type.name).toBe('heading')
    expect(next.doc.firstChild?.attrs.level).toBe(2)
  })

  // Clicking the already-active heading returns to paragraph, mirroring the
  // preset's own wrapInHeadingCommand(0) behaviour.
  it('toggles an active heading back to paragraph', () => {
    const state = stateWith(doc(heading(2, text('Title'))), 1, 6)
    const command = commandFor(state, itemById('h2'), true)
    let next: EditorState = state
    command?.(state, (tr) => {
      next = state.apply(tr)
    })
    expect(next.doc.firstChild?.type.name).toBe('paragraph')
  })

  // R5: headings are a block operation. Selecting across three paragraphs and
  // clicking H2 converts all three — matching Mod-Alt-2 and Notion/Obsidian.
  it('applies a heading to every textblock the selection touches', () => {
    const state = stateWith(
      doc(paragraph(text('one')), paragraph(text('two')), paragraph(text('three'))),
      1,
      16
    )
    const command = commandFor(state, itemById('h2'), false)
    let next: EditorState = state
    command?.(state, (tr) => {
      next = state.apply(tr)
    })
    expect(next.doc.childCount).toBe(3)
    next.doc.forEach((node) => expect(node.type.name).toBe('heading'))
  })

  it('returns null for an item whose node is absent from the schema', () => {
    const state = stateWith(doc(paragraph(text('body'))), 1, 5)
    const bogus: ToolbarItem = {
      kind: 'block',
      id: 'bogus',
      label: 'X',
      title: 'X',
      node: 'not_a_real_node',
    }
    expect(commandFor(state, bogus, false)).toBeNull()
  })

  it('inserts a horizontal rule at the cursor', () => {
    const state = stateWith(doc(paragraph(text('body'))), 5)
    const command = commandFor(state, itemById('hr'), false)
    let next: EditorState = state
    command?.(state, (tr) => {
      next = state.apply(tr)
    })
    const names: string[] = []
    next.doc.forEach((node) => names.push(node.type.name))
    expect(names).toContain('hr')
  })

  // Task list is the only item with no equivalent command in either preset —
  // it wraps the block the same way taskListInputRule.ts does, so `- [ ]`
  // typed by hand and the button produce the same document.
  it('wraps the block into a bullet_list > list_item carrying checked: false', () => {
    const state = stateWith(doc(paragraph(text('body'))), 1, 5)
    const command = commandFor(state, itemById('task'), false)
    let next: EditorState = state
    command?.(state, (tr) => {
      next = state.apply(tr)
    })
    const list = next.doc.firstChild
    expect(list?.type.name).toBe('bullet_list')
    expect(list?.firstChild?.type.name).toBe('list_item')
    expect(list?.firstChild?.attrs.checked).toBe(false)
  })

  // Link needs a href, which only the dialog can supply, so the ADD path is
  // driven by the component. commandFor still returns a usable command so the
  // applicability check (and the remove path) work uniformly.
  it('removes an active link without needing a href', () => {
    const link = schema.mark('link', { href: 'https://example.com' })
    const state = stateWith(doc(paragraph(text('linked', [link]))), 1, 7)
    expect(isMarkActive(state, 'link')).toBe(true)

    const command = commandFor(state, itemById('link'), true)
    let next: EditorState = state
    command?.(state, (tr) => {
      next = state.apply(tr)
    })
    expect(isMarkActive(next, 'link')).toBe(false)
  })

  it('applies a link with the href supplied by the caller', () => {
    const state = stateWith(doc(paragraph(text('text'))), 1, 5)
    const command = commandFor(state, itemById('link'), false, { href: 'https://example.com' })
    let next: EditorState = state
    command?.(state, (tr) => {
      next = state.apply(tr)
    })
    const marks = next.doc.firstChild?.firstChild?.marks ?? []
    expect(marks.map((m) => m.type.name)).toContain('link')
    expect(marks[0]?.attrs.href).toBe('https://example.com')
  })
})

// ---------------------------------------------------------------------------
// 1b. Regressions found by adversarial review. Every one of these produced a
//     wrong document or a dead button on a path the issue lists as a headline
//     benefit, and none was covered before.
// ---------------------------------------------------------------------------

describe('every button applies to a non-empty selection', () => {
  // The AC says "each of the ~14 buttons applies its format". Six had no
  // dispatch coverage at all, which is what hid the list and quote defects.
  const cases: { id: string; assert: (next: EditorState) => void }[] = [
    { id: 'emphasis', assert: (n) => expectMark(n, 'emphasis') },
    { id: 'strike', assert: (n) => expectMark(n, 'strike_through') },
    { id: 'code', assert: (n) => expectMark(n, 'inlineCode') },
    { id: 'strong', assert: (n) => expectMark(n, 'strong') },
    { id: 'bullet_list', assert: (n) => expect(n.doc.firstChild?.type.name).toBe('bullet_list') },
    { id: 'ordered_list', assert: (n) => expect(n.doc.firstChild?.type.name).toBe('ordered_list') },
    { id: 'blockquote', assert: (n) => expect(n.doc.firstChild?.type.name).toBe('blockquote') },
    { id: 'h1', assert: (n) => expect(n.doc.firstChild?.type.name).toBe('heading') },
  ]

  function expectMark(state: EditorState, name: string) {
    const marks = state.doc.firstChild?.firstChild?.marks ?? []
    expect(marks.map((m) => m.type.name)).toContain(name)
  }

  for (const { id, assert } of cases) {
    it(`${id} changes the document`, () => {
      const base = doc(paragraph(text('body')))
      const state = stateWith(base, posOfText(base, 'body'), posOfText(base, 'body') + 4)
      const item = itemById(id)
      const { applied, next } = apply(state, commandFor(state, item, isItemActive(state, item)))
      expect(applied).toBe(true)
      assert(next)
    })
  }
})

describe('task list (D1, D9)', () => {
  it('turns an existing bullet item into a task instead of reporting disabled', () => {
    const base = doc(bulletList(listItem(null, paragraph(text('coffee')))))
    const state = stateWith(base, posOfText(base, 'coffee'))
    const item = itemById('task')
    const command = commandFor(state, item, isItemActive(state, item))

    // Was: findWrapping rejects a bullet_list at index 0 of `paragraph block*`,
    // so the command reported false and the button rendered greyed.
    expect(command?.(state)).toBe(true)

    const { next } = apply(state, command)
    const list = next.doc.firstChild
    expect(list?.type.name).toBe('bullet_list')
    expect(list?.childCount).toBe(1)
    expect(list?.firstChild?.attrs.checked).toBe(false)
  })

  it('wraps every block of a multi-block selection, like the list buttons do', () => {
    const base = doc(paragraph(text('one')), paragraph(text('two')), paragraph(text('three')))
    const state = stateWith(base, posOfText(base, 'one'), posOfText(base, 'three') + 5)
    const item = itemById('task')
    const { next } = apply(state, commandFor(state, item, isItemActive(state, item)))
    expect(next.doc.firstChild?.childCount).toBe(3)
  })
})

describe('toggling off a wrapping format (D2)', () => {
  it('lifts out of a blockquote instead of nesting another one', () => {
    const base = doc(blockquote(paragraph(text('quoted'))))
    const state = stateWith(base, posOfText(base, 'quoted'))
    const item = itemById('blockquote')
    expect(isItemActive(state, item)).toBe(true)

    const { next } = apply(state, commandFor(state, item, true))
    // Was: blockquote > blockquote > paragraph, i.e. "> quoted" became "> > quoted".
    expect(next.doc.firstChild?.type.name).toBe('paragraph')
  })

  it('lifts a list item out instead of nesting a sublist', () => {
    const base = doc(
      bulletList(listItem(null, paragraph(text('one'))), listItem(null, paragraph(text('two'))))
    )
    const state = stateWith(base, posOfText(base, 'two'))
    const item = itemById('bullet_list')
    expect(isItemActive(state, item)).toBe(true)

    const { applied, next } = apply(state, commandFor(state, item, true))
    expect(applied).toBe(true)
    let nested = false
    next.doc.descendants((node) => {
      if (node.type.name === 'list_item') {
        node.descendants((inner) => {
          if (inner.type.name === 'bullet_list') nested = true
          return true
        })
      }
      return true
    })
    expect(nested).toBe(false)
  })
})

describe('bullet <-> ordered conversion (D3)', () => {
  it('retypes the list in place rather than nesting a sublist', () => {
    const base = doc(
      bulletList(listItem(null, paragraph(text('one'))), listItem(null, paragraph(text('two'))))
    )
    const state = stateWith(base, posOfText(base, 'one'))
    const item = itemById('ordered_list')
    const command = commandFor(state, item, isItemActive(state, item))
    expect(command?.(state)).toBe(true)

    const { next } = apply(state, command)
    expect(next.doc.childCount).toBe(1)
    expect(next.doc.firstChild?.type.name).toBe('ordered_list')
    // Both items survive at the top level — no sublist was created.
    expect(next.doc.firstChild?.childCount).toBe(2)
  })

  it('lights only the nearest list ancestor in a nested list (D12)', () => {
    const inner = orderedList(listItem(null, paragraph(text('deep'))))
    const base = doc(bulletList(listItem(null, paragraph(text('outer')), inner)))
    const state = stateWith(base, posOfText(base, 'deep'))
    expect(isItemActive(state, itemById('ordered_list'))).toBe(true)
    expect(isItemActive(state, itemById('bullet_list'))).toBe(false)
  })
})

describe('horizontal rule (D4)', () => {
  it('leaves a textblock after the rule with the caret in it', () => {
    const base = doc(paragraph(text('body')))
    const state = stateWith(base, posOfText(base, 'body') + 4)
    const { next } = apply(state, commandFor(state, itemById('hr'), false))

    const names: string[] = []
    next.doc.forEach((node) => names.push(node.type.name))
    expect(names).toContain('hr')
    // Was: doc ended at the hr with a NodeSelection over it, so the next
    // keystroke replaced the rule the user had just inserted.
    expect(names[names.length - 1]).not.toBe('hr')
    expect(next.selection instanceof TextSelection).toBe(true)
  })

  it('never consumes the document down to zero textblocks', () => {
    const base = doc(paragraph())
    const state = stateWith(base, 1)
    const { next } = apply(state, commandFor(state, itemById('hr'), false))
    let textblocks = 0
    next.doc.forEach((node) => {
      if (node.isTextblock) textblocks += 1
    })
    expect(textblocks).toBeGreaterThan(0)
  })
})

describe('inline code parity with Mod-e (D6)', () => {
  it('does not apply to an empty selection, matching toggleInlineCodeCommand', () => {
    const base = doc(paragraph(text('body')))
    const state = stateWith(base, posOfText(base, 'body'))
    expect(commandFor(state, itemById('code'), false)?.(state)).toBe(false)
  })

  it('strips other marks over the range, matching toggleInlineCodeCommand', () => {
    const base = doc(paragraph(text('bold', [schema.mark('strong')])))
    const state = stateWith(base, posOfText(base, 'bold'), posOfText(base, 'bold') + 4)
    const { next } = apply(state, commandFor(state, itemById('code'), false))
    const marks = next.doc.firstChild?.firstChild?.marks ?? []
    expect(marks.map((m) => m.type.name)).toEqual(['inlineCode'])
  })
})

describe('honest active state (D5, D7)', () => {
  it('does not light the paragraph button inside a list item', () => {
    const base = doc(bulletList(listItem(null, paragraph(text('item')))))
    const state = stateWith(base, posOfText(base, 'item'))
    expect(isItemActive(state, itemById('bullet_list'))).toBe(true)
    expect(isItemActive(state, itemById('paragraph'))).toBe(false)
  })

  it('does not light the paragraph button in a plain paragraph either', () => {
    // Nothing to un-apply, and setBlockType(paragraph) on a paragraph is a
    // no-op — claiming "pressed" for a dead button misleads screen readers.
    const base = doc(paragraph(text('body')))
    const state = stateWith(base, posOfText(base, 'body'))
    expect(isItemActive(state, itemById('paragraph'))).toBe(false)
  })

  it('refuses a link on a collapsed caret', () => {
    const base = doc(paragraph(text('body')))
    const state = stateWith(base, posOfText(base, 'body'))
    expect(commandFor(state, itemById('link'), false, { href: 'https://x.com' })?.(state)).toBe(
      false
    )
  })
})

// ---------------------------------------------------------------------------
// 2. Component interaction contracts
// ---------------------------------------------------------------------------

describe('MarkdownFormatToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders one button per non-separator item', () => {
    const view = fakeView(stateWith(doc(paragraph(text('body'))), 1, 5))
    render(<MarkdownFormatToolbar view={view} />)
    const expected = ITEMS.filter((i) => i.kind !== 'separator').length
    expect(screen.getAllByRole('button')).toHaveLength(expected)
  })

  it('renders the toolbar container even without a view', () => {
    render(<MarkdownFormatToolbar view={null} />)
    expect(screen.getByRole('toolbar')).toBeTruthy()
  })

  // R1 — the whole feature silently no-ops without this.
  it('prevents default on mousedown so the selection survives the click', () => {
    const view = fakeView(stateWith(doc(paragraph(text('body'))), 1, 5))
    render(<MarkdownFormatToolbar view={view} />)
    const button = screen.getByTestId('md-toolbar-btn-h2')

    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    button.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it('dispatches with the selection intact and returns focus to the document', () => {
    const view = fakeView(stateWith(doc(paragraph(text('body'))), 1, 5))
    render(<MarkdownFormatToolbar view={view} />)

    fireEvent.click(screen.getByTestId('md-toolbar-btn-h2'))

    expect(view.dispatch).toHaveBeenCalledTimes(1)
    expect(view.state.doc.firstChild?.type.name).toBe('heading')
    expect(view.focus).toHaveBeenCalled()
  })

  // R6 — the highlight must come from the click, not from a debounced
  // 'selectionchange' that may never fire (see R1) and would be late anyway.
  it('updates the active highlight from the click itself, without selectionchange', () => {
    const view = fakeView(stateWith(doc(paragraph(text('body'))), 1, 5))
    render(<MarkdownFormatToolbar view={view} />)
    const h2 = screen.getByTestId('md-toolbar-btn-h2')
    expect(h2.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(h2)

    // No document.dispatchEvent(new Event('selectionchange')) here, on purpose.
    expect(screen.getByTestId('md-toolbar-btn-h2').getAttribute('aria-pressed')).toBe('true')
  })

  it('disables a button whose command cannot apply in the current state', () => {
    // hr is a leaf block: turning it into a heading is not applicable, so
    // setBlockType reports false and the button must render disabled.
    const state = EditorState.create({ schema, doc: doc(schema.node('hr')) })
    const view = fakeView(state)
    render(<MarkdownFormatToolbar view={view} />)

    expect(screen.getByTestId('md-toolbar-btn-h2')).toHaveProperty('disabled', true)
  })

  it('disables every button when there is no view', () => {
    render(<MarkdownFormatToolbar view={null} />)
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveProperty('disabled', true)
    }
  })

  // The link button is the one action that cannot complete from a single
  // click, so the dialog flow gets its own contracts.
  it('opens a URL dialog instead of dispatching when adding a link', () => {
    const view = fakeView(stateWith(doc(paragraph(text('text'))), 1, 5))
    render(<MarkdownFormatToolbar view={view} />)

    fireEvent.click(screen.getByTestId('md-toolbar-btn-link'))

    expect(view.dispatch).not.toHaveBeenCalled()
    expect(screen.getByTestId('md-toolbar-link-dialog')).toBeTruthy()
  })

  it('applies the link once the dialog is submitted', () => {
    const view = fakeView(stateWith(doc(paragraph(text('text'))), 1, 5))
    render(<MarkdownFormatToolbar view={view} />)
    fireEvent.click(screen.getByTestId('md-toolbar-btn-link'))

    const input = screen.getByTestId('md-toolbar-link-dialog').querySelector('input')
    if (!input) throw new Error('link dialog has no input')
    fireEvent.change(input, { target: { value: 'https://example.com' } })
    fireEvent.submit(input.closest('form') ?? input)

    expect(view.dispatch).toHaveBeenCalledTimes(1)
    const marks = view.state.doc.firstChild?.firstChild?.marks ?? []
    expect(marks.map((m) => m.type.name)).toContain('link')
    expect(screen.queryByTestId('md-toolbar-link-dialog')).toBeNull()
  })

  it('removes an active link directly, with no dialog', () => {
    const link = schema.mark('link', { href: 'https://example.com' })
    const view = fakeView(stateWith(doc(paragraph(text('linked', [link]))), 1, 7))
    render(<MarkdownFormatToolbar view={view} />)

    fireEvent.click(screen.getByTestId('md-toolbar-btn-link'))

    expect(screen.queryByTestId('md-toolbar-link-dialog')).toBeNull()
    expect(view.dispatch).toHaveBeenCalledTimes(1)
    expect(isMarkActive(view.state, 'link')).toBe(false)
  })

  // Verified in real Chromium: a collapsed-caret Cmd+B writes only
  // state.storedMarks — no doc change, no DOM mutation, no selection movement —
  // so 'selectionchange' NEVER fires (0 events at 0/100/300ms). Without a
  // keydown trigger on the editor element the highlight goes stale: the user
  // presses Cmd+B to stop bolding and the button stays lit.
  it('repaints after a keyboard mark toggle that only changed storedMarks', () => {
    vi.useFakeTimers()
    try {
      const view = fakeView(stateWith(doc(paragraph(text('body'))), 3))
      render(<MarkdownFormatToolbar view={view} />)
      expect(screen.getByTestId('md-toolbar-btn-strong').getAttribute('aria-pressed')).toBe('false')

      // What toggleMark does at a collapsed caret — storedMarks only.
      view.state = view.state.apply(view.state.tr.addStoredMark(schema.mark('strong')))
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true }))
      act(() => {
        vi.advanceTimersByTime(60)
      })

      expect(screen.getByTestId('md-toolbar-btn-strong').getAttribute('aria-pressed')).toBe('true')
    } finally {
      vi.useRealTimers()
    }
  })

  it('repaints when the caret moves by keyboard into differently formatted text', () => {
    vi.useFakeTimers()
    try {
      const view = fakeView(stateWith(doc(heading(2, text('Title')), paragraph(text('body'))), 2))
      render(<MarkdownFormatToolbar view={view} />)
      expect(screen.getByTestId('md-toolbar-btn-h2').getAttribute('aria-pressed')).toBe('true')

      view.state = view.state.apply(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 10))
      )
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
      act(() => {
        vi.advanceTimersByTime(60)
      })

      expect(screen.getByTestId('md-toolbar-btn-h2').getAttribute('aria-pressed')).toBe('false')
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks block-type buttons as applying to the whole block in their title', () => {
    const view = fakeView(stateWith(doc(paragraph(text('body'))), 1, 5))
    render(<MarkdownFormatToolbar view={view} />)
    for (const id of ['h2', 'bullet_list', 'blockquote', 'task']) {
      const title = screen.getByTestId(`md-toolbar-btn-${id}`).getAttribute('title') ?? ''
      expect(title.toLowerCase()).toContain('block')
    }
  })

  // D8: `.is-on` and `:disabled` have equal specificity, so a lit-and-greyed
  // button ships an accent wash with contradictory aria. No button should ever
  // be both — the highlight means "clicking un-applies this".
  it('never renders a button both pressed and disabled', () => {
    const view = fakeView(stateWith(doc(paragraph(text('body'))), 3))
    render(<MarkdownFormatToolbar view={view} />)
    for (const button of screen.getAllByRole('button')) {
      const pressed = button.getAttribute('aria-pressed') === 'true'
      const disabled = (button as HTMLButtonElement).disabled
      expect(pressed && disabled).toBe(false)
    }
  })

  // D14: insertions have no pressed state to report.
  it('omits aria-pressed on insertion buttons', () => {
    const view = fakeView(stateWith(doc(paragraph(text('body'))), 1, 5))
    render(<MarkdownFormatToolbar view={view} />)
    expect(screen.getByTestId('md-toolbar-btn-hr').hasAttribute('aria-pressed')).toBe(false)
    expect(screen.getByTestId('md-toolbar-btn-h2').hasAttribute('aria-pressed')).toBe(true)
  })

  // D11: `active` and `command` were captured at render and only refreshed on a
  // 50ms debounce, so a keyboard shortcut followed by a fast click dispatched
  // the pre-flip command.
  it('recomputes the command at click time, not at render time', () => {
    const view = fakeView(stateWith(doc(paragraph(text('body'))), 1, 5))
    render(<MarkdownFormatToolbar view={view} />)

    // Keyboard shortcut turns it into an H2 without any repaint reaching React.
    view.state = view.state.apply(
      view.state.tr.setBlockType(1, 5, schema.nodes.heading, { level: 2 })
    )
    fireEvent.click(screen.getByTestId('md-toolbar-btn-h2'))

    // Must read the fresh state and toggle back to paragraph.
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph')
  })

  it('disables the link button on a collapsed caret', () => {
    const view = fakeView(stateWith(doc(paragraph(text('body'))), 3))
    render(<MarkdownFormatToolbar view={view} />)
    expect(screen.getByTestId('md-toolbar-btn-link')).toHaveProperty('disabled', true)
  })
})
