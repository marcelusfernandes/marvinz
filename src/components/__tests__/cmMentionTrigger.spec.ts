// @vitest-environment jsdom

/**
 * Unit tests for the mentionTrigger CodeMirror extension (src/lib/cmMentionTrigger.ts).
 *
 * Strategy: intercept ViewPlugin.define to capture the plugin factory, then
 * invoke `plugin.update(fakeViewUpdate)` directly — no real CM DOM needed.
 * syntaxTree is mocked to control whether the cursor is inside a code node.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Captured plugin factory — populated when mentionTrigger() is called
// ---------------------------------------------------------------------------

type PluginInstance = { update: (u: ViewUpdate) => void; destroy?: () => void }
type ViewUpdate = {
  docChanged: boolean
  selectionSet: boolean
  changes: { iterChanges: (cb: IterChangesCb) => void }
  state: FakeState
}
type IterChangesCb = (
  fromA: number,
  toA: number,
  fromB: number,
  toB: number,
  inserted: { toString: () => string },
) => void

type FakeNode = { name: string; parent: FakeNode | null }

// The syntaxTree mock is mutable so individual tests can override node names.
let currentNodeName = ''
let currentParentName: string | null = null

vi.mock('@codemirror/language', () => ({
  syntaxTree: (_state: unknown) => ({
    resolveInner: (_pos: number, _bias: number): FakeNode => ({
      name: currentNodeName,
      parent: currentParentName ? { name: currentParentName, parent: null } : null,
    }),
  }),
  bracketMatching: () => ({}),
  indentUnit: { of: () => ({}) },
  HighlightStyle: { define: () => ({}) },
  syntaxHighlighting: () => ({}),
}))

// ViewPlugin.define captures the factory for direct invocation in tests.
type PluginFactory = (view: FakeView) => PluginInstance
let capturedFactory: PluginFactory | null = null

vi.mock('@codemirror/view', () => ({
  EditorView: { lineWrapping: {}, domEventHandlers: () => ({}) },
  keymap: { of: () => ({}) },
  Decoration: {
    mark: () => ({ range: (f: number, t: number) => ({ f, t }) }),
    none: { update: () => null },
  },
  ViewPlugin: {
    define: (factory: PluginFactory) => {
      capturedFactory = factory
      return {}
    },
  },
}))

// ---------------------------------------------------------------------------
// Fake types
// ---------------------------------------------------------------------------

type FakeDoc = {
  text: string
  sliceString: (from: number, to: number) => string
  length: number
}

type FakeState = {
  doc: FakeDoc
  selection: { main: { head: number } }
}

type FakeView = {
  coordsAtPos: (pos: number) => { left: number; bottom: number } | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(text: string): FakeDoc {
  return {
    text,
    sliceString(from: number, to: number) {
      return text.slice(from, to)
    },
    get length() {
      return text.length
    },
  }
}

function makeState(text: string, head: number): FakeState {
  return {
    doc: makeDoc(text),
    selection: { main: { head } },
  }
}

function makeView(): FakeView {
  return {
    coordsAtPos: (_pos: number) => ({ left: 10, bottom: 20 }),
  }
}

/**
 * Build a ViewUpdate that inserts `inserted` at `fromB` in the new doc.
 * `state` represents the new document state after the change.
 */
function insertUpdate(inserted: string, fromB: number, state: FakeState): ViewUpdate {
  return {
    docChanged: true,
    selectionSet: true,
    changes: {
      iterChanges(cb) {
        cb(fromB, fromB, fromB, fromB + inserted.length, { toString: () => inserted })
      },
    },
    state,
  }
}

