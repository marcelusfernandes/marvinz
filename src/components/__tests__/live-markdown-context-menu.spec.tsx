/**
 * Component tests for LiveMarkdown (Milkdown/ProseMirror) context menu.
 * Issue #154: native context menu in editors.
 *
 * Strategy:
 *  - Mock @milkdown/react so useEditor returns a controlled editorInfo stub.
 *  - Mock @milkdown/core so editorViewCtx is a stable symbol and ctx.get
 *    returns our fake ProseMirror view.
 *  - Mock prosemirror-history and prosemirror-commands.
 *  - Assert: right-click → IPC invoked; mocked action → correct PM command.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'

// ClipboardEvent polyfill (jsdom omits it)
if (typeof globalThis.ClipboardEvent === 'undefined') {
  class ClipboardEvent extends Event {
    readonly clipboardData: DataTransfer | null
    constructor(type: string, init?: ClipboardEventInit) {
      super(type, init)
      this.clipboardData = init?.clipboardData ?? null
    }
  }
  Object.defineProperty(globalThis, 'ClipboardEvent', { value: ClipboardEvent, writable: true })
}

// ---------------------------------------------------------------------------
// Fake ProseMirror view
// ---------------------------------------------------------------------------

type FakePMState = {
  selection: { empty: boolean; from: number; to: number }
  _undoDepth: number
  _redoDepth: number
  doc: { textBetween: (from: number, to: number, blockSep?: string, leafText?: string) => string }
  tr: {
    deleteSelection: () => { _kind: 'delete' }
    insertText: (text: string) => { _kind: 'insertText'; _text: string }
  }
}

function makePMState(overrides: Partial<{ hasSelection: boolean; undoDepth: number; redoDepth: number; docText: string; selectionFrom: number; selectionTo: number }> = {}): FakePMState {
  const docText = overrides.docText ?? 'hello world'
  const from = overrides.selectionFrom ?? 0
  const to = overrides.selectionTo ?? (overrides.hasSelection ? 5 : 0)
  return {
    selection: { empty: !overrides.hasSelection, from, to },
    _undoDepth: overrides.undoDepth ?? 0,
    _redoDepth: overrides.redoDepth ?? 0,
    doc: {
      textBetween: (f: number, t: number) => docText.slice(f, t),
    },
    tr: {
      deleteSelection: () => ({ _kind: 'delete' }),
      insertText: (text: string) => ({ _kind: 'insertText', _text: text }),
    },
  }
}

type FakePMView = {
  state: FakePMState
  dom: HTMLElement
  focus: ReturnType<typeof vi.fn>
  dispatch: ReturnType<typeof vi.fn>
}

function makePMView(stateOverrides?: Parameters<typeof makePMState>[0]): FakePMView {
  const dom = document.createElement('div')
  dom.setAttribute('data-pm-content', 'true')
  return {
    state: makePMState(stateOverrides),
    dom,
    focus: vi.fn(),
    dispatch: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Current fake view (reassigned per test in beforeEach)
// ---------------------------------------------------------------------------

let currentPMView: FakePMView = makePMView()

// ---------------------------------------------------------------------------
// Mock prosemirror-history
// ---------------------------------------------------------------------------

// Implementations mutate fake state so state-change assertions are meaningful.
const mockPMUndo = vi.fn((state: FakePMState, _dispatch: unknown) => {
  if (state._undoDepth > 0) {
    state._undoDepth -= 1
    state._redoDepth += 1
  }
})
const mockPMRedo = vi.fn((state: FakePMState, _dispatch: unknown) => {
  if (state._redoDepth > 0) {
    state._redoDepth -= 1
    state._undoDepth += 1
  }
})

vi.mock('prosemirror-history', () => ({
  undo: (...args: unknown[]) => mockPMUndo(...(args as [FakePMState, unknown])),
  redo: (...args: unknown[]) => mockPMRedo(...(args as [FakePMState, unknown])),
  undoDepth: (state: FakePMState) => state._undoDepth,
  redoDepth: (state: FakePMState) => state._redoDepth,
}))

// ---------------------------------------------------------------------------
// Mock prosemirror-commands
// ---------------------------------------------------------------------------

const mockPMSelectAll = vi.fn((state: FakePMState, _dispatch: unknown, _view: unknown) => {
  // Simulate selectAll: mark selection as covering the whole doc (non-empty).
  state.selection.empty = false
})

vi.mock('prosemirror-commands', () => ({
  selectAll: (...args: unknown[]) => mockPMSelectAll(...(args as [FakePMState, unknown, unknown])),
}))

// ---------------------------------------------------------------------------
// Stable editorViewCtx symbol — hoisted so it's available inside vi.mock factories
// ---------------------------------------------------------------------------

const { EDITOR_VIEW_CTX } = vi.hoisted(() => ({
  EDITOR_VIEW_CTX: Symbol('editorViewCtx'),
}))

vi.mock('@milkdown/core', () => ({
  Editor: { make: () => ({ config: () => ({}), use: () => ({}) }) },
  defaultValueCtx: Symbol('defaultValueCtx'),
  editorViewCtx: EDITOR_VIEW_CTX,
  editorViewOptionsCtx: Symbol('editorViewOptionsCtx'),
  rootCtx: Symbol('rootCtx'),
}))

// ---------------------------------------------------------------------------
// Mock @milkdown/react — expose editorInfo.get() returning our fake PM view
// ---------------------------------------------------------------------------

// Milkdown component renders nothing; useEditor is a vi.fn() whose
// implementation is set per-test in beforeEach (re-mocked after clearAllMocks).
const mockUseEditor = vi.fn()
vi.mock('@milkdown/react', () => ({
  Milkdown: () => null,
  MilkdownProvider: ({ children }: { children: React.ReactNode }) => children,
  useEditor: (...args: unknown[]) => mockUseEditor(...args),
}))

// ---------------------------------------------------------------------------
// Mock other milkdown deps
// ---------------------------------------------------------------------------

vi.mock('@milkdown/preset-commonmark', () => ({
  commonmark: {},
  imageSchema: { node: {} },
}))
vi.mock('@milkdown/preset-gfm', () => ({ gfm: {} }))
vi.mock('@milkdown/plugin-listener', () => ({
  listener: {},
  listenerCtx: Symbol('listenerCtx'),
}))
vi.mock('@milkdown/plugin-history', () => ({ history: [] }))
vi.mock('@milkdown/utils', () => ({ $view: () => ({}) }))
vi.mock('@milkdown/prose/view', () => ({}))

// ---------------------------------------------------------------------------
// Mock internal libs
// ---------------------------------------------------------------------------

vi.mock('../lib/imageNodeView', () => ({ imageNodeView: () => ({}) }))
vi.mock('../lib/wikilinks', () => ({
  parseWikilinks: (s: string) => s,
  unparseWikilinks: (s: string) => s,
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
let writeClipboardMock: ReturnType<typeof vi.fn>
let readClipboardMock: ReturnType<typeof vi.fn>

function setupMarvinMock() {
  showContextMenuMock = vi.fn()
  canPasteMock = vi.fn().mockResolvedValue(false)
  writeClipboardMock = vi.fn().mockResolvedValue(undefined)
  readClipboardMock = vi.fn().mockResolvedValue('')
  Object.defineProperty(globalThis, 'window', {
    value: {
      ...(typeof window !== 'undefined' ? window : {}),
      marvin: {
        app: {
          showContextMenu: showContextMenuMock,
          canPaste: canPasteMock,
        },
        editor: {
          writeClipboard: writeClipboardMock,
          readClipboard: readClipboardMock,
        },
        shell: { openExternal: vi.fn() },
      },
    },
    writable: true,
    configurable: true,
  })
}

// ---------------------------------------------------------------------------
// Minimal LiveMarkdown props
// ---------------------------------------------------------------------------

function defaultProps() {
  return {
    body: 'hello world',
    onChange: vi.fn(),
    onLinkClick: vi.fn(),
    filePath: '/vault/note.md',
    vaultPath: '/vault',
    paletteItems: [],
    remountKey: 'key1',
  }
}

// ---------------------------------------------------------------------------
// Right-click helper — fires contextmenu on the .live-md wrapper, patching
// view.dom.contains to return true so the handler proceeds.
// ---------------------------------------------------------------------------

function rightClickLiveMD(container: HTMLElement): void {
  const wrapper = container.querySelector('.live-md') as HTMLElement | null
  if (!wrapper) throw new Error('.live-md wrapper not found in render')
  const orig = currentPMView.dom.contains.bind(currentPMView.dom)
  currentPMView.dom.contains = () => true
  fireEvent.contextMenu(wrapper)
  currentPMView.dom.contains = orig
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  setupMarvinMock()
  mockPMUndo.mockReset()
  mockPMRedo.mockReset()
  mockPMSelectAll.mockReset()
  // Reconfigure useEditor to return editorInfo with the current fake PM view.
  // Done here so currentPMView (set per-test) is captured at call time.
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
// LiveMarkdown context menu — IPC payload
// ---------------------------------------------------------------------------

describe('LiveMarkdown — context menu triggers IPC with correct payload', () => {
  it('calls showContextMenu once with an items array', async () => {
    currentPMView = makePMView({ hasSelection: false })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(showContextMenuMock).toHaveBeenCalledTimes(1)
    const [items] = showContextMenuMock.mock.calls[0] as [Array<{ kind: string; id?: string; label?: string; enabled?: boolean }>]
    expect(Array.isArray(items)).toBe(true)
  })

  it('Cut item is disabled when nothing is selected', async () => {
    currentPMView = makePMView({ hasSelection: false })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [Array<{ kind: string; id?: string; label?: string; enabled?: boolean }>]
    const cut = items.find(i => i.id === 'cut')
    expect(cut?.enabled).toBe(false)
  })

  it('Cut item is enabled when text is selected', async () => {
    currentPMView = makePMView({ hasSelection: true })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [Array<{ kind: string; id?: string; label?: string; enabled?: boolean }>]
    const cut = items.find(i => i.id === 'cut')
    expect(cut?.enabled).toBe(true)
  })

  it('Copy item is disabled when nothing is selected', async () => {
    currentPMView = makePMView({ hasSelection: false })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [Array<{ kind: string; id?: string; label?: string; enabled?: boolean }>]
    const copy = items.find(i => i.id === 'copy')
    expect(copy?.enabled).toBe(false)
  })

  it('Copy item is enabled when text is selected', async () => {
    currentPMView = makePMView({ hasSelection: true })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [Array<{ kind: string; id?: string; label?: string; enabled?: boolean }>]
    const copy = items.find(i => i.id === 'copy')
    expect(copy?.enabled).toBe(true)
  })

  it('Undo item is disabled when undoDepth is 0', async () => {
    currentPMView = makePMView({ undoDepth: 0 })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [Array<{ kind: string; id?: string; label?: string; enabled?: boolean }>]
    const undo = items.find(i => i.id === 'undo')
    expect(undo?.enabled).toBe(false)
  })

  it('Undo item is enabled when undoDepth > 0', async () => {
    currentPMView = makePMView({ undoDepth: 3 })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [Array<{ kind: string; id?: string; label?: string; enabled?: boolean }>]
    const undo = items.find(i => i.id === 'undo')
    expect(undo?.enabled).toBe(true)
  })

  it('Redo item is disabled when redoDepth is 0', async () => {
    currentPMView = makePMView({ redoDepth: 0 })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [Array<{ kind: string; id?: string; label?: string; enabled?: boolean }>]
    const redo = items.find(i => i.id === 'redo')
    expect(redo?.enabled).toBe(false)
  })

  it('Redo item is enabled when redoDepth > 0', async () => {
    currentPMView = makePMView({ redoDepth: 2 })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [Array<{ kind: string; id?: string; label?: string; enabled?: boolean }>]
    const redo = items.find(i => i.id === 'redo')
    expect(redo?.enabled).toBe(true)
  })

  it('Paste item is disabled when canPaste returns false', async () => {
    currentPMView = makePMView()
    canPasteMock.mockResolvedValue(false)
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [Array<{ kind: string; id?: string; label?: string; enabled?: boolean }>]
    const paste = items.find(i => i.id === 'paste')
    expect(paste?.enabled).toBe(false)
  })

  it('Paste item is enabled when canPaste returns true', async () => {
    currentPMView = makePMView()
    canPasteMock.mockResolvedValue(true)
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [Array<{ kind: string; id?: string; label?: string; enabled?: boolean }>]
    const paste = items.find(i => i.id === 'paste')
    expect(paste?.enabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// LiveMarkdown context menu — action dispatch
// ---------------------------------------------------------------------------

describe('LiveMarkdown — context menu action dispatch', () => {
  it('calls PM selectAll when action is selectAll', async () => {
    currentPMView = makePMView()
    showContextMenuMock.mockResolvedValue('selectAll')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(mockPMSelectAll).toHaveBeenCalledWith(
      currentPMView.state,
      currentPMView.dispatch,
      currentPMView,
    )
  })

  it('calls PM undo when action is undo', async () => {
    currentPMView = makePMView({ undoDepth: 1 })
    showContextMenuMock.mockResolvedValue('undo')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(mockPMUndo).toHaveBeenCalledWith(currentPMView.state, currentPMView.dispatch)
  })

  it('calls PM redo when action is redo', async () => {
    currentPMView = makePMView({ redoDepth: 1 })
    showContextMenuMock.mockResolvedValue('redo')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(mockPMRedo).toHaveBeenCalledWith(currentPMView.state, currentPMView.dispatch)
  })

  it('writes selected text to clipboard when action is cut, then dispatches deleteSelection', async () => {
    currentPMView = makePMView({ hasSelection: true, docText: 'hello world', selectionFrom: 0, selectionTo: 5 })
    showContextMenuMock.mockResolvedValue('cut')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(writeClipboardMock).toHaveBeenCalledWith('hello')
    expect(currentPMView.dispatch).toHaveBeenCalledWith({ _kind: 'delete' })
  })

  it('writes selected text to clipboard when action is copy, without dispatching', async () => {
    currentPMView = makePMView({ hasSelection: true, docText: 'hello world', selectionFrom: 0, selectionTo: 5 })
    showContextMenuMock.mockResolvedValue('copy')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(writeClipboardMock).toHaveBeenCalledWith('hello')
    expect(currentPMView.dispatch).not.toHaveBeenCalled()
  })

  it('reads clipboard and dispatches insertText when action is paste', async () => {
    currentPMView = makePMView()
    readClipboardMock.mockResolvedValue('pasted text')
    showContextMenuMock.mockResolvedValue('paste')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(readClipboardMock).toHaveBeenCalled()
    expect(currentPMView.dispatch).toHaveBeenCalledWith({ _kind: 'insertText', _text: 'pasted text' })
  })

  it('does not write clipboard when cut/copy has empty selection', async () => {
    currentPMView = makePMView({ hasSelection: false })
    showContextMenuMock.mockResolvedValue('cut')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(writeClipboardMock).not.toHaveBeenCalled()
  })

  it('calls view.focus() after any action', async () => {
    currentPMView = makePMView()
    showContextMenuMock.mockResolvedValue('selectAll')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(currentPMView.focus).toHaveBeenCalledTimes(1)
  })

  it('does not dispatch any action when showContextMenu resolves null', async () => {
    currentPMView = makePMView()
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(mockPMSelectAll).not.toHaveBeenCalled()
    expect(mockPMUndo).not.toHaveBeenCalled()
    expect(mockPMRedo).not.toHaveBeenCalled()
    expect(currentPMView.focus).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// LiveMarkdown — state changes after context menu action
// ---------------------------------------------------------------------------

describe('LiveMarkdown — state changes after context menu action', () => {
  it('undo decreases undoDepth by 1', async () => {
    currentPMView = makePMView({ undoDepth: 3, redoDepth: 0 })
    showContextMenuMock.mockResolvedValue('undo')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(currentPMView.state._undoDepth).toBe(2)
  })

  it('undo increases redoDepth by 1', async () => {
    currentPMView = makePMView({ undoDepth: 2, redoDepth: 0 })
    showContextMenuMock.mockResolvedValue('undo')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(currentPMView.state._redoDepth).toBe(1)
  })

  it('undo does not change depth when undoDepth is already 0', async () => {
    currentPMView = makePMView({ undoDepth: 0 })
    showContextMenuMock.mockResolvedValue('undo')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(currentPMView.state._undoDepth).toBe(0)
  })

  it('redo decreases redoDepth by 1', async () => {
    currentPMView = makePMView({ undoDepth: 0, redoDepth: 2 })
    showContextMenuMock.mockResolvedValue('redo')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(currentPMView.state._redoDepth).toBe(1)
  })

  it('redo increases undoDepth by 1', async () => {
    currentPMView = makePMView({ undoDepth: 1, redoDepth: 1 })
    showContextMenuMock.mockResolvedValue('redo')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(currentPMView.state._undoDepth).toBe(2)
  })

  it('selectAll makes selection non-empty (covers whole doc)', async () => {
    currentPMView = makePMView({ hasSelection: false })
    showContextMenuMock.mockResolvedValue('selectAll')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(currentPMView.state.selection.empty).toBe(false)
  })

  it('null action leaves undoDepth unchanged', async () => {
    currentPMView = makePMView({ undoDepth: 2 })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(currentPMView.state._undoDepth).toBe(2)
  })
})
