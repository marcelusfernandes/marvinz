// @vitest-environment jsdom

/**
 * TDD contracts for issue #378 — selection chip in LiveMarkdown (Milkdown).
 *
 * Contract under test (LiveMarkdown.tsx):
 *  - When `onSendSelection` prop is provided, LiveMarkdown renders a chip
 *    element near the selection when text is selected inside its container.
 *  - Chip is absent when there is no selection (or selection is empty).
 *  - Chip appears when selection is non-empty AND anchorNode is inside the
 *    LiveMarkdown container.
 *  - Chip disappears when selection is cleared.
 *  - Selection whose anchorNode is OUTSIDE the container does not show a chip.
 *  - Clicking the chip calls onSendSelection(formattedText) using the real
 *    formatSelectionForAgent helper (no mocking of the helper).
 *  - Multi-line selection → formatSelectionForAgent produces a fenced block.
 *  - Single-line selection → formatSelectionForAgent produces bare text.
 *  - Chip activates both in edit mode and preview mode (same DOM selection API).
 *
 * Strategy:
 *  - Mock @milkdown/* and ProseMirror packages minimally (as in LiveMarkdown-drop).
 *  - Chip is expected to have `data-testid="editor-selection-chip"`.
 *  - Selection is simulated by mocking window.getSelection() and dispatching
 *    a `selectionchange` event on document.
 *  - Range.getBoundingClientRect is mocked to return fixed viewport coordinates.
 *  - formatSelectionForAgent is imported directly — NOT mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { formatSelectionForAgent } from '../../lib/agent-selection-format'

// ---------------------------------------------------------------------------
// Hoisted symbols — module-stable identities shared across vi.mock factories
// ---------------------------------------------------------------------------

const {
  PARSER_CTX,
  EDITOR_VIEW_CTX,
  EDITOR_VIEW_OPTIONS_CTX,
  ROOT_CTX,
  DEFAULT_VALUE_CTX,
  PROSE_PLUGINS_CTX,
  LISTENER_CTX,
} = vi.hoisted(() => ({
  PARSER_CTX: Symbol('parserCtx'),
  EDITOR_VIEW_CTX: Symbol('editorViewCtx'),
  EDITOR_VIEW_OPTIONS_CTX: Symbol('editorViewOptionsCtx'),
  ROOT_CTX: Symbol('rootCtx'),
  DEFAULT_VALUE_CTX: Symbol('defaultValueCtx'),
  PROSE_PLUGINS_CTX: Symbol('prosePluginsCtx'),
  LISTENER_CTX: Symbol('listenerCtx'),
}))

// ---------------------------------------------------------------------------
// Fake ProseMirror view
// ---------------------------------------------------------------------------

const fakeView = {
  state: {
    schema: { text: (s: string) => ({ _kind: 'text', text: s }) },
    selection: { from: 0, to: 0, empty: true },
    get tr() {
      return {
        doc: { content: { size: 1000 }, resolve: (n: number) => ({ pos: n, nodeBefore: null, marks: () => [] }) },
        mapping: { map: (p: number) => p + 1 },
        _replaces: [] as unknown[],
        replace(from: number, to: number, slice: unknown) { this._replaces.push({ from, to, slice }); return this },
        replaceWith(_from: number, _to: number, _content: unknown) { return this },
        insert(_pos: number, _content: unknown) { return this },
        setMeta: vi.fn(function (this: unknown) { return this }),
        setSelection: vi.fn(function (this: unknown) { return this }),
        setStoredMarks: vi.fn(function (this: unknown) { return this }),
      }
    },
  },
  dispatch: vi.fn(),
  posAtCoords: vi.fn(() => ({ pos: 5, inside: 0 })),
  focus: vi.fn(),
}

// Fake ctx — satisfies all ctx.set / ctx.get / ctx.update calls in LiveMarkdown.
const fakeParser = vi.fn((_md: string) => ({
  childCount: 1,
  firstChild: { isTextblock: true, content: { size: 1, descendants: (_cb: unknown) => {} } },
  content: { size: 1 },
  type: { name: 'doc' },
}))

const fakeCtx = {
  set: vi.fn(),
  update: vi.fn(),
  get: vi.fn((key: symbol) => {
    if (key === PARSER_CTX) return fakeParser
    if (key === LISTENER_CTX) return { markdownUpdated: vi.fn() }
    if (key === EDITOR_VIEW_CTX) return fakeView
    return undefined
  }),
}

// ---------------------------------------------------------------------------
// Mocks — declared before any LiveMarkdown import
// ---------------------------------------------------------------------------

vi.mock('@milkdown/core', () => ({
  Editor: {
    make: () => {
      const builder = {
        config: (cb: (ctx: typeof fakeCtx) => void) => { cb(fakeCtx); return builder },
        use: () => builder,
      }
      return builder
    },
  },
  defaultValueCtx: DEFAULT_VALUE_CTX,
  editorViewCtx: EDITOR_VIEW_CTX,
  editorViewOptionsCtx: EDITOR_VIEW_OPTIONS_CTX,
  parserCtx: PARSER_CTX,
  prosePluginsCtx: PROSE_PLUGINS_CTX,
  rootCtx: ROOT_CTX,
}))

vi.mock('@milkdown/react', () => ({
  Milkdown: () => <div data-testid="milkdown-editor" />,
  MilkdownProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useEditor: (cb: (root: HTMLElement) => unknown) => {
    cb(document.createElement('div'))
    return { get: () => null }
  },
}))

vi.mock('@milkdown/preset-commonmark', () => ({ commonmark: {} }))
vi.mock('@milkdown/preset-gfm', () => ({ gfm: {}, extendListItemSchemaForTask: { node: {} } }))
vi.mock('@milkdown/plugin-listener', () => ({
  listener: {},
  listenerCtx: LISTENER_CTX,
}))

vi.mock('prosemirror-history', () => ({
  history: () => ({}),
  undo: () => {},
  redo: () => {},
  undoDepth: () => 0,
  redoDepth: () => 0,
}))
vi.mock('prosemirror-commands', () => ({ selectAll: () => {} }))
vi.mock('prosemirror-keymap', () => ({ keymap: () => ({}) }))
vi.mock('prosemirror-state', async () => {
  const actual = await vi.importActual<typeof import('prosemirror-state')>('prosemirror-state')
  return {
    ...actual,
    TextSelection: { near: vi.fn((pos: unknown) => ({ _kind: 'sel', pos })) },
  }
})
vi.mock('prosemirror-search', () => ({
  search: () => ({}),
  findNext: () => {},
  findPrev: () => {},
}))
vi.mock('prosemirror-dropcursor', () => ({ dropCursor: () => ({}) }))

vi.mock('../../lib/imageNodeView', () => ({ imageNodeView: () => ({}) }))
vi.mock('../../lib/mermaidNodeView', () => ({ mermaidNodeView: () => ({}) }))
vi.mock('../../lib/pmJustInsertedHighlight', () => ({
  justInsertedPlugin: () => ({}),
  justInsertedPluginKey: {},
}))
vi.mock('../../lib/pmJustReplacedHighlight', () => ({ justReplacedPlugin: () => ({}) }))
vi.mock('../../lib/wikilinks', () => ({
  parseWikilinks: (s: string) => s,
  unparseWikilinks: (s: string) => s,
  stripMdExt: (s: string) => s,
}))
vi.mock('../../lib/pmMentionTrigger', () => ({
  mentionTrigger: () => ({}),
}))
vi.mock('../../lib/dropAttachments', () => ({
  MARVIN_PATH_MIME: 'application/x-marvin-path',
  MARVIN_PATHS_MIME: 'application/x-marvin-paths',
  collectFiles: () => [],
  emitSummaryToast: () => {},
  internalDragMarkdown: () => '',
  persistDroppedFiles: vi.fn().mockResolvedValue({ inserts: [], errors: [] }),
  readDraggedPaths: () => [],
}))
vi.mock('../MentionPicker', () => ({ MentionPicker: () => null }))

// ---------------------------------------------------------------------------
// Import after all mocks
// ---------------------------------------------------------------------------

import { LiveMarkdown } from '../LiveMarkdown'

// ---------------------------------------------------------------------------
// window.marvin mock
// ---------------------------------------------------------------------------

// Stable getSelection mock ref so tests can swap the return value.
const getSelectionMock = vi.fn<() => Selection | null>(() => null)

function setupMarvinMock() {
  const realWindow = typeof window !== 'undefined' ? window : ({} as Window)
  Object.defineProperty(globalThis, 'window', {
    value: {
      ...realWindow,
      addEventListener: realWindow.addEventListener?.bind(realWindow) ?? vi.fn(),
      removeEventListener: realWindow.removeEventListener?.bind(realWindow) ?? vi.fn(),
      innerWidth: 1024,
      innerHeight: 768,
      // Bind setTimeout/clearTimeout at setup time so the impl's
      // `window.setTimeout` calls land on whatever timer implementation is
      // active (fake or real). Without explicit bindings the spread captures
      // the pre-fake-timers function and `vi.advanceTimersByTime` won't fire it.
      setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
      clearTimeout: (...args: Parameters<typeof clearTimeout>) => clearTimeout(...args),
      // Expose getSelection as a configurable, writable function so vi.spyOn
      // can replace it per-test (spread loses the property otherwise).
      getSelection: getSelectionMock,
      marvin: {
        file: { writeBinary: vi.fn(async ({ relPath }: { relPath: string }) => relPath) },
        app: { showContextMenu: vi.fn(), canPaste: vi.fn().mockResolvedValue(false) },
        editor: { writeClipboard: vi.fn(), readClipboard: vi.fn() },
        shell: { openExternal: vi.fn() },
      },
    },
    writable: true,
    configurable: true,
  })
}

// ---------------------------------------------------------------------------
// Selection simulation helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Selection object whose anchorNode is `node` (or null).
 * `toString()` returns `text`.
 */
