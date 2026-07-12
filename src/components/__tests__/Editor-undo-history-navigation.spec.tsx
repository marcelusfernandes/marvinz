// @vitest-environment jsdom
//
// Regression coverage for issue #559 — CodeMirror's EditorView/history
// currently survives in-tab file navigation because `<CodeMirror>`
// (Editor.tsx:1000-1023) carries no `key`, so `@uiw/react-codemirror`
// diffs the incoming `value` prop against the existing view's doc and
// dispatches an ordinary (history-recorded) full-document replace instead
// of remounting with a clean EditorView. That file-swap transaction lands
// on the SAME undo stack as the previous file's real edits, so calling undo
// after navigating can pull the previous file's content into the current
// one.
//
// Agreed fix design (react-dev + team-lead): `key={version}` on
// `<CodeMirror>`, NOT `key={filePath}` — a plain filePath key would also
// reset undo history on a path-only rename (content/version unchanged),
// which is worse UX than necessary. `version` only bumps on a real content
// swap (navigation, disk-accept, external refresh — see #560), so keying on
// it remounts CodeMirror exactly when the doc genuinely changes underneath
// it, and never on a rename or a save (neither bumps version).
//
// Strategy: mount the REAL Editor (CodeMirror mocked, per
// Editor-drop.spec.tsx / Editor-reset-effect.spec.tsx pattern). The
// `@uiw/react-codemirror` mock below is NOT a dumb prop-capturing stub —
// it faithfully models the two behaviors the issue distinguishes:
//   - While the SAME wrapper instance persists across a value-prop change
//     (no remount, i.e. pre-fix — nothing keys `<CodeMirror>` today), it
//     records the change into a SHARED history stack, mirroring
//     useCodeMirror.js's external-value-diff dispatch (the reported bug
//     mechanism).
//   - When React actually unmounts+remounts the wrapper (which `key={version}`
//     forces on a version bump, once the fix lands), a brand-new history
//     stack is created — the fix's intended effect.
// `@codemirror/commands`' `undo`/`redo`/`undoDepth`/`redoDepth` are mocked
// to operate on that same fake history stack via the fake view object
// Editor.tsx receives through `onCreateEditor`. Tests assert `undoDepth`
// directly (not just resulting content) per react-dev's finding: a fix that
// only remounts but resets `value` a tick late (post-commit effect) could
// leave the fresh history with one stray entry (undoDepth 1, not 0) — a
// content-only assertion could pass by accident depending on what that one
// undo happens to do.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useEffect, useRef } from 'react'

// ---------------------------------------------------------------------------
// Module-level shared object — must NOT be vi.hoisted() (see Editor-drop.spec.tsx).
// ---------------------------------------------------------------------------

type FakeCmView = {
  dispatch: (tr: { changes?: { insert: string } }) => void
  state: unknown
  focus: () => void
  _fake: { doc: string; history: string[]; future: string[] }
  _applyUndo: () => boolean
  _applyRedo: () => boolean
}

let lastCmProps: { value: string } | null = null
let lastFakeView: FakeCmView | null = null

// `lastCmProps` must reflect the fake doc even when it's mutated from a ref
// (dispatch/undo/redo, or the cross-file value-diff effect below) — those
// mutations don't trigger a React re-render, so capturing `lastCmProps` only
// in the render body would go stale the moment a mutation happens outside
// of render. Call this after every mutation.
function syncLastCmProps(fake: { doc: string }) {
  lastCmProps = { value: fake.doc }
}

// ---------------------------------------------------------------------------
// Mocks — all before the Editor import
// ---------------------------------------------------------------------------

vi.mock('@codemirror/view', () => ({
  EditorView: {
    lineWrapping: {},
    domEventHandlers: () => ({}),
  },
  keymap: { of: (...args: unknown[]) => ({ _ext: 'keymap', _bindings: args[0] }) },
  Decoration: {
    mark: () => ({ range: (from: number, to: number) => ({ from, to }) }),
    none: { update: () => null },
  },
  ViewPlugin: { define: () => ({}) },
}))

vi.mock('@codemirror/search', () => ({
  search: (_opts?: unknown) => ({ _ext: 'search' }),
  searchKeymap: [],
  openSearchPanel: () => true,
  closeSearchPanel: () => true,
  findNext: () => true,
  findPrevious: () => true,
  replaceAll: () => true,
  replaceNext: () => true,
  searchPanelOpen: () => false,
  setSearchQuery: () => {},
  getSearchQuery: () => ({}),
  SearchQuery: class {
    constructor() {}
  },
}))

