// @vitest-environment jsdom
//
// Regression coverage for issue #560 (Editor reset-effect AC): "the Editor
// reset effect no longer clobbers the live buffer on a path-only change."
//
// Editor.tsx seeds `value`/`latestValue`/`savedContentRef` from
// `initialContent` in a useEffect. Pre-fix that effect fired on ANY
// `filePath` OR `initialContent` change — so a rename (filePath changes,
// `initialContent`/`version` do not) reset the live buffer to the stale
// value mid-edit, discarding in-progress work. The fix gates the reset on a
// `version` bump instead (disk-accept / external-refresh / snapshot
// restore) so save-driven advancement and path-only renames never reseed.
//
// Strategy: mount the REAL Editor (not the App-level stub used in
// App-mru-eviction.spec.tsx / App-rename-buffer.spec.tsx), reusing the
// CodeMirror-mocking pattern from Editor-drop.spec.tsx. `@uiw/react-codemirror`
// is replaced with a prop-capturing stub so tests can read the live `value`
// and drive `onChange` (== typing) directly, without a real contentEditable
// surface — this is the "test the handler/state directly" fallback for
// jsdom's lack of CodeMirror/contentEditable support.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from '@testing-library/react'
import { renderWithAppContext as render } from './renderWithAppContext'

// ---------------------------------------------------------------------------
// Module-level shared object — must NOT be vi.hoisted() (storing a React
// component closure inside a vi.hoisted() object makes Vitest's reactive
// proxy deep-traverse it and OOM; see Editor-drop.spec.tsx).
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

// Prop-capturing stub: exposes the live `value` CodeMirror would render and
// lets tests fire `onChange` to simulate typing, without a real editor view.
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
// ---------------------------------------------------------------------------

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    filePath: '/vault/note-a.ts',
    vaultPath: '/vault',
    initialContent: 'original content',
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

describe('Editor reset effect must not clobber the live buffer on a path-only change (issue #560)', () => {
  it('typing, then filePath alone changing (rename — same version) preserves the edited value', async () => {
    const { rerender } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(lastCmProps?.value).toBe('original content')

    // Simulate typing.
    act(() => {
      lastCmProps?.onChange('edited content')
    })
    expect(lastCmProps?.value).toBe('edited content')

    // Simulate a rename: only filePath changes. `version` and
    // `initialContent` are untouched — exactly what renameInTabs does at
    // the App level (it never bumps `version` for a path-only move).
    act(() => {
      rerender(<Editor {...defaultProps({ filePath: '/vault/note-a-renamed.ts' })} />)
    })

    // Must still show the edited content, not reset to 'original content'.
    expect(lastCmProps?.value).toBe('edited content')
  })

  it('a version bump (disk-accept / external-refresh / snapshot restore) still resets the buffer', async () => {
    const { rerender } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    act(() => {
      lastCmProps?.onChange('edited content')
    })
    expect(lastCmProps?.value).toBe('edited content')

    // A version bump is the one legitimate hard reset (e.g. handleAcceptDisk
    // advancing NoteTab.version at App.tsx:1501-1510).
    act(() => {
      rerender(
        <Editor {...defaultProps({ version: 2, initialContent: 'disk-accepted content' })} />
      )
    })

    expect(lastCmProps?.value).toBe('disk-accepted content')
  })
})