type FakeRect = { top: number; bottom: number; left: number; right: number }

const DEFAULT_FAKE_RECT: FakeRect = { top: 100, bottom: 116, left: 200, right: 360 }

function asDOMRect(r: FakeRect) {
  return {
    ...r,
    width: r.right - r.left,
    height: r.bottom - r.top,
    x: r.left,
    y: r.top,
    toJSON: () => ({}),
  }
}

function makeSelection(text: string, anchorNode: Node | null, rects: FakeRect[] = [DEFAULT_FAKE_RECT]) {
  const range = document.createRange()
  if (anchorNode) range.selectNodeContents(anchorNode)

  const domRects = rects.map(asDOMRect)
  // Bounding rect = union (broader than any single line).
  const bounding = asDOMRect({
    top: Math.min(...rects.map((r) => r.top)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
    left: Math.min(...rects.map((r) => r.left)),
    right: Math.max(...rects.map((r) => r.right)),
  })
  range.getBoundingClientRect = vi.fn(() => bounding)
  range.getClientRects = vi.fn(() => domRects as unknown as DOMRectList)

  return {
    anchorNode,
    isCollapsed: text === '',
    rangeCount: text === '' ? 0 : 1,
    toString: () => text,
    getRangeAt: (_i: number) => range,
    removeAllRanges: vi.fn(),
  }
}

/**
 * Simulate a `selectionchange` event.
 *
 * Pass `container` (the Testing Library `result.container`) to simulate a
 * selection INSIDE the LiveMarkdown root — the helper resolves the inner
 * `.live-md` element so `containerRef.contains(anchorNode)` passes.
 *
 * Pass any other `Node` directly to simulate a selection whose anchor is
 * that specific node (e.g. a detached element for outside-container tests).
 */
function simulateSelection(text: string, anchor: HTMLElement | Node | null, rects?: FakeRect[]) {
  let anchorNode: Node | null
  if (anchor instanceof HTMLElement && anchor.querySelector('.live-md')) {
    // Testing Library wrapper — resolve the actual LiveMarkdown root element.
    anchorNode = anchor.querySelector('.live-md')
  } else {
    anchorNode = anchor
  }
  getSelectionMock.mockReturnValue(makeSelection(text, anchorNode, rects) as unknown as Selection)
  act(() => {
    document.dispatchEvent(new Event('selectionchange'))
    vi.advanceTimersByTime(60)
  })
}

function clearSelection() {
  getSelectionMock.mockReturnValue(makeSelection('', null) as unknown as Selection)
  act(() => {
    document.dispatchEvent(new Event('selectionchange'))
    vi.advanceTimersByTime(60)
  })
}

// ---------------------------------------------------------------------------
// Default props
// ---------------------------------------------------------------------------

function defaultProps(overrides: Partial<Parameters<typeof LiveMarkdown>[0]> = {}) {
  return {
    body: 'hello world\nfoo bar',
    onChange: vi.fn<(markdown: string) => void>(),
    onLinkClick: vi.fn<(href: string, modifier: 'replace' | 'newTab') => void>(),
    filePath: '/vault/note.md',
    vaultPath: '/vault',
    paletteItems: [],
    remountKey: 'k',
    agentKind: 'codex' as const,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers()
  setupMarvinMock()
  fakeView.dispatch.mockClear()
  fakeView.posAtCoords.mockClear()
  fakeView.focus.mockClear()
  fakeParser.mockClear()
  fakeCtx.set.mockClear()
  fakeCtx.get.mockClear()
  fakeCtx.update.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ===========================================================================
// Contract 1: no chip when selection is empty
// ===========================================================================

describe('LiveMarkdown selection chip — no chip when selection is empty', () => {
  it('does not render the chip on initial mount (no selection)', async () => {
    const onSendSelection = vi.fn<(text: string) => void>()
    await act(async () => {
      render(<LiveMarkdown {...defaultProps({ onSendSelection })} />)
    })
    expect(screen.queryByTestId('editor-selection-chip')).toBeNull()
  })

  it('does not render the chip when selectionchange fires with empty text', async () => {
    const onSendSelection = vi.fn<(text: string) => void>()
    let container!: HTMLElement
    await act(async () => {
      const result = render(<LiveMarkdown {...defaultProps({ onSendSelection })} />)
      container = result.container
    })
    await simulateSelection('', container)
    expect(screen.queryByTestId('editor-selection-chip')).toBeNull()
  })

  it('does not render the chip when onSendSelection prop is absent', async () => {
    let container!: HTMLElement
    await act(async () => {
      const result = render(<LiveMarkdown {...defaultProps()} />)
      container = result.container
    })
    await simulateSelection('hello world', container)
    expect(screen.queryByTestId('editor-selection-chip')).toBeNull()
  })
})

// ===========================================================================
// Contract 2: chip appears with non-empty selection inside container
// ===========================================================================

describe('LiveMarkdown selection chip — chip appears with non-empty selection', () => {
  it('renders the chip when selection is non-empty inside the container', async () => {
    const onSendSelection = vi.fn<(text: string) => void>()
    let container!: HTMLElement
    await act(async () => {
      const result = render(<LiveMarkdown {...defaultProps({ onSendSelection })} />)
      container = result.container
    })
    await simulateSelection('hello world', container)
    expect(screen.getByTestId('editor-selection-chip')).toBeDefined()
  })
})

// ===========================================================================
// Contract 3: chip disappears when selection clears
// ===========================================================================

describe('LiveMarkdown selection chip — chip disappears when selection clears', () => {
  it('removes the chip when selection returns to empty after being non-empty', async () => {
    const onSendSelection = vi.fn<(text: string) => void>()
    let container!: HTMLElement
    await act(async () => {
      const result = render(<LiveMarkdown {...defaultProps({ onSendSelection })} />)
      container = result.container
    })

    await simulateSelection('hello world', container)
    expect(screen.getByTestId('editor-selection-chip')).toBeDefined()

    await clearSelection()
    expect(screen.queryByTestId('editor-selection-chip')).toBeNull()
  })
})

// ===========================================================================
// Contract 4: selection OUTSIDE the container → no chip
// ===========================================================================

describe('LiveMarkdown selection chip — no chip when selection is outside container', () => {
  it('does not render the chip when anchorNode is outside the Milkdown container', async () => {
    const onSendSelection = vi.fn<(text: string) => void>()
    await act(async () => {
      render(<LiveMarkdown {...defaultProps({ onSendSelection })} />)
    })

    // Detached element — not inside the rendered container.
    const outsideNode = document.createElement('p')
    outsideNode.textContent = 'outside text'
    await simulateSelection('outside text', outsideNode)

    expect(screen.queryByTestId('editor-selection-chip')).toBeNull()
  })
})

// ===========================================================================
// Contract 5: click calls onSendSelection with real helper output
// ===========================================================================

describe('LiveMarkdown selection chip — click calls onSendSelection', () => {
  it('calls onSendSelection with formatted text on chip click', async () => {
    const onSendSelection = vi.fn<(text: string) => void>()
    let container!: HTMLElement
    await act(async () => {
      const result = render(<LiveMarkdown {...defaultProps({ onSendSelection })} />)
      container = result.container
    })

    const selectedText = 'hello world'
    await simulateSelection(selectedText, container)

    await act(async () => {
      fireEvent.click(screen.getByTestId('editor-selection-chip'))
    })

    const formatted = formatSelectionForAgent(selectedText, 'codex')
    const expectedText = `@/vault/note.md:1\n\n${formatted}`
    expect(onSendSelection).toHaveBeenCalledTimes(1)
    expect(onSendSelection).toHaveBeenCalledWith(expectedText)
  })
})

// ===========================================================================
// Contract 6: multi-line selection → fenced block
// ===========================================================================

describe('LiveMarkdown selection chip — multi-line selection is fenced', () => {
  it('calls onSendSelection with a fenced block for multi-line text', async () => {
    const onSendSelection = vi.fn<(text: string) => void>()
    let container!: HTMLElement
    await act(async () => {
      const result = render(<LiveMarkdown {...defaultProps({ onSendSelection })} />)
      container = result.container
    })

    const selectedText = 'hello world\nfoo bar'
    await simulateSelection(selectedText, container)

    await act(async () => {
      fireEvent.click(screen.getByTestId('editor-selection-chip'))
    })

    const formatted = formatSelectionForAgent(selectedText, 'codex')
    const expectedText = `@/vault/note.md:1-2\n\n${formatted}`
    expect(formatted).toMatch(/^```\n/)
    expect(onSendSelection).toHaveBeenCalledWith(expectedText)
  })
})

// ===========================================================================
// Contract 7: single-line selection → bare text
// ===========================================================================

describe('LiveMarkdown selection chip — single-line selection is bare text', () => {
  it('calls onSendSelection with bare text for a single-line selection', async () => {
    const onSendSelection = vi.fn<(text: string) => void>()
    let container!: HTMLElement
    await act(async () => {
      const result = render(<LiveMarkdown {...defaultProps({ onSendSelection })} />)
      container = result.container
    })

    const selectedText = 'hello world'
    await simulateSelection(selectedText, container)

    await act(async () => {
      fireEvent.click(screen.getByTestId('editor-selection-chip'))
    })

    const formatted = formatSelectionForAgent(selectedText, 'codex')
    const expectedText = `@/vault/note.md:1\n\n${formatted}`
    expect(formatted).toBe('hello world')
    expect(formatted).not.toMatch(/^```/)
    expect(onSendSelection).toHaveBeenCalledWith(expectedText)
  })
})

// ===========================================================================
// Contract 8: chip activates in both edit mode and preview mode
// ===========================================================================

describe('LiveMarkdown selection chip — activates in edit and preview mode', () => {
  it('shows chip when selection is non-empty in edit mode (default)', async () => {
    const onSendSelection = vi.fn<(text: string) => void>()
    let container!: HTMLElement
    await act(async () => {
      const result = render(<LiveMarkdown {...defaultProps({ onSendSelection })} />)
      container = result.container
    })
    await simulateSelection('edit mode text', container)
    expect(screen.getByTestId('editor-selection-chip')).toBeDefined()
  })

  it('shows chip for selection in a second instance (preview/read content)', async () => {
    const onSendSelection = vi.fn<(text: string) => void>()
    let container!: HTMLElement
    await act(async () => {
      const result = render(
        <LiveMarkdown
          {...defaultProps({
            onSendSelection,
            body: '# Preview heading\nsome text',
            remountKey: 'preview',
          })}
        />,
      )
      container = result.container
    })
    await simulateSelection('some text', container)
    expect(screen.getByTestId('editor-selection-chip')).toBeDefined()
  })
})

// ===========================================================================
// Contract 9: chip lands at the trailing edge of the last line
// (regression — multi-line bounding rect placed chip past the longest line)
// ===========================================================================

describe('LiveMarkdown selection chip — multi-line position uses trailing rect', () => {
  it('positions the chip at the last client rect, not the bounding union', async () => {
    const onSendSelection = vi.fn<(text: string) => void>()
    let container!: HTMLElement
    await act(async () => {
      const result = render(<LiveMarkdown {...defaultProps({ onSendSelection })} />)
      container = result.container
    })
    // Line 1 extends far right; line 2 ends much earlier. Bounding union would
    // put the chip past line 1's right edge — wrong. Last-rect picks line 2's end.
    const rects: FakeRect[] = [
      { top: 100, bottom: 116, left: 200, right: 900 },
      { top: 120, bottom: 136, left: 200, right: 350 },
    ]
    await simulateSelection('multi\nline', container, rects)
    const chip = screen.getByTestId('editor-selection-chip') as HTMLElement
    expect(chip.style.left).toBe('350px')
    expect(chip.style.top).toBe('136px')
  })
})

// ===========================================================================
// Contract 10: zero-width trailing rect is skipped
// (ProseMirror emits caret rects at paragraph boundaries that collapse to the
// right edge of the formatting context — would pull the chip far off)
// ===========================================================================

describe('LiveMarkdown selection chip — skips zero-width trailing rect', () => {
  it('uses the last non-empty rect when a zero-width caret rect trails it', async () => {
    const onSendSelection = vi.fn<(text: string) => void>()
    let container!: HTMLElement
    await act(async () => {
      const result = render(<LiveMarkdown {...defaultProps({ onSendSelection })} />)
      container = result.container
    })
    // Real text rect on line 2 ends at right=350. Trailing zero-width rect at
    // right=1200 simulates the caret rect at the end of a paragraph block.
    const rects: FakeRect[] = [
      { top: 100, bottom: 116, left: 200, right: 900 },
      { top: 120, bottom: 136, left: 200, right: 350 },
      { top: 120, bottom: 136, left: 1200, right: 1200 },
    ]
    await simulateSelection('multi\nline', container, rects)
    const chip = screen.getByTestId('editor-selection-chip') as HTMLElement
    expect(chip.style.left).toBe('350px')
    expect(chip.style.top).toBe('136px')
  })
})
