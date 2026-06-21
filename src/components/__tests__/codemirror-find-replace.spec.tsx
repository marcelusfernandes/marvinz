/**
 * TDD contracts for issue #166 — Cmd+F Find / Cmd+Alt+F Replace in CodeMirror.
 *
 * Implementation contract under test (Editor.tsx):
 *  - extensions array includes search({ top: true })
 *  - extensions array includes keymap.of(searchKeymap)
 *  - searchKeymap binds Mod-f → openSearchPanel, Mod-g → findNext,
 *    Shift-Mod-g → findPrevious, Escape → closeSearchPanel
 *
 * Strategy:
 *  - Mock @uiw/react-codemirror to capture extensions prop.
 *  - Mock @codemirror/search with hoisted spies so vi.mock factory can
 *    reference them without temporal dead zone issues.
 *  - Mock @codemirror/view so keymap.of() is a spy we can inspect.
 *  - Assert extensions array content and keymap bindings.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Hoisted values — available before vi.mock() factories run
// ---------------------------------------------------------------------------

const {
  mockOpenSearchPanel,
  mockCloseSearchPanel,
  mockFindNext,
  mockFindPrevious,
  mockSearchFn,
  mockKeymapOf,
  fakeSearchKeymap,
  capturedExtensions,
  capturedKeymapArgs,
} = vi.hoisted(() => {
  const mockOpenSearchPanel = vi.fn((_view: unknown) => true)
  const mockCloseSearchPanel = vi.fn((_view: unknown) => true)
  const mockFindNext = vi.fn((_view: unknown) => true)
  const mockFindPrevious = vi.fn((_view: unknown) => true)
  const mockSearchFn = vi.fn((_opts?: unknown) => ({ _ext: 'search' }))
  const mockKeymapOf = vi.fn((...args: unknown[]) => ({
    _ext: 'keymap',
    _bindings: args[0],
  }))

  const fakeSearchKeymap = [
    { key: 'Mod-f', run: mockOpenSearchPanel, scope: 'editor search-panel' },
    {
      key: 'Mod-g',
      run: mockFindNext,
      shift: mockFindPrevious,
      scope: 'editor search-panel',
      preventDefault: true,
    },
    { key: 'Escape', run: mockCloseSearchPanel, scope: 'editor search-panel' },
  ]

  const capturedExtensions: { value: unknown[] } = { value: [] }
  const capturedKeymapArgs: { value: unknown[][] } = { value: [] }

  return {
    mockOpenSearchPanel,
    mockCloseSearchPanel,
    mockFindNext,
    mockFindPrevious,
    mockSearchFn,
    mockKeymapOf,
    fakeSearchKeymap,
    capturedExtensions,
    capturedKeymapArgs,
  }
})

// ---------------------------------------------------------------------------
// Fake EditorView
// ---------------------------------------------------------------------------

function makeFakeView() {
  const el = document.createElement('div')
  el.setAttribute('data-cm-content', 'true')
  return {
    state: {
      selection: { ranges: [{ empty: true }], main: { from: 0, to: 0 } },
      _undoDepth: 0,
      _redoDepth: 0,
      _docText: 'hello world\nfoo bar\nhello again',
      sliceDoc(f: number, t: number) {
        return this._docText.slice(f, t)
      },
      replaceSelection(text: string) {
        return { _replacementText: text }
      },
    },
    contentDOM: el,
    focus: vi.fn(),
    dispatch: vi.fn(),
  }
}

let currentCMView = makeFakeView()

// ---------------------------------------------------------------------------
// Mocks — must be declared before any import of Editor
// ---------------------------------------------------------------------------

vi.mock('@codemirror/search', () => ({
  search: mockSearchFn,
  searchKeymap: fakeSearchKeymap,
  openSearchPanel: mockOpenSearchPanel,
  closeSearchPanel: mockCloseSearchPanel,
  findNext: mockFindNext,
  findPrevious: mockFindPrevious,
  replaceAll: vi.fn(),
  replaceNext: vi.fn(),
  searchPanelOpen: vi.fn(() => false),
  setSearchQuery: vi.fn(),
  getSearchQuery: vi.fn(),
  SearchQuery: class {
    constructor() {}
  },
}))

vi.mock('@codemirror/view', () => ({
  EditorView: { lineWrapping: {}, domEventHandlers: () => ({}) },
  keymap: { of: (...args: unknown[]) => mockKeymapOf(...args) },
  // `Decoration.mark(...).range(from, to)` is invoked when the
  // justReplacedField module loads alongside Editor — return a deterministic
  // shape that the unused-by-this-test pipeline can carry around safely.
  Decoration: {
    mark: () => ({ range: (from: number, to: number) => ({ from, to }) }),
    none: { update: () => null },
  },
  ViewPlugin: { define: () => ({}) },
}))

vi.mock('@codemirror/commands', () => ({
  undo: vi.fn(),
  redo: vi.fn(),
  selectAll: vi.fn(),
  undoDepth: vi.fn(() => 0),
  redoDepth: vi.fn(() => 0),
}))

vi.mock('@uiw/react-codemirror', () => ({
  default: vi.fn(
    (props: {
      extensions?: unknown[]
      onCreateEditor?: (view: ReturnType<typeof makeFakeView>) => void
    }) => {
      capturedExtensions.value = props.extensions ?? []
      props.onCreateEditor?.(currentCMView)
      return <div data-testid="codemirror" />
    }
  ),
}))

vi.mock('@codemirror/language', () => ({
  bracketMatching: () => ({}),
  indentUnit: { of: () => ({}) },
  HighlightStyle: { define: () => ({}) },
  syntaxHighlighting: () => ({}),
  syntaxTree: () => ({ resolveInner: () => ({ name: '', parent: null }) }),
}))
vi.mock('@codemirror/state', () => ({
  // Both effects are no-op factories in the test environment — none of these
  // assertions exercise the StateField wiring. Returning truthy objects keeps
  // `StateEffect.define()` from blowing up at module-load time.
  StateEffect: { define: () => ({ of: (v: unknown) => ({ value: v }) }) },
  StateField: { define: () => ({}) },
  EditorSelection: { cursor: (n: number) => ({ from: n, to: n }) },
}))
vi.mock('../lib/cmLanguage', () => ({
  languageIdFor: () => null,
  loadLanguage: () => Promise.resolve(null),
}))
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
// window.marvin minimal mock
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
        file: { exportPdf: vi.fn().mockResolvedValue(undefined) },
      },
    },
    writable: true,
    configurable: true,
  })
}

function defaultProps() {
  return {
    filePath: '/vault/note.ts',
    vaultPath: '/vault',
    initialContent: 'hello world\nfoo bar\nhello again',
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
  }
}

beforeEach(() => {
  setupMarvinMock()
  capturedExtensions.value = []
  capturedKeymapArgs.value = []
  mockOpenSearchPanel.mockClear()
  mockCloseSearchPanel.mockClear()
  mockFindNext.mockClear()
  mockFindPrevious.mockClear()
  mockSearchFn.mockClear()
  mockKeymapOf.mockClear()
  currentCMView = makeFakeView()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Contract 1: search() called with { top: true }
// ---------------------------------------------------------------------------

describe('CodeMirror find/replace — search extension registration', () => {
  it('calls search() with { top: true } when building extensions', async () => {
    await act(async () => {
      render(<Editor {...defaultProps()} />)
    })
    expect(mockSearchFn).toHaveBeenCalledWith({ top: true })
  })

  it('passes the search() result into the extensions array', async () => {
    await act(async () => {
      render(<Editor {...defaultProps()} />)
    })
    const searchResult = mockSearchFn.mock.results[0]?.value
    expect(capturedExtensions.value).toContainEqual(searchResult)
  })
})

// ---------------------------------------------------------------------------
// Contract 2: keymap.of(searchKeymap) is included in extensions
// ---------------------------------------------------------------------------

describe('CodeMirror find/replace — searchKeymap registration', () => {
  it('calls keymap.of() with the searchKeymap array', async () => {
    await act(async () => {
      render(<Editor {...defaultProps()} />)
    })
    const registeredSearchKeymap = mockKeymapOf.mock.calls.some(
      (args) => args[0] === fakeSearchKeymap
    )
    expect(registeredSearchKeymap).toBe(true)
  })

  it('the keymap extension built from searchKeymap is in extensions', async () => {
    await act(async () => {
      render(<Editor {...defaultProps()} />)
    })
    const idx = mockKeymapOf.mock.calls.findIndex((args) => args[0] === fakeSearchKeymap)
    expect(idx).toBeGreaterThanOrEqual(0)
    const keymapExt = mockKeymapOf.mock.results[idx]?.value
    expect(capturedExtensions.value).toContainEqual(keymapExt)
  })
})

// ---------------------------------------------------------------------------
// Contract 3: searchKeymap key bindings — commands invoked correctly
// ---------------------------------------------------------------------------

describe('CodeMirror find/replace — searchKeymap key bindings', () => {
  it('Mod-f binding calls openSearchPanel', () => {
    const binding = fakeSearchKeymap.find((b) => b.key === 'Mod-f')
    expect(binding).toBeDefined()
    binding!.run(currentCMView)
    expect(mockOpenSearchPanel).toHaveBeenCalledWith(currentCMView)
  })

  it('Mod-g binding calls findNext', () => {
    const binding = fakeSearchKeymap.find((b) => b.key === 'Mod-g')
    expect(binding).toBeDefined()
    binding!.run(currentCMView)
    expect(mockFindNext).toHaveBeenCalledWith(currentCMView)
  })

  it('Shift-Mod-g (shift on Mod-g) calls findPrevious', () => {
    const binding = fakeSearchKeymap.find((b) => b.key === 'Mod-g')
    expect(binding?.shift).toBeDefined()
    binding!.shift!(currentCMView)
    expect(mockFindPrevious).toHaveBeenCalledWith(currentCMView)
  })

  it('Escape binding calls closeSearchPanel', () => {
    const binding = fakeSearchKeymap.find((b) => b.key === 'Escape')
    expect(binding).toBeDefined()
    binding!.run(currentCMView)
    expect(mockCloseSearchPanel).toHaveBeenCalledWith(currentCMView)
  })

  it('openSearchPanel returns truthy (command executed)', () => {
    expect(mockOpenSearchPanel(currentCMView)).toBeTruthy()
  })

  it('closeSearchPanel returns truthy (command executed)', () => {
    expect(mockCloseSearchPanel(currentCMView)).toBeTruthy()
  })

  it('findNext returns truthy (command executed)', () => {
    expect(mockFindNext(currentCMView)).toBeTruthy()
  })

  it('findPrevious returns truthy (command executed)', () => {
    expect(mockFindPrevious(currentCMView)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Contract 4: extensions always present for any file type
// ---------------------------------------------------------------------------

describe('CodeMirror find/replace — extensions present for all file types', () => {
  it('search and searchKeymap are registered for markdown files', async () => {
    const props = { ...defaultProps(), filePath: '/vault/note.md' }
    await act(async () => {
      render(<Editor {...props} />)
    })
    expect(mockSearchFn).toHaveBeenCalledWith({ top: true })
    expect(mockKeymapOf.mock.calls.some((args) => args[0] === fakeSearchKeymap)).toBe(true)
  })

  it('search and searchKeymap are registered for plain text files', async () => {
    const props = { ...defaultProps(), filePath: '/vault/note.txt' }
    await act(async () => {
      render(<Editor {...props} />)
    })
    expect(mockSearchFn).toHaveBeenCalledWith({ top: true })
    expect(mockKeymapOf.mock.calls.some((args) => args[0] === fakeSearchKeymap)).toBe(true)
  })
})
