// @vitest-environment jsdom
//
// Focused tests for the Raw/Rendered mode toggle (replaced the old Source/Page toggle).
// Ensures the toggle renders with the new labels and that the old labels
// ("Source", "Page") are absent.
// The toggle only renders when hasPreview is true (isMd || isCsv || isHtml).
// We use filePath: '/vault/note.md' so hasPreview is true.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mocks — must precede Editor import (same preamble as editor-save-mode.spec)
// ---------------------------------------------------------------------------

vi.mock('@codemirror/view', () => ({
  EditorView: {
    lineWrapping: {},
    domEventHandlers: () => ({}),
  },
  keymap: { of: () => ({}) },
  Decoration: {
    mark: () => ({ range: () => ({}) }),
    none: { update: () => null },
  },
  ViewPlugin: { define: () => ({}) },
}))

vi.mock('@codemirror/search', () => ({
  search: () => ({}),
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
  SearchQuery: class {},
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
}))

vi.mock('@codemirror/state', () => ({
  StateEffect: { define: () => ({ of: (v: unknown) => ({ value: v }) }) },
  StateField: { define: () => ({}) },
  EditorSelection: { cursor: (pos: number) => ({ anchor: pos, head: pos }) },
}))

vi.mock('@uiw/react-codemirror', () => ({
  default: () => <div data-testid="codemirror" />,
}))

vi.mock('../lib/cmLanguage', () => ({
  languageIdFor: () => null,
  loadLanguage: () => Promise.resolve(null),
}))

vi.mock('../lib/cmJustReplacedHighlight', () => ({ justReplacedField: {} }))
vi.mock('../lib/cmJustInsertedHighlight', () => ({
  justInsertedField: {},
  flashInserted: { of: () => ({}) },
  clearInsertedFlashes: { of: () => ({}) },
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
// Resolved relative to THIS file (in __tests__/), so the sibling component is
// '../LiveMarkdown' — a './LiveMarkdown' specifier would point at a
// nonexistent module and silently never intercept (#533). The testid marker
// matches editor-livemarkdown-remount.spec.tsx and proves interception.
vi.mock('../LiveMarkdown', () => ({
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

// ---------------------------------------------------------------------------
// Import Editor after mocks
// ---------------------------------------------------------------------------

import { Editor } from '../Editor'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupMarvin() {
  Object.assign(window, {
    marvin: {
      app: {
        showContextMenu: vi.fn().mockResolvedValue(null),
        canPaste: vi.fn().mockResolvedValue(false),
      },
      editor: { writeClipboard: vi.fn(), readClipboard: vi.fn().mockResolvedValue('') },
      shell: { openExternal: vi.fn() },
      file: {
        write: vi.fn().mockResolvedValue(undefined),
        exportPdf: vi.fn().mockResolvedValue(undefined),
        writeBinary: vi.fn().mockResolvedValue(''),
      },
    },
  })
}

function baseProps(overrides: Partial<Parameters<typeof Editor>[0]> = {}) {
  return {
    filePath: '/vault/note.md',
    vaultPath: '/vault',
    initialContent: '',
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
    ...overrides,
  }
}

beforeEach(() => {
  setupMarvin()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.runAllTimers()
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// Mode toggle label tests
// ---------------------------------------------------------------------------

describe('Editor mode toggle — Raw/Rendered labels', () => {
  it('renders "Raw" button in the mode toggle', () => {
    act(() => {
      render(<Editor {...baseProps()} />)
    })
    expect(screen.getByText('Raw')).toBeInTheDocument()
  })

  it('renders "Rendered" button in the mode toggle', () => {
    act(() => {
      render(<Editor {...baseProps()} />)
    })
    expect(screen.getByText('Rendered')).toBeInTheDocument()
  })

  it('does NOT render a "Source" button (old label removed)', () => {
    act(() => {
      render(<Editor {...baseProps()} />)
    })
    expect(screen.queryByText('Source')).toBeNull()
  })

  it('does NOT render a "Page" button (old label removed)', () => {
    act(() => {
      render(<Editor {...baseProps()} />)
    })
    expect(screen.queryByText('Page')).toBeNull()
  })

  it('"Raw" button has title "Raw markdown"', () => {
    act(() => {
      render(<Editor {...baseProps()} />)
    })
    expect(screen.getByTitle('Raw markdown')).toBeInTheDocument()
  })

  it('"Rendered" button has title "Rendered"', () => {
    act(() => {
      render(<Editor {...baseProps()} />)
    })
    expect(screen.getByTitle('Rendered')).toBeInTheDocument()
  })

  it('toggle container has role="tablist"', () => {
    act(() => {
      render(<Editor {...baseProps()} />)
    })
    expect(screen.getByRole('tablist')).toBeInTheDocument()
  })

  it('renders the mocked LiveMarkdown, not the real Milkdown component (#533)', () => {
    act(() => {
      render(<Editor {...baseProps()} />)
    })
    // Proof of interception: only the mock renders this marker. If the
    // vi.mock path regresses, the real component mounts and this fails loudly.
    expect(screen.getByTestId('live-markdown')).toBeInTheDocument()
  })
})
