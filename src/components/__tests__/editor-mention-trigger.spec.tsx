// @vitest-environment jsdom

/**
 * Integration tests for the @-mention trigger wired into Editor.tsx.
 *
 * Strategy:
 *  - Mock @uiw/react-codemirror to expose the mentionTrigger callbacks via
 *    the captured `mentionTrigger` mock — when the Editor calls
 *    `mentionTrigger({ onOpen, onUpdate, onClose })`, we capture those
 *    callbacks and fire them in tests.
 *  - MentionPicker is a real (but minimal) mock so we can assert its
 *    render/unmount and invoke its onSelect/onDismiss props.
 *  - Tests cover:
 *    1. Typing @ mounts MentionPicker with the correct query/anchor props
 *    2. Selecting an item dispatches the [[wikilink]] insertion and unmounts picker
 *    3. Dismiss (Escape) unmounts the picker without modifying the document
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, screen } from '@testing-library/react'
import type { PaletteItem } from '../../lib/paletteRanker'

// ---------------------------------------------------------------------------
// Captured mention callbacks + dispatch spy
// ---------------------------------------------------------------------------

const {
  capturedMentionCallbacks,
  capturedExtensions,
  dispatchSpy,
} = vi.hoisted(() => {
  type MentionCallbacks = {
    onOpen: (from: number, anchor: { x: number; y: number }) => void
    onUpdate: (query: string, anchor: { x: number; y: number }) => void
    onClose: () => void
  }
  const capturedMentionCallbacks: { value: MentionCallbacks | null } = { value: null }
  const capturedExtensions: { value: unknown[] } = { value: [] }
  const dispatchSpy = vi.fn()
  return { capturedMentionCallbacks, capturedExtensions, dispatchSpy }
})

// ---------------------------------------------------------------------------
// MentionPicker mock — renders a testid element and exposes callbacks via ref
// ---------------------------------------------------------------------------

// Callbacks are set in an event handler (useEffect equivalent) via a stable
// ref-like object so we never write to module state during render (avoids the
// React "setState during render" warning).
const pickerCallbacks: {
  onSelect?: (item: PaletteItem) => void
  onDismiss?: () => void
} = {}

// Captures the items prop the Editor passes to MentionPicker, so a test can
// assert the picker now receives the unfiltered palette (non-md included).
const pickerItems: { value: PaletteItem[] } = { value: [] }

vi.mock('../MentionPicker', () => ({
  MentionPicker: (props: {
    query: string
    items: PaletteItem[]
    anchor: { x: number; y: number }
    onSelect: (item: PaletteItem) => void
    onDismiss: () => void
  }) => {
    // Store callbacks outside render via a layout-effect so we avoid the
    // "setState during render" React warning that fires when a parent's
    // setState is triggered while a child renders. Using a timeout(0) ensures
    // the assignment runs after the render phase.
    pickerItems.value = props.items
    setTimeout(() => {
      pickerCallbacks.onSelect = props.onSelect
      pickerCallbacks.onDismiss = props.onDismiss
    }, 0)
    return (
      <div
        data-testid="mention-picker"
        data-query={props.query}
        data-anchor-x={props.anchor.x}
        data-anchor-y={props.anchor.y}
      />
    )
  },
}))

// ---------------------------------------------------------------------------
// mentionTrigger mock — captures callbacks when Editor builds the extension
// ---------------------------------------------------------------------------

vi.mock('../../lib/cmMentionTrigger', () => ({
  mentionTrigger: (callbacks: {
    onOpen: (from: number, anchor: { x: number; y: number }) => void
    onUpdate: (query: string, anchor: { x: number; y: number }) => void
    onClose: () => void
  }) => {
    capturedMentionCallbacks.value = callbacks
    return { _ext: 'mentionTrigger' }
  },
}))

// ---------------------------------------------------------------------------
// Standard Editor mocks
// ---------------------------------------------------------------------------

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
  SearchQuery: class { constructor() {} },
}))

vi.mock('@codemirror/view', () => ({
  EditorView: { lineWrapping: {}, domEventHandlers: () => ({}) },
  keymap: { of: () => ({}) },
  Decoration: {
    mark: () => ({ range: (f: number, t: number) => ({ f, t }) }),
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
  EditorSelection: { cursor: (n: number) => ({ from: n, to: n }) },
}))

vi.mock('../../lib/cmLanguage', () => ({
  languageIdFor: () => null,
  loadLanguage: () => Promise.resolve(null),
}))

vi.mock('../../lib/frontmatter', () => ({
  replaceFrontmatter: (c: string) => c,
  serializeFrontmatter: () => '',
  splitFrontmatter: (c: string) => ({ data: null, body: c }),
}))

vi.mock('../Properties', () => ({ Properties: () => null }))
vi.mock('../CsvEditor', () => ({ CsvEditor: () => null }))
vi.mock('../HtmlPreview', () => ({ HtmlPreview: () => null }))
vi.mock('../PathSuggest', () => ({ PathSuggest: () => null }))
vi.mock('../Icon', () => ({ Icon: () => null }))
vi.mock('../LiveMarkdown', () => ({
  LiveMarkdown: () => <div data-testid="live-markdown" />,
}))
vi.mock('../../lib/visualStyle', () => ({ useVisualStyle: () => 'modern' }))
vi.mock('../../lib/wikilinks', () => ({
  isWikilinkHref: () => null,
  resolveWikilink: () => null,
  stripMdExt: (n: string) => n.replace(/\.(md|markdown)$/i, ''),
}))
vi.mock('../../lib/paletteRanker', () => ({}))

// ---------------------------------------------------------------------------
// Fake EditorView instance exposed via onCreateEditor
// ---------------------------------------------------------------------------

const fakeView = {
  state: {
    selection: { ranges: [{ empty: true }], main: { from: 7, to: 7, head: 7 } },
    sliceDoc: (f: number, t: number) => 'hello @'.slice(f, t),
  },
  contentDOM: document.createElement('div'),
  focus: vi.fn(),
  dispatch: dispatchSpy,
}

vi.mock('@uiw/react-codemirror', () => ({
  default: vi.fn(
    (props: {
      extensions?: unknown[]
      onCreateEditor?: (view: typeof fakeView) => void
    }) => {
      capturedExtensions.value = props.extensions ?? []
      props.onCreateEditor?.(fakeView)
      return <div data-testid="codemirror" />
    },
  ),
}))

// ---------------------------------------------------------------------------
// Import Editor after all mocks
// ---------------------------------------------------------------------------

import { Editor } from '../Editor'

// ---------------------------------------------------------------------------
// Helpers
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
    initialContent: 'hello ',
    version: 1,
    geometryKey: 'k',
    paletteItems: [
      { name: 'My Note.md', path: '/vault/My Note.md', rel: 'My Note.md', isMarkdown: true },
    ] as unknown as PaletteItem[],
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
  capturedMentionCallbacks.value = null
  capturedExtensions.value = []
  dispatchSpy.mockClear()
  fakeView.focus.mockClear()
  fakeView.state.selection.main.head = 7
  delete pickerCallbacks.onSelect
  delete pickerCallbacks.onDismiss
  pickerItems.value = []
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Editor mention trigger — MentionPicker lifecycle', () => {
  it('mounts MentionPicker with correct query and anchor when onOpen fires', async () => {
    await act(async () => {
      render(<Editor {...defaultProps()} />)
    })

    expect(capturedMentionCallbacks.value).not.toBeNull()

    // Simulate the trigger extension calling onOpen
    await act(async () => {
      capturedMentionCallbacks.value!.onOpen(6, { x: 10, y: 20 })
    })

    const picker = screen.getByTestId('mention-picker')
    expect(picker.dataset.query).toBe('')
    expect(picker.dataset.anchorX).toBe('10')
    expect(picker.dataset.anchorY).toBe('20')
  })

  it('inserts [[wikilink]] and unmounts picker when an item is selected', async () => {
    await act(async () => {
      render(<Editor {...defaultProps()} />)
    })

    // Open picker at position 6 with query 'my'
    await act(async () => {
      capturedMentionCallbacks.value!.onOpen(6, { x: 10, y: 20 })
      capturedMentionCallbacks.value!.onUpdate('my', { x: 15, y: 20 })
    })

    expect(screen.getByTestId('mention-picker')).toBeTruthy()

    // Let the setTimeout(0) in the mock flush so pickerCallbacks are set.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    // Select an item — name carries the `.md` extension on purpose so the
    // assertion below proves the insert strips it.
    const item = {
      name: 'My Note.md',
      path: '/vault/My Note.md',
      rel: 'My Note.md',
      isMarkdown: true,
    } as unknown as PaletteItem
    await act(async () => {
      pickerCallbacks.onSelect!(item)
    })

    // dispatch should have been called with the wikilink insertion AND the
    // caret placed at the end of the inserted text (`from + insert.length`).
    // Insert is `[[My Note]]` (11 chars) at from=6, so cursor should land at
    // pos 17. The mocked `EditorSelection.cursor(n)` returns `{ from: n, to: n }`.
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({
          from: 6,
          insert: '[[My Note]]',
        }),
        selection: { from: 17, to: 17 },
      }),
    )

    // Picker should be gone
    expect(screen.queryByTestId('mention-picker')).toBeNull()
  })

  it('inserts an image embed when a non-markdown image is selected', async () => {
    await act(async () => {
      render(<Editor {...defaultProps()} />)
    })

    await act(async () => {
      capturedMentionCallbacks.value!.onOpen(6, { x: 10, y: 20 })
      capturedMentionCallbacks.value!.onUpdate('dia', { x: 15, y: 20 })
    })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    const item = {
      name: 'diagram.png',
      path: '/vault/img/diagram.png',
      rel: 'img/diagram.png',
      isMarkdown: false,
    } as unknown as PaletteItem
    await act(async () => {
      pickerCallbacks.onSelect!(item)
    })

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({ from: 6, insert: '![[diagram.png]]' }),
      }),
    )
  })

  it('inserts a markdown link when a non-markdown, non-image file is selected', async () => {
    await act(async () => {
      render(<Editor {...defaultProps()} />)
    })

    await act(async () => {
      capturedMentionCallbacks.value!.onOpen(6, { x: 10, y: 20 })
      capturedMentionCallbacks.value!.onUpdate('rep', { x: 15, y: 20 })
    })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    const item = {
      name: 'report.pdf',
      path: '/vault/docs/report.pdf',
      rel: 'docs/report.pdf',
      isMarkdown: false,
    } as unknown as PaletteItem
    await act(async () => {
      pickerCallbacks.onSelect!(item)
    })

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({
          from: 6,
          insert: '[report.pdf](docs/report.pdf)',
        }),
      }),
    )
  })

  it('passes the unfiltered palette (incl. non-md items) to MentionPicker', async () => {
    const props = defaultProps()
    props.paletteItems = [
      { name: 'My Note.md', path: '/vault/My Note.md', rel: 'My Note.md', isMarkdown: true },
      { name: 'diagram.png', path: '/vault/diagram.png', rel: 'diagram.png', isMarkdown: false },
    ] as unknown as PaletteItem[]

    await act(async () => {
      render(<Editor {...props} />)
    })
    await act(async () => {
      capturedMentionCallbacks.value!.onOpen(6, { x: 10, y: 20 })
    })

    expect(pickerItems.value.map((it) => it.name)).toEqual([
      'My Note.md',
      'diagram.png',
    ])
  })

  it('unmounts picker without modifying document when dismissed', async () => {
    await act(async () => {
      render(<Editor {...defaultProps()} />)
    })

    // Open picker
    await act(async () => {
      capturedMentionCallbacks.value!.onOpen(6, { x: 10, y: 20 })
    })

    expect(screen.getByTestId('mention-picker')).toBeTruthy()

    // Let the setTimeout(0) in the mock flush so pickerCallbacks are set.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    // Dismiss
    await act(async () => {
      pickerCallbacks.onDismiss!()
    })

    // Picker should be gone, no dispatch
    expect(screen.queryByTestId('mention-picker')).toBeNull()
    expect(dispatchSpy).not.toHaveBeenCalled()
  })
})
