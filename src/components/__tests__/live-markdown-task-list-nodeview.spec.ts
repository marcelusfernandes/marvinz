// @vitest-environment jsdom

/**
 * Unit tests for the taskListItemView NodeView constructor (real DOM).
 * Issue #437.
 *
 * Tests buildTaskListItemView() directly — no Milkdown editor needed.
 * This is the right layer to assert that <input type="checkbox"> is actually
 * rendered without standing up a full editor.
 *
 * Two mocks required (nothing else):
 *   - '@milkdown/preset-gfm'    — stubs extendListItemSchemaForTask (static
 *                                  import in taskListNodeView.ts)
 *   - '@milkdown/utils'         — stubs $view (used by the factory wrapper,
 *                                  not by buildTaskListItemView itself)
 * Do NOT mock '../../lib/taskListNodeView' — the real module is under test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Required: taskListNodeView.ts statically imports extendListItemSchemaForTask
// from here. The node identity is used for type-checking inside update().
// ---------------------------------------------------------------------------

vi.mock('@milkdown/preset-gfm', () => ({
  extendListItemSchemaForTask: { node: {} },
}))

// Required if exercising the taskListNodeView() factory (harmless otherwise).
vi.mock('@milkdown/utils', () => ({
  $view: (_schema: unknown, factory: () => unknown) => factory,
}))

// ---------------------------------------------------------------------------
// Import after all mocks — real module, not mocked
// ---------------------------------------------------------------------------

import { buildTaskListItemView } from '../../lib/taskListNodeView'

// ---------------------------------------------------------------------------
// Shared type reference — update() compares node types by reference (===),
// so initial and updated fake nodes must share the same type object.
// ---------------------------------------------------------------------------

const TYPE_LIST_ITEM = { name: 'list_item' }

// ---------------------------------------------------------------------------
// Fake PMNode helpers
// ---------------------------------------------------------------------------

function makeUncheckedTaskNode() {
  return {
    type: TYPE_LIST_ITEM,
    attrs: { checked: false },
  }
}

function makeCheckedTaskNode() {
  return {
    type: TYPE_LIST_ITEM,
    attrs: { checked: true },
  }
}

function makeRegularListItemNode() {
  return {
    type: TYPE_LIST_ITEM,
    attrs: { checked: null },
  }
}

// ---------------------------------------------------------------------------
// Fake ProseMirror view — minimal surface for dispatch assertions
// ---------------------------------------------------------------------------

const fakeDispatch = vi.fn()
const fakeEditorView = {
  state: {
    tr: {
      setNodeMarkup: vi.fn(function (this: unknown) {
        return this
      }),
    },
  },
  dispatch: fakeDispatch,
}

// ---------------------------------------------------------------------------
// Helper: build a real NodeView from buildTaskListItemView
// ---------------------------------------------------------------------------

function buildView(
  node:
    | ReturnType<typeof makeUncheckedTaskNode>
    | ReturnType<typeof makeCheckedTaskNode>
    | ReturnType<typeof makeRegularListItemNode>,
  getPos: () => number = () => 0
) {
  return buildTaskListItemView()(
    node as never,
    fakeEditorView as never,
    getPos as never,
    null as never,
    null as never
  )
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  fakeDispatch.mockClear()
  vi.mocked(fakeEditorView.state.tr.setNodeMarkup).mockClear()
})

// ===========================================================================
// Tests
// ===========================================================================

// ---------------------------------------------------------------------------
// (a) `- [ ]` renders an unchecked checkbox
// ---------------------------------------------------------------------------

describe('taskListItemView — unchecked task item', () => {
  it('renders an <input type="checkbox"> in the DOM', () => {
    const view = buildView(makeUncheckedTaskNode())

    const checkbox = view.dom.querySelector('input[type="checkbox"]')
    expect(checkbox).not.toBeNull()
  })

  it('the checkbox is not checked', () => {
    const view = buildView(makeUncheckedTaskNode())

    const checkbox = view.dom.querySelector('input[type="checkbox"]') as HTMLInputElement | null
    expect(checkbox?.checked).toBe(false)
  })

  it('dom root is an <li> element', () => {
    const view = buildView(makeUncheckedTaskNode())
    expect(view.dom.tagName).toBe('LI')
  })

  it('li carries data-item-type="task"', () => {
    const view = buildView(makeUncheckedTaskNode())
    expect(view.dom.getAttribute('data-item-type')).toBe('task')
  })
})

// ---------------------------------------------------------------------------
// (b) `- [x]` renders a checked checkbox
// ---------------------------------------------------------------------------

describe('taskListItemView — checked task item', () => {
  it('renders an <input type="checkbox"> in the DOM', () => {
    const view = buildView(makeCheckedTaskNode())

    const checkbox = view.dom.querySelector('input[type="checkbox"]')
    expect(checkbox).not.toBeNull()
  })

  it('the checkbox is checked', () => {
    const view = buildView(makeCheckedTaskNode())

    const checkbox = view.dom.querySelector('input[type="checkbox"]') as HTMLInputElement | null
    expect(checkbox?.checked).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// (c) Clicking the checkbox toggles state and round-trips the markdown
// ---------------------------------------------------------------------------

describe('taskListItemView — click toggle round-trip', () => {
  it('clicking an unchecked checkbox dispatches a transaction that sets checked=true', () => {
    const nodePos = 5
    const view = buildView(makeUncheckedTaskNode(), () => nodePos)

    const checkbox = view.dom.querySelector('input[type="checkbox"]') as HTMLInputElement | null
    expect(checkbox).not.toBeNull()

    checkbox!.click()

    expect(fakeDispatch).toHaveBeenCalledTimes(1)
    expect(fakeEditorView.state.tr.setNodeMarkup).toHaveBeenCalledWith(
      nodePos,
      undefined,
      expect.objectContaining({ checked: true })
    )
  })

  it('clicking a checked checkbox dispatches a transaction that sets checked=false', () => {
    const nodePos = 3
    const view = buildView(makeCheckedTaskNode(), () => nodePos)

    const checkbox = view.dom.querySelector('input[type="checkbox"]') as HTMLInputElement | null
    expect(checkbox).not.toBeNull()

    checkbox!.click()

    expect(fakeDispatch).toHaveBeenCalledTimes(1)
    expect(fakeEditorView.state.tr.setNodeMarkup).toHaveBeenCalledWith(
      nodePos,
      undefined,
      expect.objectContaining({ checked: false })
    )
  })

  it('clicking unchecked toggles checked attribute on the li', () => {
    const view = buildView(makeUncheckedTaskNode())

    const checkbox = view.dom.querySelector('input[type="checkbox"]') as HTMLInputElement | null
    checkbox!.click()

    // After toggle the li should reflect checked=true in its data attribute.
    expect(view.dom.getAttribute('data-checked')).toBe('true')
  })

  it('clicking checked toggles data-checked to false on the li', () => {
    const view = buildView(makeCheckedTaskNode())

    const checkbox = view.dom.querySelector('input[type="checkbox"]') as HTMLInputElement | null
    checkbox!.click()

    expect(view.dom.getAttribute('data-checked')).toBe('false')
  })
})

// ---------------------------------------------------------------------------
// update() behaviour
// ---------------------------------------------------------------------------

describe('taskListItemView — update()', () => {
  it('returns false when node type changes', () => {
    const view = buildView(makeUncheckedTaskNode())
    const result = (view as unknown as { update: (n: unknown) => boolean }).update({
      type: { name: 'paragraph' },
      attrs: { checked: false },
    })
    expect(result).toBe(false)
  })

  it('returns true and reflects new checked state when attrs change', () => {
    const view = buildView(makeUncheckedTaskNode())

    const result = (view as unknown as { update: (n: unknown) => boolean }).update(
      makeCheckedTaskNode()
    )

    expect(result).toBe(true)
    const checkbox = view.dom.querySelector('input[type="checkbox"]') as HTMLInputElement | null
    expect(checkbox?.checked).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Regular (non-task) list items — passthrough: no checkbox rendered
// ---------------------------------------------------------------------------

describe('taskListItemView — regular list item (checked=null)', () => {
  it('does not render a checkbox for a non-task list item', () => {
    const view = buildView(makeRegularListItemNode())

    const checkbox = view.dom.querySelector('input[type="checkbox"]')
    expect(checkbox).toBeNull()
  })
})