// Real undo/redo/undoDepth/redoDepth semantics against the fake view's
// shared history bucket (the crux of what #559 needs to exercise).
vi.mock('@codemirror/commands', () => ({
  undo: (view: FakeCmView) => view._applyUndo(),
  redo: (view: FakeCmView) => view._applyRedo(),
  selectAll: () => {},
  undoDepth: (view: FakeCmView) => view._fake.history.length,
  redoDepth: (view: FakeCmView) => view._fake.future.length,
}))

vi.mock('@codemirror/language', () => ({
  bracketMatching: () => ({}),
  indentUnit: { of: () => ({}) },
  HighlightStyle: { define: () => ({}) },
  syntaxHighlighting: () => ({}),
  syntaxTree: () => ({ resolveInner: () => ({ name: '', parent: null }) }),
}))

vi.mock('@codemirror/state', () => ({
  StateEffect: { define: () => ({ of: (v: unknown) => ({ value: v }) }) },
  StateField: { define: () => ({}) },
  EditorSelection: { cursor: (pos: number) => ({ anchor: pos, head: pos }) },
}))

// Faithful fake: a real per-mount history stack, plus the exact
// cross-instance-persists-until-remounted behavior issue #559 describes.
// Named (capitalized) function expression, not an anonymous arrow, so
// eslint's react-hooks/rules-of-hooks recognizes it as a component and
// allows the useRef/useEffect calls inside.
vi.mock('@uiw/react-codemirror', () => ({
  default: function FakeCodeMirror(props: {
    value: string
    onChange?: (v: string) => void
    onCreateEditor?: (view: FakeCmView) => void
  }) {
    const fakeRef = useRef<{ doc: string; history: string[]; future: string[] } | null>(null)
    if (!fakeRef.current) {
      // Fresh bucket — only happens once per true mount. A `key={filePath}`
      // fix forces React to unmount+remount this wrapper on navigation,
      // which re-triggers this branch with a clean slate.
      fakeRef.current = { doc: props.value, history: [], future: [] }
    }
    const onChangeRef = useRef(props.onChange)
    onChangeRef.current = props.onChange

    // Mirrors useCodeMirror.js:148-166 — an external `value` prop change on
    // an EXISTING (non-remounted) view dispatches an ordinary, history-
    // recorded full-document replace. This is the reported bug mechanism:
    // pre-fix, navigating to a new file lands here instead of remounting.
    useEffect(() => {
      const fake = fakeRef.current!
      if (props.value !== fake.doc) {
        fake.history.push(fake.doc)
        fake.doc = props.value
        fake.future = []
        syncLastCmProps(fake)
      }
    }, [props.value])

    useEffect(() => {
      const fake = fakeRef.current!
      const view: FakeCmView = {
        dispatch: (tr) => {
          if (tr.changes) {
            fake.history.push(fake.doc)
            fake.doc = tr.changes.insert
            fake.future = []
            syncLastCmProps(fake)
            onChangeRef.current?.(fake.doc)
          }
        },
        state: null,
        focus: () => {},
        _fake: fake,
        _applyUndo: () => {
          if (fake.history.length === 0) return false
          fake.future.push(fake.doc)
          fake.doc = fake.history.pop()!
          syncLastCmProps(fake)
          onChangeRef.current?.(fake.doc)
          return true
        },
        _applyRedo: () => {
          if (fake.future.length === 0) return false
          fake.history.push(fake.doc)
          fake.doc = fake.future.pop()!
          syncLastCmProps(fake)
          onChangeRef.current?.(fake.doc)
          return true
        },
      }
      view.state = view
      lastFakeView = view
      props.onCreateEditor?.(view)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    syncLastCmProps(fakeRef.current)
    return <div className="cm-editor" />
  },
}))

vi.mock('../lib/cmLanguage', () => ({
  languageIdFor: () => null,
  loadLanguage: () => Promise.resolve(null),
}))

vi.mock('../lib/cmJustReplacedHighlight', () => ({ justReplacedField: {} }))

vi.mock('../lib/frontmatter', () => ({
  replaceFrontmatter: (c: string) => c,
  serializeFrontmatter: () => '',
  splitFrontmatter: (c: string) => ({ data: null, body: c }),
}))

vi.mock('./Properties', () => ({ Properties: () => null }))
vi.mock('./CsvEditor', () => ({ CsvEditor: () => null }))
vi.mock('./HtmlPreview', () => ({ HtmlPreview: () => null }))
vi.mock('./PathSuggest', () => ({ PathSuggest: () => null }))
vi.mock('./Icon', () => ({ Icon: () => null }))
vi.mock('./LiveMarkdown', () => ({
  LiveMarkdown: () => <div data-testid="live-markdown" />,
}))
vi.mock('./FindReplaceOverlay', () => ({ FindReplaceOverlay: () => null }))
vi.mock('./CodeMirrorFindBar', () => ({ CodeMirrorFindBar: () => null }))
vi.mock('../lib/visualStyle', () => ({ useVisualStyle: () => 'modern' }))
vi.mock('../lib/wikilinks', () => ({
  isWikilinkHref: () => null,
  resolveWikilink: () => null,
}))
vi.mock('../lib/paletteRanker', () => ({}))
vi.mock('./MentionPicker', () => ({ MentionPicker: () => null }))

// ---------------------------------------------------------------------------
// Import Editor after all mocks
// ---------------------------------------------------------------------------

import { Editor, type EditorHandle } from '../Editor'
import { undoDepth } from '@codemirror/commands'
import type { EditorState } from '@codemirror/state'

// `undoDepth` is real-typed to take an `EditorState`, but our mock (above)
// operates on `FakeCmView` (assigned to `undoDepth` at runtime via the
// `vi.mock('@codemirror/commands', ...)` override) — this cast only bridges
// the type gap between the real declaration and the test's fake view; the
// mock ignores the declared param type entirely at runtime.
function undoDepthOf(view: FakeCmView): number {
  return undoDepth(view as unknown as EditorState)
}

// ---------------------------------------------------------------------------
// window.marvin mock
// ---------------------------------------------------------------------------

function setupMarvinMock() {
  Object.defineProperty(globalThis, 'window', {
    value: {
      ...(typeof window !== 'undefined' ? window : {}),
      marvin: {
        app: {
          showContextMenu: vi.fn().mockResolvedValue(null),
          canPaste: vi.fn().mockResolvedValue(false),
        },
        editor: {
          writeClipboard: vi.fn().mockResolvedValue(undefined),
          readClipboard: vi.fn().mockResolvedValue(''),
        },
        shell: { openExternal: vi.fn() },
        file: {
          writeBinary: vi.fn().mockResolvedValue(''),
          exportPdf: vi.fn().mockResolvedValue(undefined),
        },
      },
    },
    writable: true,
    configurable: true,
  })
}

// ---------------------------------------------------------------------------
// Default props — .ts extension forces edit mode (no preview), so CodeMirror
// (our fake) renders directly. Matches Editor-drop.spec.tsx.
// ---------------------------------------------------------------------------

let registeredHandle: EditorHandle | null = null

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    filePath: '/vault/note-a.ts',
    vaultPath: '/vault',
    initialContent: 'content A',
    version: 1,
    geometryKey: 'k',
    paletteItems: [],
    onSave: vi.fn().mockResolvedValue(undefined),
    onBufferChange: vi.fn(),
    onNavigate: vi.fn(),
    canBack: false,
    canForward: false,
    onBack: vi.fn(),
    onForward: vi.fn(),
    onImportToast: vi.fn(),
    onRegisterHandle: (handle: EditorHandle | null) => {
      registeredHandle = handle
    },
    ...overrides,
  }
}

