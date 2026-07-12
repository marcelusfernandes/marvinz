/**
 * Component tests for LiveMarkdown spellcheck suggestions in the context menu
 * (issue #167).
 *
 * The native context menu surfaces dictionary suggestions for a misspelled word
 * via `window.marvin.editor.getSpellcheckContext()`. Clicking a suggestion
 * replaces the misspelled word's range — resolved from the caret's textblock,
 * not the current selection.
 *
 * Mock strategy mirrors live-markdown-context-menu.spec.tsx: stub
 * `@milkdown/react`'s `useEditor` to return a fake editor whose ctx exposes a
 * controlled ProseMirror view, and assert menu items + dispatched transaction.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, act } from '@testing-library/react'
import { renderWithAppContext as render } from './renderWithAppContext'
import { misspelledWordRange } from '../LiveMarkdown'

// ---------------------------------------------------------------------------
// Fake ProseMirror view — selection.$from resolves a textblock so the
// word-boundary scan in misspelledWordRange has something to walk.
// ---------------------------------------------------------------------------

type FakePMState = {
  selection: {
    empty: boolean
    from: number
    to: number
    $from: {
      pos: number
      parent: { isTextblock: boolean; textContent: string }
      start: () => number
    }
  }
  _undoDepth: number
  _redoDepth: number
  doc: {
    textBetween: (from: number, to: number) => string
    slice: () => { content: { _fragment: true } }
  }
  tr: {
    deleteSelection: () => { _kind: 'delete' }
    insertText: (
      text: string,
      from?: number,
      to?: number
    ) => { _kind: 'insertText'; _text: string; _from?: number; _to?: number }
    replaceSelection: (slice: unknown) => { _kind: 'replaceSelection'; _slice: unknown }
  }
}

function makePMState(
  overrides: Partial<{ blockText: string; caret: number; blockStart: number }> = {}
): FakePMState {
  const blockText = overrides.blockText ?? 'this is teh word'
  const blockStart = overrides.blockStart ?? 1
  const caret = overrides.caret ?? blockStart + blockText.indexOf('teh')
  return {
    selection: {
      empty: true,
      from: caret,
      to: caret,
      $from: {
        pos: caret,
        parent: { isTextblock: true, textContent: blockText },
        start: () => blockStart,
      },
    },
    _undoDepth: 0,
    _redoDepth: 0,
    doc: {
      textBetween: () => '',
      slice: () => ({ content: { _fragment: true as const } }),
    },
    tr: {
      deleteSelection: () => ({ _kind: 'delete' }),
      insertText: (text: string, from?: number, to?: number) => ({
        _kind: 'insertText',
        _text: text,
        _from: from,
        _to: to,
      }),
      replaceSelection: (slice: unknown) => ({ _kind: 'replaceSelection', _slice: slice }),
    },
  }
}

type FakePMView = {
  state: FakePMState
  dom: HTMLElement
  focus: ReturnType<typeof vi.fn>
  dispatch: ReturnType<typeof vi.fn>
  someProp: (name: string) => unknown
}

function makePMView(stateOverrides?: Parameters<typeof makePMState>[0]): FakePMView {
  const dom = document.createElement('div')
  dom.setAttribute('data-pm-content', 'true')
  return {
    state: makePMState(stateOverrides),
    dom,
    focus: vi.fn(),
    dispatch: vi.fn(),
    someProp: () => undefined,
  }
}

let currentPMView: FakePMView = makePMView()

// ---------------------------------------------------------------------------
// Mocks for prosemirror + milkdown deps (LiveMarkdown imports these eagerly)
// ---------------------------------------------------------------------------

vi.mock('prosemirror-history', () => ({
  undo: vi.fn(),
  redo: vi.fn(),
  undoDepth: (state: FakePMState) => state._undoDepth,
  redoDepth: (state: FakePMState) => state._redoDepth,
  history: () => ({}),
}))

vi.mock('prosemirror-commands', () => ({ selectAll: vi.fn() }))

const { EDITOR_VIEW_CTX } = vi.hoisted(() => ({
  EDITOR_VIEW_CTX: Symbol('editorViewCtx'),
}))

vi.mock('@milkdown/core', () => ({
  Editor: { make: () => ({ config: () => ({}), use: () => ({}) }) },
  defaultValueCtx: Symbol('defaultValueCtx'),
  editorViewCtx: EDITOR_VIEW_CTX,
  editorViewOptionsCtx: Symbol('editorViewOptionsCtx'),
  parserCtx: Symbol('parserCtx'),
  prosePluginsCtx: Symbol('prosePluginsCtx'),
  rootCtx: Symbol('rootCtx'),
}))

const mockUseEditor = vi.fn()
vi.mock('@milkdown/react', () => ({
  Milkdown: () => null,
  MilkdownProvider: ({ children }: { children: React.ReactNode }) => children,
  useEditor: (...args: unknown[]) => mockUseEditor(...args),
}))

vi.mock('@milkdown/preset-commonmark', () => ({
  commonmark: {},
  imageSchema: { node: {} },
  codeBlockSchema: { node: {} },
  bulletListSchema: { type: () => ({}) },
  listItemSchema: { type: () => ({}) },
}))
vi.mock('@milkdown/preset-gfm', () => ({ gfm: {}, extendListItemSchemaForTask: { node: {} } }))
vi.mock('@milkdown/plugin-listener', () => ({
  listener: {},
  listenerCtx: Symbol('listenerCtx'),
}))
vi.mock('@milkdown/plugin-history', () => ({ history: [] }))
vi.mock('@milkdown/utils', () => ({ $view: () => ({}), $inputRule: () => ({}) }))
vi.mock('@milkdown/prose/view', () => ({}))

vi.mock('../lib/imageNodeView', () => ({ imageNodeView: () => ({}) }))
vi.mock('../lib/wikilinks', () => ({
  parseWikilinks: (s: string) => s,
  unparseWikilinks: (s: string) => s,
  stripMdExt: (s: string) => s,
}))

// ---------------------------------------------------------------------------
// Import LiveMarkdown after all mocks
// ---------------------------------------------------------------------------

import { LiveMarkdown } from '../LiveMarkdown'

// ---------------------------------------------------------------------------
// window.marvin mock
// ---------------------------------------------------------------------------

let showContextMenuMock: ReturnType<typeof vi.fn>
let canPasteMock: ReturnType<typeof vi.fn>
let getSpellcheckContextMock: ReturnType<typeof vi.fn>

function setupMarvinMock() {
  showContextMenuMock = vi.fn().mockResolvedValue(null)
  canPasteMock = vi.fn().mockResolvedValue(false)
  getSpellcheckContextMock = vi.fn().mockResolvedValue({ misspelledWord: '', suggestions: [] })
  Object.defineProperty(globalThis, 'window', {
    value: {
      ...(typeof window !== 'undefined' ? window : {}),
      marvin: {
        app: { showContextMenu: showContextMenuMock, canPaste: canPasteMock },
        editor: {
          writeClipboard: vi.fn(),
          readClipboard: vi.fn(),
          writeClipboardRich: vi.fn().mockResolvedValue(undefined),
          readClipboardRich: vi.fn().mockResolvedValue({ html: '', text: '' }),
          getSpellcheckContext: getSpellcheckContextMock,
        },
        shell: { openExternal: vi.fn() },
      },
    },
    writable: true,
    configurable: true,
  })
}

function defaultProps() {
  return {
    body: 'this is teh word',
    onChange: vi.fn(),
    onLinkClick: vi.fn(),
    filePath: '/vault/note.md',
    vaultPath: '/vault',
    paletteItems: [],
    remountKey: 'key1',
  }
}

function rightClickLiveMD(container: HTMLElement): void {
  const wrapper = container.querySelector('.live-md') as HTMLElement | null
  if (!wrapper) throw new Error('.live-md wrapper not found in render')
  const orig = currentPMView.dom.contains.bind(currentPMView.dom)
  currentPMView.dom.contains = () => true
  fireEvent.contextMenu(wrapper)
  currentPMView.dom.contains = orig
}

type Item = { kind: string; id?: string; label?: string; enabled?: boolean }

beforeEach(() => {
  setupMarvinMock()
  mockUseEditor.mockImplementation(() => ({
    get: () => ({
      ctx: {
        get: (key: symbol) => {
          if (key === EDITOR_VIEW_CTX) return currentPMView
          throw new Error(`Unknown ctx key: ${String(key)}`)
        },
      },
    }),
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// misspelledWordRange — word-boundary resolution unit tests
// ---------------------------------------------------------------------------

describe('misspelledWordRange', () => {
  it('resolves the document range of the word under the caret', () => {
    const state = makePMState({ blockText: 'this is teh word', blockStart: 1 })
    // 'teh' starts at offset 8 in the block; block starts at doc pos 1.
    expect(misspelledWordRange(state as never, 'teh')).toEqual({ from: 9, to: 12 })
  })

  it('picks the occurrence under the caret when the word repeats', () => {
    const blockText = 'teh and teh'
    const blockStart = 1
    const caret = blockStart + 8 // inside the second 'teh'
    const state = makePMState({ blockText, blockStart, caret })
    expect(misspelledWordRange(state as never, 'teh')).toEqual({ from: 9, to: 12 })
  })

  it('returns null when the word is not in the caret block', () => {
    const state = makePMState({ blockText: 'all correct here', blockStart: 1 })
    expect(misspelledWordRange(state as never, 'teh')).toBeNull()
  })

  it('returns null for an empty word', () => {
    const state = makePMState()
    expect(misspelledWordRange(state as never, '')).toBeNull()
  })

  it('returns null when the caret is not in a textblock', () => {
    const state = makePMState()
    state.selection.$from.parent.isTextblock = false
    expect(misspelledWordRange(state as never, 'teh')).toBeNull()
  })

  it('returns null when the caret sits in the gap right after the word', () => {
    // 'teh' at offset 0..3; caret at offset 3 is on the following space, not in the word.
    const blockText = 'teh world'
    const blockStart = 1
    const state = makePMState({ blockText, blockStart, caret: blockStart + 3 })
    expect(misspelledWordRange(state as never, 'teh')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Context menu items — suggestion block
// ---------------------------------------------------------------------------

describe('LiveMarkdown spellcheck — menu items', () => {
  it('prepends up to 5 suggestions + separator above Cut when a word is misspelled', async () => {
    currentPMView = makePMView()
    getSpellcheckContextMock.mockResolvedValue({
      misspelledWord: 'teh',
      suggestions: ['the', 'tech', 'ten', 'tea', 'tel', 'teht'],
    })
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [Item[]]
    const spellItems = items.filter((i) => i.id?.startsWith('spell:'))
    expect(spellItems).toHaveLength(5)
    expect(spellItems.map((i) => i.label)).toEqual(['the', 'tech', 'ten', 'tea', 'tel'])
    // Separator sits between the last suggestion and Cut.
    const cutIdx = items.findIndex((i) => i.id === 'cut')
    expect(items[cutIdx - 1].kind).toBe('separator')
    expect(items.slice(0, 5).every((i) => i.id?.startsWith('spell:'))).toBe(true)
  })

  it('dispatches insertText over the resolved word range when a suggestion is clicked', async () => {
    currentPMView = makePMView({ blockText: 'this is teh word', blockStart: 1 })
    getSpellcheckContextMock.mockResolvedValue({
      misspelledWord: 'teh',
      suggestions: ['the', 'tech'],
    })
    showContextMenuMock.mockResolvedValue('spell:0')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(currentPMView.dispatch).toHaveBeenCalledWith({
      _kind: 'insertText',
      _text: 'the',
      _from: 9,
      _to: 12,
    })
    expect(currentPMView.focus).toHaveBeenCalled()
  })

  it('renders an identical menu (no suggestion items) when there is no misspelled word', async () => {
    currentPMView = makePMView()
    getSpellcheckContextMock.mockResolvedValue({ misspelledWord: '', suggestions: [] })
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [Item[]]
    expect(items.some((i) => i.id?.startsWith('spell:'))).toBe(false)
    expect(items[0].id).toBe('cut')
  })

  it('renders no suggestion block when a word is present but suggestions are empty', async () => {
    currentPMView = makePMView()
    getSpellcheckContextMock.mockResolvedValue({ misspelledWord: 'teh', suggestions: [] })
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [Item[]]
    expect(items.some((i) => i.id?.startsWith('spell:'))).toBe(false)
    expect(items[0].id).toBe('cut')
  })

  it('does not dispatch when the word range cannot be resolved', async () => {
    currentPMView = makePMView({ blockText: 'no match here', blockStart: 1 })
    getSpellcheckContextMock.mockResolvedValue({ misspelledWord: 'teh', suggestions: ['the'] })
    showContextMenuMock.mockResolvedValue('spell:0')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(currentPMView.dispatch).not.toHaveBeenCalled()
    // Still refocuses so the editor isn't left blurred.
    expect(currentPMView.focus).toHaveBeenCalled()
  })
})
