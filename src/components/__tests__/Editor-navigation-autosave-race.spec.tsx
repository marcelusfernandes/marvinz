// @vitest-environment jsdom
//
// Regression coverage for issue #560, scenario 3 (team-lead priority,
// "the data-loss the react-dev change prevents"): a pending autosave
// scheduled while editing one file must never write that file's stale
// content under a DIFFERENT file's path after in-tab navigation swaps the
// same mounted Editor from A to B.
//
// Mechanism: scheduleSave (Editor.tsx) always arms a SAVE_DEBOUNCE_MS
// setTimeout on every keystroke; the version-bump reset effect that fires on
// navigation does NOT cancel that pending timer. When it later fires,
// `runSave` calls `onSaveRef.current(latestValue.current)` — both refs are
// unconditionally kept current by earlier effects in the same commit, so if
// (and only if) the reset effect correctly reseeds `latestValue.current` to
// the new file's own content before that stale timer fires, the eventual
// (redundant) autosave writes B's own content, never A's stale edit. Without
// the version bump (pre-fix), `latestValue.current` would still hold A's
// edited text, and the stale timer would write it to B's path — a silent,
// destructive overwrite of a file the user never touched.
//
// Strategy: mount the REAL Editor (CodeMirror mocked, per
// Editor-drop.spec.tsx / Editor-reset-effect.spec.tsx pattern). Type to arm
// the debounce timer, then rerender with a new filePath + version bump +
// initialContent (exactly what App.tsx's goBack/goForward/navigateInActiveTab
// /navigateOrOpen now do), wait past SAVE_DEBOUNCE_MS, and assert onSave is
// never called with the stale pre-navigation content.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Module-level shared object — must NOT be vi.hoisted() (see Editor-drop.spec.tsx).
// ---------------------------------------------------------------------------

let lastCmProps: { value: string; onChange: (next: string) => void } | null = null

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

vi.mock('@codemirror/commands', () => ({
  undo: () => {},
  redo: () => {},
  selectAll: () => {},
  undoDepth: () => 0,
  redoDepth: () => 0,
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

vi.mock('@uiw/react-codemirror', () => ({
  default: (props: { value: string; onChange?: (v: string) => void }) => {
    lastCmProps = {
      value: props.value,
      onChange: (next: string) => props.onChange?.(next),
    }
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

import { Editor } from '../Editor'

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
// (our prop-capturing stub) renders directly. Matches Editor-drop.spec.tsx.
// saveMode defaults to 'auto' (Editor.tsx default param), so typing arms the
// debounce timer without an explicit prop.
// ---------------------------------------------------------------------------

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
    ...overrides,
  }
}

beforeEach(() => {
  setupMarvinMock()
  lastCmProps = null
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('A pending autosave must never write the old file content under the new path after in-tab navigation (issue #560)', () => {
  it("typing in A, then navigating to B (version bump) before the debounce elapses saves only B's own content", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(<Editor {...defaultProps({ onSave })} />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    // Type in A — arms the 600ms autosave debounce timer.
    act(() => {
      lastCmProps?.onChange('edited content for A')
    })
    expect(lastCmProps?.value).toBe('edited content for A')

    // Navigate to B before the debounce elapses: same contract goBack/
    // goForward/navigateInActiveTab/navigateOrOpen now honor — filePath AND
    // version change together, initialContent is B's own fresh content.
    act(() => {
      rerender(
        <Editor
          {...defaultProps({
            onSave,
            filePath: '/vault/note-b.ts',
            version: 2,
            initialContent: 'content B',
          })}
        />
      )
    })
    // The reset effect must have reseeded to B's own content immediately.
    expect(lastCmProps?.value).toBe('content B')

    // Let the still-pending debounce timer (armed while on A) fire.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700))
    })

    // The stale timer must never write A's leftover content anywhere.
    const calledWithStaleContent = onSave.mock.calls.some(
      (call) => call[0] === 'edited content for A'
    )
    expect(calledWithStaleContent).toBe(false)

    // If the stale timer did fire (it does — nothing cancels it), it must
    // have saved B's own (already-reseeded) content, never a mix or a
    // leftover from A. This is the redundant-but-harmless echo write the
    // fix produces, as opposed to the destructive cross-file overwrite it
    // replaces.
    if (onSave.mock.calls.length > 0) {
      expect(onSave).toHaveBeenCalledWith('content B')
    }
  })
})