beforeEach(() => {
  setupMarvinMock()
  lastCmProps = null
  lastFakeView = null
  registeredHandle = null
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

function type(text: string) {
  act(() => {
    lastFakeView?.dispatch({ changes: { insert: text } })
  })
}

function callUndo() {
  act(() => {
    registeredHandle?.undo()
  })
}

function callRedo() {
  act(() => {
    registeredHandle?.redo()
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Undo history must not bleed across files on in-tab navigation (issue #559)', () => {
  it("undoDepth resets to 0 immediately after navigating from A to B, and undo never inserts A's content into B", async () => {
    const { rerender } = render(<Editor {...defaultProps()} />)
    await flush()
    expect(lastCmProps?.value).toBe('content A')

    // Type in A — a real, undo-able edit.
    type('edited content for A')
    expect(lastCmProps?.value).toBe('edited content for A')
    expect(undoDepthOf(lastFakeView!)).toBeGreaterThan(0)

    // Navigate to B: same contract goBack/goForward/navigateInActiveTab/
    // navigateOrOpen use post-#560 — filePath + version + initialContent
    // all advance together, same mounted Editor/tab (no tab remount).
    act(() => {
      rerender(
        <Editor
          {...defaultProps({
            filePath: '/vault/note-b.ts',
            version: 2,
            initialContent: 'content B',
          })}
        />
      )
    })
    await flush()
    expect(lastCmProps?.value).toBe('content B')

    // Catches a fix that remounts CodeMirror but resets `value` a tick late
    // (post-commit effect): the fresh history could still end up with one
    // stray entry from that lagged reset (undoDepth 1, not 0).
    expect(undoDepthOf(lastFakeView!)).toBe(0)

    // Undo now, while viewing B — must never resurrect A's content, and
    // with a clean history there should be nothing to undo at all.
    callUndo()

    expect(lastCmProps?.value).not.toBe('edited content for A')
    expect(lastCmProps?.value).toBe('content B')
  })

  it('N undos after navigating never bring the previous file back, in either direction', async () => {
    const { rerender } = render(<Editor {...defaultProps()} />)
    await flush()

    // Build up real history depth in A.
    type('A edit 1')
    type('A edit 2')
    type('A edit 3')

    act(() => {
      rerender(
        <Editor
          {...defaultProps({
            filePath: '/vault/note-b.ts',
            version: 2,
            initialContent: 'content B',
          })}
        />
      )
    })
    await flush()
    expect(undoDepthOf(lastFakeView!)).toBe(0)

    // Undo more times than A's history ever had — must stay on B throughout,
    // never resurrecting any of A's edits.
    for (let i = 0; i < 5; i++) {
      callUndo()
      expect(lastCmProps?.value).toBe('content B')
    }

    // Now the reverse direction: edit B, navigate back to A, undo repeatedly.
    type('B edit 1')
    type('B edit 2')

    act(() => {
      rerender(
        <Editor
          {...defaultProps({
            filePath: '/vault/note-a.ts',
            version: 3,
            initialContent: 'content A (reloaded)',
          })}
        />
      )
    })
    await flush()
    expect(undoDepthOf(lastFakeView!)).toBe(0)

    for (let i = 0; i < 5; i++) {
      callUndo()
      expect(lastCmProps?.value).toBe('content A (reloaded)')
    }
  })

  it('undo/redo for edits within a single file (no navigation) still works in order', async () => {
    render(<Editor {...defaultProps()} />)
    await flush()

    type('first edit')
    type('second edit')
    expect(lastCmProps?.value).toBe('second edit')

    callUndo()
    expect(lastCmProps?.value).toBe('first edit')

    callUndo()
    expect(lastCmProps?.value).toBe('content A')

    callRedo()
    expect(lastCmProps?.value).toBe('first edit')

    callRedo()
    expect(lastCmProps?.value).toBe('second edit')
  })

  it('a save (no version bump) never resets undo history — edits before and after a save remain undoable in order', async () => {
    const { rerender } = render(<Editor {...defaultProps()} />)
    await flush()

    type('edit before save')

    // Simulate the App-level effect of a save completing (#560:
    // handleSave advances NoteTab.content but never bumps version). Same
    // filePath/version, only `initialContent` changes to match what's now
    // on disk — must NOT reset the live CodeMirror doc or its history.
    act(() => {
      rerender(
        <Editor
          {...defaultProps({
            initialContent: 'edit before save',
          })}
        />
      )
    })
    await flush()
    expect(lastCmProps?.value).toBe('edit before save')
    expect(undoDepthOf(lastFakeView!)).toBeGreaterThan(0)

    type('edit after save')
    expect(lastCmProps?.value).toBe('edit after save')

    callUndo()
    expect(lastCmProps?.value).toBe('edit before save')

    callUndo()
    expect(lastCmProps?.value).toBe('content A')
  })

  it('renaming the active file (path-only change, version unchanged) preserves undo history', async () => {
    const { rerender } = render(<Editor {...defaultProps()} />)
    await flush()

    type('edit before rename')
    const depthBeforeRename = undoDepthOf(lastFakeView!)
    expect(depthBeforeRename).toBeGreaterThan(0)

    // Rename contract (#560's renameInTabs): path changes, version and
    // content are carried over unchanged. A `key={version}` CodeMirror must
    // NOT remount here — unlike a naive `key={filePath}`, which would wipe
    // undo history on every rename.
    act(() => {
      rerender(
        <Editor
          {...defaultProps({
            filePath: '/vault/note-a-renamed.ts',
            initialContent: 'edit before rename',
          })}
        />
      )
    })
    await flush()

    expect(undoDepthOf(lastFakeView!)).toBe(depthBeforeRename)
    expect(lastCmProps?.value).toBe('edit before rename')

    callUndo()
    expect(lastCmProps?.value).toBe('content A')
  })
})
