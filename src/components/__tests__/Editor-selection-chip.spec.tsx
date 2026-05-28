// @vitest-environment jsdom

/**
 * TDD contracts for issue #377 — selection chip in CodeMirror.
 *
 * Contract under test (Editor.tsx):
 *  - When `onSendSelection` prop is provided, Editor renders a chip element
 *    near the selection.
 *  - Chip is absent when selection is empty (selectionSet with empty range).
 *  - Chip appears when selection is non-empty.
 *  - Chip disappears when selection goes back to empty.
 *  - Clicking the chip calls `onSendSelection(formattedText)`.
 *  - Multi-line selection → formatSelectionForAgent produces a fenced block.
 *  - Single-line selection → formatSelectionForAgent produces bare text.
 *
 * Strategy:
 *  - Mock @uiw/react-codemirror to capture `onUpdate` prop and expose a
 *    `simulateSelection(from, to, text)` helper.
 *  - Chip is expected to have `data-testid="editor-selection-chip"`.
 *  - All CodeMirror internals are mocked minimally — focus stays on the
 *    Editor component boundary.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { formatSelectionForAgent } from '../../lib/agent-selection-format'

// ---------------------------------------------------------------------------
// Hoisted helpers — must be available inside vi.mock() factories
// ---------------------------------------------------------------------------

const { capturedOnUpdate } = vi.hoisted(() => {
  const capturedOnUpdate: { fn: ((update: unknown) => void) | null } = { fn: null }
  return { capturedOnUpdate }
})

// ---------------------------------------------------------------------------
// Fake EditorView
// ---------------------------------------------------------------------------

function makeFakeView(docText = 'hello world\nfoo bar') {
  return {
    state: {
      _docText: docText,
      selection: { main: { from: 0, to: 0, empty: true } },
      sliceDoc(f: number, t: number) {
        return this._docText.slice(f, t)
      },
    },
    coordsAtPos: vi.fn((_pos: number) => ({ top: 50, bottom: 66, left: 120, right: 160 })),
    focus: vi.fn(),
    dispatch: vi.fn(),
  }
}

let currentFakeView = makeFakeView()

// ---------------------------------------------------------------------------
// Mocks — declared before any Editor import
// ---------------------------------------------------------------------------

vi.mock('@uiw/react-codemirror', () => ({
  default: vi.fn(
    (props: {
      extensions?: unknown[]
      onCreateEditor?: (view: typeof currentFakeView) => void
      onUpdate?: (update: unknown) => void
    }) => {
      capturedOnUpdate.fn = props.onUpdate ?? null
      setTimeout(() => props.onCreateEditor?.(currentFakeView), 0)
      return <div data-testid="codemirror" />
    },
  ),
}))

vi.mock('@codemirror/view', () => ({
  EditorView: { lineWrapping: {}, domEventHandlers: () => ({}) },
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

vi.mock('../lib/cmLanguage', () => ({
  languageIdFor: () => null,
  loadLanguage: () => Promise.resolve(null),
}))

vi.mock('../lib/cmJustInsertedHighlight', () => ({
  flashInserted: { of: (v: unknown) => ({ value: v }) },
  clearInsertedFlashes: { of: (v: unknown) => ({ value: v }) },
  justInsertedField: {},
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
          writeBinary: vi.fn(async ({ relPath }: { relPath: string }) => relPath),
          exportPdf: vi.fn().mockResolvedValue(undefined),
        },
      },
    },
    writable: true,
    configurable: true,
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultProps(overrides: Partial<Parameters<typeof Editor>[0]> = {}) {
  return {
    filePath: '/vault/note.ts',
    vaultPath: '/vault',
    initialContent: 'hello world\nfoo bar',
    version: 1,
    geometryKey: 'k',
    paletteItems: [],
    onSave: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    onBufferChange: vi.fn<(content: string) => void>(),
    onNavigate: vi.fn<(path: string, replaceCurrent: boolean) => void>(),
    canBack: false,
    canForward: false,
    onBack: vi.fn<() => void>(),
    onForward: vi.fn<() => void>(),
    agentKind: 'codex' as const,
    ...overrides,
  }
}

/**
 * Fire a simulated CodeMirror `update` through the captured `onUpdate` prop.
 * `selectionSet: true` signals the selection changed; `empty` controls
 * whether the selection range is empty.
 */
