// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted shared spy — module-stable, shared between mock factory and tests.
// The PluginKey mock wires getState to this spy so tests can inject the
// current TriggerState without going through real PM state machinery.
// ---------------------------------------------------------------------------

const { getStateSpy, MockReplaceStep } = vi.hoisted(() => {
  class MockReplaceStep {
    from: number
    slice: {
      size: number
      content: { textBetween: (a: number, b: number, br: string, leaf: string) => string }
    }
    constructor(
      from: number,
      _to: number,
      slice: {
        size: number
        content: { textBetween: (a: number, b: number, br: string, leaf: string) => string }
      }
    ) {
      this.from = from
      this.slice = slice
    }
  }
  return {
    getStateSpy: vi.fn<(s: unknown) => unknown>(),
    MockReplaceStep,
  }
})

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TriggerState = { active: false } | { active: true; from: number; query: string }
const INACTIVE: TriggerState = { active: false }

type FakeMarkType = { name: string; isInSet: (marks: FakeMark[]) => boolean }
type FakeMark = { type: FakeMarkType }
type FakeResolvedPos = {
  parentOffset: number
  parent: { type: { name: string } }
  marks: () => FakeMark[]
}
type FakeDoc = {
  resolve: (pos: number) => FakeResolvedPos
  textBetween: (from: number, to: number, br: string, leaf: string) => string
}
type FakeSchema = { marks: { inlineCode?: { isInSet: (marks: FakeMark[]) => boolean } } }
type FakeSelection = { from: number; empty: boolean }
type FakeState = { doc: FakeDoc; schema: FakeSchema; selection: FakeSelection }
type FakeMapping = {
  mapResult: (pos: number, bias: number) => { deleted: boolean; pos: number }
  map: (pos: number, bias: number) => number
  slice: (from: number) => FakeMapping
}
type FakeStep = {
  from: number
  slice: {
    size: number
    content: { textBetween: (a: number, b: number, br: string, leaf: string) => string }
  }
}
type FakeTr = {
  docChanged: boolean
  selectionSet: boolean
  mapping: FakeMapping
  steps: FakeStep[]
}
type FakeView = {
  coordsAtPos: (pos: number) => { left: number; bottom: number }
  state: FakeState
}
type PluginSpec = {
  state: {
    init: () => TriggerState
    apply: (tr: FakeTr, prev: TriggerState, old: FakeState, next: FakeState) => TriggerState
  }
  view: (v: FakeView) => { update: (v: FakeView, prev: FakeState) => void; destroy: () => void }
}

// ---------------------------------------------------------------------------
// Captured spec
// ---------------------------------------------------------------------------

let capturedSpec: PluginSpec | null = null

vi.mock('prosemirror-state', () => ({
  PluginKey: vi.fn(function (this: { getState: typeof getStateSpy }, _name: string) {
    this.getState = getStateSpy
  }),
  Plugin: vi.fn(function (this: unknown, spec: PluginSpec) {
    capturedSpec = spec
  }),
  TextSelection: { near: vi.fn((pos: unknown) => ({ _kind: 'sel', pos })) },
}))

