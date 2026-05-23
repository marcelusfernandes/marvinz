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
  selection: { empty: boolean }
  _undoDepth: number
  _redoDepth: number
}

function makePMState(overrides: Partial<{ hasSelection: boolean; undoDepth: number; redoDepth: number }> = {}): FakePMState {
  return {
    selection: { empty: !overrides.hasSelection },
    _undoDepth: overrides.undoDepth ?? 0,
    _redoDepth: overrides.redoDepth ?? 0,
  }
}

type FakePMView = {
  state: FakePMState
  dom: HTMLElement
  focus: ReturnType<typeof vi.fn>
  dispatch: ReturnType<typeof vi.fn>
  _dispatchedClipboard: ClipboardEvent[]
}

function makePMView(stateOverrides?: Parameters<typeof makePMState>[0]): FakePMView {
  const dom = document.createElement('div')
  dom.setAttribute('data-pm-content', 'true')
  const dispatched: ClipboardEvent[] = []
  dom.addEventListener('cut', (e) => dispatched.push(e as ClipboardEvent))
  dom.addEventListener('copy', (e) => dispatched.push(e as ClipboardEvent))
  dom.addEventListener('paste', (e) => dispatched.push(e as ClipboardEvent))
  return {
    state: makePMState(stateOverrides),
    dom,
    focus: vi.fn(),
    dispatch: vi.fn(),
    _dispatchedClipboard: dispatched,
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

function setupMarvinMock() {
  showContextMenuMock = vi.fn()
  Object.defineProperty(globalThis, 'window', {
    value: {
      ...(typeof window !== 'undefined' ? window : {}),
      marvin: {
        editor: { showContextMenu: showContextMenuMock },
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
  it('calls showContextMenu with hasSelection=false when nothing selected', async () => {
    currentPMView = makePMView({ hasSelection: false })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(showContextMenuMock).toHaveBeenCalledTimes(1)
    expect(showContextMenuMock).toHaveBeenCalledWith(
      expect.objectContaining({ hasSelection: false }),
    )
  })

  it('calls showContextMenu with hasSelection=true when text is selected', async () => {
    currentPMView = makePMView({ hasSelection: true })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(showContextMenuMock).toHaveBeenCalledWith(
      expect.objectContaining({ hasSelection: true }),
    )
  })

  it('calls showContextMenu with canUndo=false when undoDepth is 0', async () => {
    currentPMView = makePMView({ undoDepth: 0 })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(showContextMenuMock).toHaveBeenCalledWith(
      expect.objectContaining({ canUndo: false }),
    )
  })

  it('calls showContextMenu with canUndo=true when undoDepth > 0', async () => {
    currentPMView = makePMView({ undoDepth: 3 })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(showContextMenuMock).toHaveBeenCalledWith(
      expect.objectContaining({ canUndo: true }),
    )
  })

  it('calls showContextMenu with canRedo=false when redoDepth is 0', async () => {
    currentPMView = makePMView({ redoDepth: 0 })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(showContextMenuMock).toHaveBeenCalledWith(
      expect.objectContaining({ canRedo: false }),
    )
  })

  it('calls showContextMenu with canRedo=true when redoDepth > 0', async () => {
    currentPMView = makePMView({ redoDepth: 2 })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(showContextMenuMock).toHaveBeenCalledWith(
      expect.objectContaining({ canRedo: true }),
    )
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

  it('dispatches a cut ClipboardEvent on view.dom when action is cut', async () => {
    currentPMView = makePMView({ hasSelection: true })
    showContextMenuMock.mockResolvedValue('cut')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(currentPMView._dispatchedClipboard.some(e => e.type === 'cut')).toBe(true)
  })

  it('dispatches a copy ClipboardEvent on view.dom when action is copy', async () => {
    currentPMView = makePMView({ hasSelection: true })
    showContextMenuMock.mockResolvedValue('copy')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(currentPMView._dispatchedClipboard.some(e => e.type === 'copy')).toBe(true)
  })

  it('dispatches a paste ClipboardEvent on view.dom when action is paste', async () => {
    currentPMView = makePMView()
    showContextMenuMock.mockResolvedValue('paste')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(currentPMView._dispatchedClipboard.some(e => e.type === 'paste')).toBe(true)
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