function simulateSelectionUpdate(from: number, to: number, empty: boolean) {
  const update = {
    selectionSet: true,
    state: {
      selection: {
        main: { from, to, empty },
      },
    },
    view: currentFakeView,
  }
  act(() => {
    capturedOnUpdate.fn?.(update)
  })
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  setupMarvinMock()
  currentFakeView = makeFakeView()
  capturedOnUpdate.fn = null
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ===========================================================================
// Contract 1: chip absent when selection is empty
// ===========================================================================

describe('Editor selection chip — no chip when selection is empty', () => {
  it('does not render the chip on initial mount (no selection)', async () => {
    const onSendSelection = vi.fn<(text: string) => void>()
    await act(async () => {
      render(<Editor {...defaultProps({ onSendSelection })} />)
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(screen.queryByTestId('editor-selection-chip')).toBeNull()
  })

  it('does not render the chip when selectionSet fires with empty range', async () => {
    const onSendSelection = vi.fn<(text: string) => void>()
    await act(async () => {
      render(<Editor {...defaultProps({ onSendSelection })} />)
      await new Promise((r) => setTimeout(r, 10))
    })
    simulateSelectionUpdate(5, 5, true)
    expect(screen.queryByTestId('editor-selection-chip')).toBeNull()
  })
})

// ===========================================================================
// Contract 2: chip appears when selection is non-empty
// ===========================================================================

describe('Editor selection chip — chip appears with non-empty selection', () => {
  it('renders the chip after a non-empty selectionchange', async () => {
    const onSendSelection = vi.fn<(text: string) => void>()
    await act(async () => {
      render(<Editor {...defaultProps({ onSendSelection })} />)
      await new Promise((r) => setTimeout(r, 10))
    })
    simulateSelectionUpdate(0, 5, false)
    expect(screen.getByTestId('editor-selection-chip')).toBeDefined()
  })
})

// ===========================================================================
// Contract 3: chip disappears when selection goes back to empty
// ===========================================================================

describe('Editor selection chip — chip disappears when selection clears', () => {
  it('removes the chip when selection returns to empty after being non-empty', async () => {
    const onSendSelection = vi.fn<(text: string) => void>()
    await act(async () => {
      render(<Editor {...defaultProps({ onSendSelection })} />)
      await new Promise((r) => setTimeout(r, 10))
    })

    simulateSelectionUpdate(0, 5, false)
    expect(screen.getByTestId('editor-selection-chip')).toBeDefined()

    simulateSelectionUpdate(5, 5, true)
    expect(screen.queryByTestId('editor-selection-chip')).toBeNull()
  })
})

// ===========================================================================
// Contract 4: click on chip calls onSendSelection with formatted text
// ===========================================================================

describe('Editor selection chip — click calls onSendSelection', () => {
  it('calls onSendSelection with the selected text slice on click', async () => {
    const docText = 'hello world\nfoo bar'
    currentFakeView = makeFakeView(docText)
    const onSendSelection = vi.fn<(text: string) => void>()

    await act(async () => {
      render(<Editor {...defaultProps({ onSendSelection })} />)
      await new Promise((r) => setTimeout(r, 10))
    })

    // Select "hello" (0..5)
    simulateSelectionUpdate(0, 5, false)

    await act(async () => {
      fireEvent.click(screen.getByTestId('editor-selection-chip'))
    })

    const expectedText = formatSelectionForAgent(docText.slice(0, 5), 'codex')
    expect(onSendSelection).toHaveBeenCalledTimes(1)
    expect(onSendSelection).toHaveBeenCalledWith(expectedText)
  })
})

// ===========================================================================
// Contract 5: multi-line selection → fenced block
// ===========================================================================

describe('Editor selection chip — multi-line selection is fenced', () => {
  it('calls onSendSelection with a fenced block for multi-line text', async () => {
    const docText = 'hello world\nfoo bar'
    currentFakeView = makeFakeView(docText)
    const onSendSelection = vi.fn<(text: string) => void>()

    await act(async () => {
      render(<Editor {...defaultProps({ onSendSelection })} />)
      await new Promise((r) => setTimeout(r, 10))
    })

    // Select "hello world\nfoo" — spans two lines
    const selectedText = docText.slice(0, 15)
    simulateSelectionUpdate(0, 15, false)

    await act(async () => {
      fireEvent.click(screen.getByTestId('editor-selection-chip'))
    })

    const expectedText = formatSelectionForAgent(selectedText, 'codex')
    expect(expectedText).toMatch(/^```\n/)
    expect(onSendSelection).toHaveBeenCalledWith(expectedText)
  })
})

// ===========================================================================
// Contract 6: single-line selection → bare text (no fence)
// ===========================================================================

describe('Editor selection chip — single-line selection is bare text', () => {
  it('calls onSendSelection with bare text for a single-line selection', async () => {
    const docText = 'hello world\nfoo bar'
    currentFakeView = makeFakeView(docText)
    const onSendSelection = vi.fn<(text: string) => void>()

    await act(async () => {
      render(<Editor {...defaultProps({ onSendSelection })} />)
      await new Promise((r) => setTimeout(r, 10))
    })

    // Select "hello" — single line, no newlines
    const selectedText = docText.slice(0, 5)
    simulateSelectionUpdate(0, 5, false)

    await act(async () => {
      fireEvent.click(screen.getByTestId('editor-selection-chip'))
    })

    const expectedText = formatSelectionForAgent(selectedText, 'codex')
    expect(expectedText).toBe('hello')
    expect(expectedText).not.toMatch(/^```/)
    expect(onSendSelection).toHaveBeenCalledWith(expectedText)
  })
})
