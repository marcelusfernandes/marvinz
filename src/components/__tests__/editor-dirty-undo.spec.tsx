// @vitest-environment jsdom
//
// Regression coverage for Bug 2 (issue #410):
// undo back to the saved content must clear dirty (onDirtyChange → false).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from '@testing-library/react'
import { renderWithAppContext as render } from './renderWithAppContext'

// ---------------------------------------------------------------------------
// Mocks — must precede Editor import
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

// onChange is the key hook: capture it so tests can drive scheduleSave.
let capturedOnChange: ((val: string) => void) | null = null

vi.mock('@uiw/react-codemirror', () => ({
  default: (props: { onChange?: (val: string) => void; value?: string }) => {
    capturedOnChange = props.onChange ?? null
    return <div data-testid="codemirror" />
  },
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
vi.mock('./LiveMarkdown', () => ({ LiveMarkdown: () => <div /> }))
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
    // Use a non-markdown extension so the editor starts in 'edit' mode
    // (CodeMirror) rather than 'preview' (LiveMarkdown). This ensures
    // capturedOnChange is populated by the mock.
    filePath: '/vault/note.ts',
    vaultPath: '/vault',
    initialContent: 'original',
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
  capturedOnChange = null
  vi.useFakeTimers()
})

afterEach(() => {
  vi.runAllTimers()
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// Bug 2 regression: undo back to saved content clears dirty
// ---------------------------------------------------------------------------

describe('dirty derived from content — Bug 2 regression', () => {
  it('typing a diff sets dirty true', () => {
    const onDirtyChange = vi.fn()
    render(<Editor {...baseProps({ onDirtyChange, saveMode: 'manual' })} />)

    act(() => {
      capturedOnChange?.('original modified')
    })

    expect(onDirtyChange).toHaveBeenCalledWith(true)
  })

  it('reverting to initialContent clears dirty (last call is false)', () => {
    const onDirtyChange = vi.fn()
    render(<Editor {...baseProps({ onDirtyChange, saveMode: 'manual' })} />)

    // Type a change → dirty
    act(() => {
      capturedOnChange?.('original modified')
    })

    // Undo back to the exact initialContent → clean
    act(() => {
      capturedOnChange?.('original')
    })

    const calls = onDirtyChange.mock.calls.map(([v]) => v)
    expect(calls).toContain(true)
    expect(calls[calls.length - 1]).toBe(false)
  })

  it('retyping a diff after undo sets dirty true again', () => {
    const onDirtyChange = vi.fn()
    render(<Editor {...baseProps({ onDirtyChange, saveMode: 'manual' })} />)

    // Type → dirty
    act(() => {
      capturedOnChange?.('original modified')
    })

    // Undo → clean
    act(() => {
      capturedOnChange?.('original')
    })

    onDirtyChange.mockClear()

    // Type again → dirty again
    act(() => {
      capturedOnChange?.('original again different')
    })

    expect(onDirtyChange).toHaveBeenCalledWith(true)
  })

  it('content equal to initialContent on first keystroke never sets dirty true', () => {
    // Edge case: user types and immediately types back in one event
    const onDirtyChange = vi.fn()
    render(<Editor {...baseProps({ onDirtyChange, saveMode: 'manual' })} />)

    act(() => {
      capturedOnChange?.('original')
    })

    // No true call — content matches saved (initialContent)
    const calls = onDirtyChange.mock.calls.map(([v]) => v)
    expect(calls).not.toContain(true)
  })
})

// ---------------------------------------------------------------------------
// Interaction with auto-save: savedContentRef advances after save
// ---------------------------------------------------------------------------

describe('savedContentRef advances after save — undo to last-saved clears dirty', () => {
  it('after a successful save, undo to saved content clears dirty', async () => {
    const onDirtyChange = vi.fn()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <Editor {...baseProps({ onDirtyChange, onSave, saveMode: 'auto', initialContent: 'v1' })} />
    )

    // Type new content → triggers auto-save debounce
    act(() => {
      capturedOnChange?.('v2')
    })

    // Flush debounce → save resolves → savedContentRef = 'v2'
    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    onDirtyChange.mockClear()

    // Undo to 'v2' (the last saved value, not initialContent) → should clear dirty
    act(() => {
      capturedOnChange?.('v2')
    })

    const calls = onDirtyChange.mock.calls.map(([v]) => v)
    expect(calls).not.toContain(true)
    // Either no call (deduped because already false) or last call is false
    if (calls.length > 0) {
      expect(calls[calls.length - 1]).toBe(false)
    }
  })
})