/** A selection-only update (no doc change). */
function selectionUpdate(state: FakeState): ViewUpdate {
  return {
    docChanged: false,
    selectionSet: true,
    changes: { iterChanges: () => {} },
    state,
  }
}

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { mentionTrigger } from '../../lib/cmMentionTrigger'

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('mentionTrigger extension', () => {
  let onOpen: ReturnType<typeof vi.fn<(from: number, anchor: { x: number; y: number }) => void>>
  let onUpdate: ReturnType<typeof vi.fn<(query: string, anchor: { x: number; y: number }) => void>>
  let onClose: ReturnType<typeof vi.fn<() => void>>
  let plugin: PluginInstance

  beforeEach(() => {
    capturedFactory = null
    currentNodeName = ''
    currentParentName = null
    onOpen = vi.fn<(from: number, anchor: { x: number; y: number }) => void>()
    onUpdate = vi.fn<(query: string, anchor: { x: number; y: number }) => void>()
    onClose = vi.fn<() => void>()
    // Calling mentionTrigger triggers ViewPlugin.define, capturing the factory.
    mentionTrigger({ onOpen, onUpdate, onClose })
    plugin = capturedFactory!(makeView())
  })

  // 1. @ at start of document activates trigger
  it('activates when @ is inserted at position 0 (start of doc)', () => {
    const state = makeState('@', 1)
    plugin.update(insertUpdate('@', 0, state))
    expect(onOpen).toHaveBeenCalledWith(0, { x: 10, y: 20 })
    expect(onClose).not.toHaveBeenCalled()
  })

  // 2. @ after whitespace activates trigger
  it('activates when @ follows a whitespace character', () => {
    const state = makeState('hello @', 7)
    plugin.update(insertUpdate('@', 6, state))
    expect(onOpen).toHaveBeenCalledWith(6, { x: 10, y: 20 })
    expect(onClose).not.toHaveBeenCalled()
  })

  // 3. @ mid-word (no preceding whitespace) does NOT activate
  it('does NOT activate when @ follows a non-whitespace character', () => {
    const state = makeState('user@', 5)
    plugin.update(insertUpdate('@', 4, state))
    expect(onOpen).not.toHaveBeenCalled()
  })

  // 4. @ inside InlineCode does NOT activate
  it('does NOT activate when @ is inside an InlineCode node', () => {
    currentNodeName = 'InlineCode'
    const state = makeState(' @', 2)
    plugin.update(insertUpdate('@', 1, state))
    expect(onOpen).not.toHaveBeenCalled()
  })

  // 5. @ inside FencedCode does NOT activate
  it('does NOT activate when @ is inside a FencedCode node', () => {
    currentNodeName = 'FencedCode'
    const state = makeState(' @', 2)
    plugin.update(insertUpdate('@', 1, state))
    expect(onOpen).not.toHaveBeenCalled()
  })

  // 5b. @ inside CodeBlock does NOT activate
  it('does NOT activate when @ is inside a CodeBlock node', () => {
    currentNodeName = 'CodeBlock'
    const state = makeState(' @', 2)
    plugin.update(insertUpdate('@', 1, state))
    expect(onOpen).not.toHaveBeenCalled()
  })

  // 6. Query updates as user types after @
  it('calls onUpdate with the growing query as characters are typed', () => {
    // Open with @
    const openState = makeState('@', 1)
    plugin.update(insertUpdate('@', 0, openState))
    expect(onOpen).toHaveBeenCalledWith(0, expect.any(Object))

    // Type 'f'
    const state2 = makeState('@f', 2)
    plugin.update(insertUpdate('f', 1, state2))
    expect(onUpdate).toHaveBeenCalledWith('f', expect.any(Object))

    // Type 'oo'
    const state3 = makeState('@foo', 4)
    plugin.update(insertUpdate('oo', 2, state3))
    expect(onUpdate).toHaveBeenLastCalledWith('foo', expect.any(Object))
  })

  // 7. Backspace consuming the @ closes the trigger
  it('calls onClose when the @ sigil is deleted', () => {
    // First activate
    const openState = makeState('@', 1)
    plugin.update(insertUpdate('@', 0, openState))
    expect(onOpen).toHaveBeenCalled()

    // Delete the @ — doc is now empty, @ is gone
    const afterDelete = makeState('', 0)
    // Backspace: doc changes but @ no longer at position 0
    plugin.update({
      docChanged: true,
      selectionSet: true,
      changes: { iterChanges: () => {} },
      state: afterDelete,
    })
    expect(onClose).toHaveBeenCalled()
  })

  // 8. Whitespace inserted after @ closes the trigger
  it('calls onClose when whitespace is typed into the query', () => {
    // Activate
    const openState = makeState('@', 1)
    plugin.update(insertUpdate('@', 0, openState))
    expect(onOpen).toHaveBeenCalled()

    // Type a space — query contains whitespace → trigger should close
    const stateWithSpace = makeState('@ ', 2)
    plugin.update(insertUpdate(' ', 1, stateWithSpace))
    expect(onClose).toHaveBeenCalled()
  })

  // 9b. URL gating — `@` typed inside a URL run (e.g. after `https://host/`)
  // must not activate, even when preceded by whitespace.
  it('does NOT activate when @ sits after a URL with intervening whitespace', () => {
    // Doc: "see https://example.com/ @" — cursor at the @ (pos 26 after insert)
    const state = makeState('see https://example.com/ @', 26)
    plugin.update(insertUpdate('@', 25, state))
    expect(onOpen).not.toHaveBeenCalled()
  })

  // 10. Cursor jumping out of [from, head] range closes the trigger
  it('calls onClose when the cursor moves before the @ position', () => {
    // Activate on "@" at pos 5
    const state1 = makeState('hello @', 7)
    plugin.update(insertUpdate('@', 6, state1))
    expect(onOpen).toHaveBeenCalledWith(6, expect.any(Object))

    // Move cursor to pos 2 — outside the trigger range [6, head]
    const state2 = makeState('hello @', 2)
    plugin.update(selectionUpdate(state2))
    expect(onClose).toHaveBeenCalled()
  })
})