vi.mock('prosemirror-transform', () => {
  // MockReplaceStep is defined in vi.hoisted above and is available here
  // because vi.hoisted blocks are evaluated before vi.mock factories.
  return { ReplaceStep: MockReplaceStep }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(
  text: string,
  head: number,
  opts: {
    parentOffset?: number
    parentTypeName?: string
    inlineCodeActive?: boolean
  } = {}
): FakeState {
  const { parentOffset = head, parentTypeName = 'paragraph', inlineCodeActive = false } = opts

  const inlineCodeMark: FakeMarkType = {
    name: 'inlineCode',
    isInSet: (marks: FakeMark[]) => marks.some((m) => m.type.name === 'inlineCode'),
  }

  return {
    doc: {
      resolve(pos: number): FakeResolvedPos {
        return {
          parentOffset: pos === 0 ? 0 : parentOffset,
          parent: { type: { name: parentTypeName } },
          marks: () => (inlineCodeActive ? [{ type: inlineCodeMark }] : []),
        }
      },
      textBetween(from: number, to: number): string {
        return text.slice(from, to)
      },
    },
    schema: {
      marks: inlineCodeActive ? { inlineCode: inlineCodeMark } : {},
    },
    selection: { from: head, empty: head === 0 },
  }
}

// Build a step that passes the `instanceof ReplaceStep` check in the plugin.
function makeInsertStep(from: number, inserted: string): FakeStep {
  return new MockReplaceStep(from, from, {
    size: inserted.length,
    content: { textBetween: () => inserted },
  })
}

/** Identity mapping — no position remapping needed for simple inserts. */
function identityMapping(): FakeMapping {
  return {
    mapResult: (pos: number, _bias: number) => ({ deleted: false, pos }),
    map: (pos: number, _bias: number) => pos,
    slice: (_from: number) => identityMapping(),
  }
}

/**
 * Build a transaction that inserted `inserted` at `from` in the new doc.
 */
function insertTr(from: number, inserted: string): FakeTr {
  return {
    docChanged: true,
    selectionSet: true,
    mapping: identityMapping(),
    steps: [makeInsertStep(from, inserted)],
  }
}

/** Selection-only change (no doc change). */
function selectionTr(): FakeTr {
  return {
    docChanged: false,
    selectionSet: true,
    mapping: identityMapping(),
    steps: [],
  }
}

/** No-op transaction (neither doc nor selection changed). */
function noopTr(): FakeTr {
  return {
    docChanged: false,
    selectionSet: false,
    mapping: identityMapping(),
    steps: [],
  }
}

function makeView(state: FakeState): FakeView {
  return {
    coordsAtPos: (_pos: number) => ({ left: 10, bottom: 20 }),
    state,
  }
}

// ---------------------------------------------------------------------------
// Import AFTER mocks
// ---------------------------------------------------------------------------

import { mentionTrigger } from '../../lib/pmMentionTrigger'

// ---------------------------------------------------------------------------
// Helpers that exercise the plugin at the spec level
// ---------------------------------------------------------------------------

/**
 * Invoke `spec.state.apply` with a "fresh insert of `@` at position `atPos`"
 * transaction and return the resulting TriggerState.
 */
function applyInsertAt(
  atPos: number,
  newState: FakeState,
  prev: TriggerState = INACTIVE
): TriggerState {
  return capturedSpec!.state.apply(insertTr(atPos, '@'), prev, newState, newState)
}

function makeCallbacks() {
  return {
    onOpen: vi.fn<(from: number, anchor: { x: number; y: number }) => void>(),
    onUpdate: vi.fn<(query: string, anchor: { x: number; y: number }) => void>(),
    onClose: vi.fn<() => void>(),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pmMentionTrigger — state.apply (pure transitions)', () => {
  beforeEach(() => {
    capturedSpec = null
    getStateSpy.mockReset()
  })

  it('activates when @ is inserted at pos 0 (start of block)', () => {
    mentionTrigger({ onOpen: vi.fn(), onUpdate: vi.fn(), onClose: vi.fn() })
    const state = makeState('@', 1, { parentOffset: 0 })
    const next = applyInsertAt(0, state)
    expect(next).toMatchObject({ active: true, from: 0, query: '' })
  })

  it('activates when @ follows a whitespace character', () => {
    mentionTrigger({ onOpen: vi.fn(), onUpdate: vi.fn(), onClose: vi.fn() })
    // text: "hello @", head at 7, parentOffset=7 (> 0, triggers textBetween check)
    const state = makeState('hello @', 7, { parentOffset: 7 })
    const next = applyInsertAt(6, state)
    expect(next).toMatchObject({ active: true, from: 6, query: '' })
  })

  it('does NOT activate when @ follows a non-whitespace character', () => {
    mentionTrigger({ onOpen: vi.fn(), onUpdate: vi.fn(), onClose: vi.fn() })
    // text: "user@", head at 5 — no whitespace before @
    const state = makeState('user@', 5, { parentOffset: 5 })
    const next = applyInsertAt(4, state)
    expect(next).toEqual(INACTIVE)
  })

  it('does NOT activate when @ is inside a code_block node', () => {
    mentionTrigger({ onOpen: vi.fn(), onUpdate: vi.fn(), onClose: vi.fn() })
    const state = makeState(' @', 2, { parentOffset: 2, parentTypeName: 'code_block' })
    const next = applyInsertAt(1, state)
    expect(next).toEqual(INACTIVE)
  })

  it('does NOT activate when inlineCode mark is active at the @ position', () => {
    mentionTrigger({ onOpen: vi.fn(), onUpdate: vi.fn(), onClose: vi.fn() })
    const state = makeState(' @', 2, { parentOffset: 2, inlineCodeActive: true })
    const next = applyInsertAt(1, state)
    expect(next).toEqual(INACTIVE)
  })

  it('does NOT activate when @ sits in a URL run (e.g. after https://x.com/ )', () => {
    mentionTrigger({ onOpen: vi.fn(), onUpdate: vi.fn(), onClose: vi.fn() })
    // "see https://x.com/ @" — @ at pos 20, preceding non-ws run is "https://x.com/"
    const text = 'see https://x.com/ @'
    const state = makeState(text, 20, { parentOffset: 20 })
    const next = applyInsertAt(19, state)
    expect(next).toEqual(INACTIVE)
  })

  it('tracks query as characters are typed after @', () => {
    mentionTrigger({ onOpen: vi.fn(), onUpdate: vi.fn(), onClose: vi.fn() })

    // Open with @
    const openState = makeState('@', 1, { parentOffset: 0 })
    let prev = applyInsertAt(0, openState)
    expect(prev).toMatchObject({ active: true, from: 0, query: '' })

    // Type 'f'
    const state2 = makeState('@f', 2, { parentOffset: 0 })
    const tr2: FakeTr = {
      ...insertTr(1, 'f'),
      mapping: {
        mapResult: (_pos: number, _bias: number) => ({ deleted: false, pos: 0 }),
        map: (pos: number) => pos,
        slice: () => identityMapping(),
      },
    }
    prev = capturedSpec!.state.apply(tr2, prev, state2, state2)
    expect(prev).toMatchObject({ active: true, from: 0, query: 'f' })

    // Type 'oo'
    const state3 = makeState('@foo', 4, { parentOffset: 0 })
    const tr3: FakeTr = {
      ...insertTr(2, 'oo'),
      mapping: {
        mapResult: (_pos: number, _bias: number) => ({ deleted: false, pos: 0 }),
        map: (pos: number) => pos,
        slice: () => identityMapping(),
      },
    }
    prev = capturedSpec!.state.apply(tr3, prev, state3, state3)
    expect(prev).toMatchObject({ active: true, from: 0, query: 'foo' })
  })

  it('deactivates when the @ sigil is deleted (mapping.deleted = true)', () => {
    mentionTrigger({ onOpen: vi.fn(), onUpdate: vi.fn(), onClose: vi.fn() })
    const prevActive: TriggerState = { active: true, from: 0, query: 'f' }
    const emptyState = makeState('', 0, { parentOffset: 0 })

    // Transaction where the @ position is deleted
    const deleteTr: FakeTr = {
      docChanged: true,
      selectionSet: true,
      mapping: {
        mapResult: (_pos: number, _bias: number) => ({ deleted: true, pos: 0 }),
        map: (pos: number) => pos,
        slice: () => identityMapping(),
      },
      steps: [], // no new @ inserted
    }
    const next = capturedSpec!.state.apply(deleteTr, prevActive, emptyState, emptyState)
    expect(next).toEqual(INACTIVE)
  })

  it('deactivates when whitespace is inserted into the query', () => {
    mentionTrigger({ onOpen: vi.fn(), onUpdate: vi.fn(), onClose: vi.fn() })
    const prevActive: TriggerState = { active: true, from: 0, query: '' }
    // After typing a space: "@ " — textBetween(1, 2) = ' '
    const stateWithSpace = makeState('@ ', 2, { parentOffset: 0 })
    const spaceTr: FakeTr = {
      docChanged: true,
      selectionSet: true,
      mapping: {
        mapResult: (_pos: number, _bias: number) => ({ deleted: false, pos: 0 }),
        map: (pos: number) => pos,
        slice: () => identityMapping(),
      },
      steps: [makeInsertStep(1, ' ')],
    }
    const next = capturedSpec!.state.apply(spaceTr, prevActive, stateWithSpace, stateWithSpace)
    expect(next).toEqual(INACTIVE)
  })

  it('deactivates when cursor moves before the @ position', () => {
    mentionTrigger({ onOpen: vi.fn(), onUpdate: vi.fn(), onClose: vi.fn() })
    const prevActive: TriggerState = { active: true, from: 6, query: '' }
    // Cursor jumps to pos 2 — before @
    const stateMovedLeft = makeState('hello @', 2, { parentOffset: 2 })
    const next = capturedSpec!.state.apply(
      selectionTr(),
      prevActive,
      stateMovedLeft,
      stateMovedLeft
    )
    expect(next).toEqual(INACTIVE)
  })

  it('returns same reference when nothing changed (fast path)', () => {
    mentionTrigger({ onOpen: vi.fn(), onUpdate: vi.fn(), onClose: vi.fn() })
    const state = makeState('', 0)
    const result = capturedSpec!.state.apply(noopTr(), INACTIVE, state, state)
    // Fast path returns the exact same reference
    expect(result).toBe(INACTIVE)
  })
})

// ---------------------------------------------------------------------------
// View-level effect tests (onOpen / onUpdate / onClose dispatch)
// ---------------------------------------------------------------------------

describe('pmMentionTrigger — view effect (callbacks)', () => {
  let cbs: ReturnType<typeof makeCallbacks>
  let viewInstance: ReturnType<NonNullable<typeof capturedSpec>['view']>
  let view: FakeView

  beforeEach(() => {
    capturedSpec = null
    getStateSpy.mockReset()
    cbs = makeCallbacks()
    mentionTrigger(cbs)

    const state = makeState('', 0)
    view = makeView(state)
    // Initialise view with INACTIVE so the view's internal `prev` starts inactive
    getStateSpy.mockReturnValue(INACTIVE)
    viewInstance = capturedSpec!.view(view)
  })

  function push(s: TriggerState) {
    getStateSpy.mockReturnValue(s)
    viewInstance.update(view, view.state)
  }

  it('calls onOpen when transitioning inactive → active', () => {
    push({ active: true, from: 5, query: '' })
    expect(cbs.onOpen).toHaveBeenCalledWith(5, { x: 10, y: 20 })
    expect(cbs.onClose).not.toHaveBeenCalled()
  })

  it('calls onUpdate when query changes while staying active', () => {
    push({ active: true, from: 5, query: '' })
    cbs.onOpen.mockClear()
    push({ active: true, from: 5, query: 'f' })
    expect(cbs.onUpdate).toHaveBeenCalledWith('f', expect.any(Object))
    expect(cbs.onOpen).not.toHaveBeenCalled()
  })

  it('calls onOpen + onUpdate when opening with a non-empty initial query', () => {
    push({ active: true, from: 0, query: 'foo' })
    expect(cbs.onOpen).toHaveBeenCalledWith(0, { x: 10, y: 20 })
    expect(cbs.onUpdate).toHaveBeenCalledWith('foo', expect.any(Object))
  })

  it('calls onClose when transitioning active → inactive', () => {
    push({ active: true, from: 5, query: '' })
    cbs.onOpen.mockClear()
    push(INACTIVE)
    expect(cbs.onClose).toHaveBeenCalled()
    expect(cbs.onOpen).not.toHaveBeenCalled()
  })

  it('calls onClose on destroy when trigger was active', () => {
    push({ active: true, from: 0, query: '' })
    cbs.onClose.mockClear()
    viewInstance.destroy()
    expect(cbs.onClose).toHaveBeenCalled()
  })

  it('does NOT call onClose on destroy when trigger was inactive', () => {
    push(INACTIVE)
    viewInstance.destroy()
    expect(cbs.onClose).not.toHaveBeenCalled()
  })

  it('does NOT fire any callback on repeated identical active state', () => {
    push({ active: true, from: 5, query: 'ab' })
    cbs.onOpen.mockClear()
    cbs.onUpdate.mockClear()
    push({ active: true, from: 5, query: 'ab' })
    expect(cbs.onUpdate).not.toHaveBeenCalled()
    expect(cbs.onOpen).not.toHaveBeenCalled()
    expect(cbs.onClose).not.toHaveBeenCalled()
  })
})
