/**
 * Component tests for context menu integration — Editor (CodeMirror) and
 * LiveMarkdown (Milkdown/ProseMirror).
 * Issue #154: native context menu in editors.
 *
 * Strategy:
 *  - Mock @uiw/react-codemirror to render a plain div that forwards
 *    onContextMenu and fires onCreateEditor with a fake EditorView.
 *  - Mock @milkdown/react and @milkdown/core so LiveMarkdown renders its
 *    wrapper div and exposes a fake ProseMirror view via editorInfo.get().
 *  - Mock window.marvin.editor.showContextMenu to resolve on demand.
 *  - Assert: right-click → IPC invoked with correct payload; mocked action →
 *    correct editor command dispatched.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'

// jsdom does not include ClipboardEvent — polyfill it so Editor.tsx can
// construct one when dispatching cut/copy/paste actions.
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
// Fake EditorView for CodeMirror tests
// ---------------------------------------------------------------------------

type FakeRange = { empty: boolean }
type FakeCMState = {
  selection: { ranges: FakeRange[]; main: { from: number; to: number } }
  _undoDepth: number
  _redoDepth: number
  _docText: string
  sliceDoc: (from: number, to: number) => string
  replaceSelection: (text: string) => { _replacementText: string }
}

function makeCMState(overrides: Partial<{ hasSelection: boolean; undoDepth: number; redoDepth: number; docText: string; selectionFrom: number; selectionTo: number }> = {}): FakeCMState {
  const docText = overrides.docText ?? 'hello world'
  const from = overrides.selectionFrom ?? 0
  const to = overrides.selectionTo ?? (overrides.hasSelection ? 5 : 0)
  return {
    selection: { ranges: [{ empty: !overrides.hasSelection }], main: { from, to } },
    _undoDepth: overrides.undoDepth ?? 0,
    _redoDepth: overrides.redoDepth ?? 0,
    _docText: docText,
    sliceDoc(f: number, t: number) {
      return docText.slice(f, t)
    },
    replaceSelection(text: string) {
      return { _replacementText: text }
    },
  }
}

type FakeCMView = {
  state: FakeCMState
  contentDOM: HTMLElement
  focus: ReturnType<typeof vi.fn>
  dispatch: ReturnType<typeof vi.fn>
}

function makeContentDOM(): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('data-cm-content', 'true')
  return el
}

function makeCMView(stateOverrides?: Parameters<typeof makeCMState>[0]): FakeCMView {
  return {
    state: makeCMState(stateOverrides),
    contentDOM: makeContentDOM(),
    focus: vi.fn(),
    dispatch: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Mock @codemirror/commands — implementations mutate fake state so tests can
// assert observable state changes, not just that the function was called.
// ---------------------------------------------------------------------------

const mockUndo = vi.fn((view: FakeCMView) => {
  if (view.state._undoDepth > 0) {
    view.state._undoDepth -= 1
    view.state._redoDepth += 1
  }
})
const mockRedo = vi.fn((view: FakeCMView) => {
  if (view.state._redoDepth > 0) {
    view.state._redoDepth -= 1
    view.state._undoDepth += 1
  }
})
const mockSelectAll = vi.fn((view: FakeCMView) => {
  // Simulate selectAll: mark selection as non-empty (all ranges non-empty).
  view.state.selection.ranges = [{ empty: false }]
})

vi.mock('@codemirror/commands', () => ({
  undo: (...args: unknown[]) => mockUndo(...(args as [FakeCMView])),
  redo: (...args: unknown[]) => mockRedo(...(args as [FakeCMView])),
  selectAll: (...args: unknown[]) => mockSelectAll(...(args as [FakeCMView])),
  undoDepth: (state: FakeCMState) => state._undoDepth,
  redoDepth: (state: FakeCMState) => state._redoDepth,
}))

// ---------------------------------------------------------------------------
// Mock @uiw/react-codemirror — renders a div that forwards onContextMenu and
// calls onCreateEditor with the current fake view.
// ---------------------------------------------------------------------------

let currentCMView: FakeCMView = makeCMView()

vi.mock('@uiw/react-codemirror', () => ({
  default: vi.fn((props: {
    onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void
    onCreateEditor?: (view: FakeCMView) => void
  }) => {
    // Call onCreateEditor on render to populate viewRef
    props.onCreateEditor?.(currentCMView)
    return (
      <div
        data-testid="codemirror"
        onContextMenu={props.onContextMenu}
      >
        {/* Render the fake contentDOM as a child so clicks can target it */}
        <div data-cm-content="true" data-testid="cm-content" />
      </div>
    )
  }),
}))

// ---------------------------------------------------------------------------
// Mock heavy deps that Editor.tsx transitively imports
// ---------------------------------------------------------------------------

vi.mock('@codemirror/search', () => ({ search: () => ({}), searchKeymap: [] }))
vi.mock('@codemirror/language', () => ({
  bracketMatching: () => ({}),
  indentUnit: { of: () => ({}) },
  HighlightStyle: { define: () => ({}) },
  syntaxHighlighting: () => ({}),
  syntaxTree: () => ({ resolveInner: () => ({ name: '', parent: null }) }),
}))
vi.mock('@codemirror/view', () => ({
  EditorView: { lineWrapping: {}, domEventHandlers: () => ({}) },
  keymap: { of: () => ({}) },
  Decoration: { mark: () => ({ range: () => ({}) }), none: { update: () => null } },
  ViewPlugin: { define: () => ({}) },
}))
vi.mock('@codemirror/state', () => ({
  StateEffect: { define: () => ({ of: () => ({}) }) },
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
vi.mock('../lib/visualStyle', () => ({ useVisualStyle: () => 'modern' }))
vi.mock('../lib/wikilinks', () => ({
  isWikilinkHref: () => null,
  resolveWikilink: () => null,
}))
vi.mock('../lib/paletteRanker', () => ({}))
vi.mock('./MentionPicker', () => ({ MentionPicker: () => null }))

// ---------------------------------------------------------------------------
// Mock LiveMarkdown inside Editor.tsx (Editor imports LiveMarkdown)
// ---------------------------------------------------------------------------

vi.mock('./LiveMarkdown', () => ({ LiveMarkdown: () => <div data-testid="live-markdown" /> }))

// ---------------------------------------------------------------------------
// Now import Editor (after all mocks are in place)
// ---------------------------------------------------------------------------

import { Editor } from '../Editor'

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
// Minimal Editor props
// ---------------------------------------------------------------------------

function defaultProps() {
  return {
    // Use a .ts file so the editor always shows in edit mode (no preview toggle for non-md files)
    filePath: '/vault/note.ts',
    vaultPath: '/vault',
    initialContent: 'hello',
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rightClickCMEditor(container: HTMLElement, target?: HTMLElement): void {
  // The fake contentDOM is inside the mocked CodeMirror wrapper.
  // We must fire the event on a node that is contained within currentCMView.contentDOM
  // so that view.contentDOM.contains(e.target) passes.
  // Simulate: click on the real contentDOM element (bypass contains check by patching).
  const cmWrapper = container.querySelector('[data-testid="codemirror"]') as HTMLElement
  if (!cmWrapper) throw new Error('CodeMirror wrapper not found in render')
  // Patch contentDOM.contains to always return true for this test
  const originalContains = currentCMView.contentDOM.contains.bind(currentCMView.contentDOM)
  currentCMView.contentDOM.contains = () => true
  fireEvent.contextMenu(target ?? cmWrapper)
  currentCMView.contentDOM.contains = originalContains
}

// ---------------------------------------------------------------------------
// Setup/teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  setupMarvinMock()
  mockUndo.mockReset()
  mockRedo.mockReset()
  mockSelectAll.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Editor (CodeMirror) context menu tests
// ---------------------------------------------------------------------------

describe('Editor — context menu triggers IPC with correct payload', () => {
  it('calls showContextMenu once with an items array', async () => {
    currentCMView = makeCMView({ hasSelection: false })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    expect(showContextMenuMock).toHaveBeenCalledTimes(1)
    const [items] = showContextMenuMock.mock.calls[0] as [Array<{ kind: string; id?: string; label?: string; enabled?: boolean }>]
    expect(Array.isArray(items)).toBe(true)
  })

  it('Cut item is disabled when no text is selected', async () => {
    currentCMView = makeCMView({ hasSelection: false })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [Array<{ kind: string; id?: string; label?: string; enabled?: boolean }>]
    const cut = items.find(i => i.id === 'cut')
    expect(cut?.enabled).toBe(false)
  })

  it('Cut item is enabled when text is selected', async () => {
    currentCMView = makeCMView({ hasSelection: true })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [Array<{ kind: string; id?: string; label?: string; enabled?: boolean }>]
    const cut = items.find(i => i.id === 'cut')
    expect(cut?.enabled).toBe(true)
  })

  it('Copy item is disabled when no text is selected', async () => {
    currentCMView = makeCMView({ hasSelection: false })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [Array<{ kind: string; id?: string; label?: string; enabled?: boolean }>]
    const copy = items.find(i => i.id === 'copy')
    expect(copy?.enabled).toBe(false)
  })

  it('Copy item is enabled when text is selected', async () => {
    currentCMView = makeCMView({ hasSelection: true })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [Array<{ kind: string; id?: string; label?: string; enabled?: boolean }>]
    const copy = items.find(i => i.id === 'copy')
    expect(copy?.enabled).toBe(true)
  })

  it('Undo item is disabled when undoDepth is 0', async () => {
    currentCMView = makeCMView({ undoDepth: 0 })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [Array<{ kind: string; id?: string; label?: string; enabled?: boolean }>]
    const undo = items.find(i => i.id === 'undo')
    expect(undo?.enabled).toBe(false)
  })

  it('Undo item is enabled when undoDepth > 0', async () => {
    currentCMView = makeCMView({ undoDepth: 2 })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [Array<{ kind: string; id?: string; label?: string; enabled?: boolean }>]
    const undo = items.find(i => i.id === 'undo')
    expect(undo?.enabled).toBe(true)
  })

  it('Redo item is disabled when redoDepth is 0', async () => {
    currentCMView = makeCMView({ redoDepth: 0 })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [Array<{ kind: string; id?: string; label?: string; enabled?: boolean }>]
    const redo = items.find(i => i.id === 'redo')
    expect(redo?.enabled).toBe(false)
  })

  it('Redo item is enabled when redoDepth > 0', async () => {
    currentCMView = makeCMView({ redoDepth: 1 })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [Array<{ kind: string; id?: string; label?: string; enabled?: boolean }>]
    const redo = items.find(i => i.id === 'redo')
    expect(redo?.enabled).toBe(true)
  })

  it('Paste item is disabled when canPaste returns false', async () => {
    currentCMView = makeCMView()
    canPasteMock.mockResolvedValue(false)
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [Array<{ kind: string; id?: string; label?: string; enabled?: boolean }>]
    const paste = items.find(i => i.id === 'paste')
    expect(paste?.enabled).toBe(false)
  })

  it('Paste item is enabled when canPaste returns true', async () => {
    currentCMView = makeCMView()
    canPasteMock.mockResolvedValue(true)
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    const [items] = showContextMenuMock.mock.calls[0] as [Array<{ kind: string; id?: string; label?: string; enabled?: boolean }>]
    const paste = items.find(i => i.id === 'paste')
    expect(paste?.enabled).toBe(true)
  })
})

describe('Editor — context menu action dispatch', () => {
  it('calls selectAll command when action is selectAll', async () => {
    currentCMView = makeCMView()
    showContextMenuMock.mockResolvedValue('selectAll')
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    expect(mockSelectAll).toHaveBeenCalledWith(currentCMView)
  })

  it('calls undo command when action is undo', async () => {
    currentCMView = makeCMView({ undoDepth: 1 })
    showContextMenuMock.mockResolvedValue('undo')
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    expect(mockUndo).toHaveBeenCalledWith(currentCMView)
  })

  it('calls redo command when action is redo', async () => {
    currentCMView = makeCMView({ redoDepth: 1 })
    showContextMenuMock.mockResolvedValue('redo')
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    expect(mockRedo).toHaveBeenCalledWith(currentCMView)
  })

  it('writes selected text to clipboard when action is cut, then clears selection via dispatch', async () => {
    currentCMView = makeCMView({ hasSelection: true, docText: 'hello world', selectionFrom: 0, selectionTo: 5 })
    showContextMenuMock.mockResolvedValue('cut')
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    expect(writeClipboardMock).toHaveBeenCalledWith('hello')
    // cut additionally dispatches a transaction (the replaceSelection('') call)
    expect(currentCMView.dispatch).toHaveBeenCalledWith({ _replacementText: '' })
  })

  it('writes selected text to clipboard when action is copy, without altering selection', async () => {
    currentCMView = makeCMView({ hasSelection: true, docText: 'hello world', selectionFrom: 0, selectionTo: 5 })
    showContextMenuMock.mockResolvedValue('copy')
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    expect(writeClipboardMock).toHaveBeenCalledWith('hello')
    expect(currentCMView.dispatch).not.toHaveBeenCalled()
  })

  it('reads clipboard and inserts text via dispatch when action is paste', async () => {
    currentCMView = makeCMView({ hasSelection: false, selectionFrom: 0, selectionTo: 0 })
    readClipboardMock.mockResolvedValue('pasted text')
    showContextMenuMock.mockResolvedValue('paste')
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    expect(readClipboardMock).toHaveBeenCalled()
    expect(currentCMView.dispatch).toHaveBeenCalledWith({ _replacementText: 'pasted text' })
  })

  it('does not write clipboard when cut/copy has empty selection', async () => {
    currentCMView = makeCMView({ hasSelection: false, selectionFrom: 0, selectionTo: 0 })
    showContextMenuMock.mockResolvedValue('cut')
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    expect(writeClipboardMock).not.toHaveBeenCalled()
  })

  it('calls view.focus() after dispatching any action', async () => {
    currentCMView = makeCMView()
    showContextMenuMock.mockResolvedValue('selectAll')
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    expect(currentCMView.focus).toHaveBeenCalledTimes(1)
  })

  it('does not dispatch any action when showContextMenu resolves null', async () => {
    currentCMView = makeCMView()
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    expect(mockSelectAll).not.toHaveBeenCalled()
    expect(mockUndo).not.toHaveBeenCalled()
    expect(mockRedo).not.toHaveBeenCalled()
    expect(currentCMView.focus).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Editor — state changes after action
// ---------------------------------------------------------------------------

describe('Editor — state changes after context menu action', () => {
  it('undo decreases undoDepth by 1', async () => {
    currentCMView = makeCMView({ undoDepth: 3, redoDepth: 0 })
    showContextMenuMock.mockResolvedValue('undo')
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    expect(currentCMView.state._undoDepth).toBe(2)
  })

  it('undo increases redoDepth by 1', async () => {
    currentCMView = makeCMView({ undoDepth: 2, redoDepth: 0 })
    showContextMenuMock.mockResolvedValue('undo')
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    expect(currentCMView.state._redoDepth).toBe(1)
  })

  it('undo does not change depth when undoDepth is already 0', async () => {
    currentCMView = makeCMView({ undoDepth: 0 })
    showContextMenuMock.mockResolvedValue('undo')
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    expect(currentCMView.state._undoDepth).toBe(0)
  })

  it('redo decreases redoDepth by 1', async () => {
    currentCMView = makeCMView({ undoDepth: 0, redoDepth: 2 })
    showContextMenuMock.mockResolvedValue('redo')
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    expect(currentCMView.state._redoDepth).toBe(1)
  })

  it('redo increases undoDepth by 1', async () => {
    currentCMView = makeCMView({ undoDepth: 1, redoDepth: 1 })
    showContextMenuMock.mockResolvedValue('redo')
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    expect(currentCMView.state._undoDepth).toBe(2)
  })

  it('selectAll makes selection non-empty (covers whole doc)', async () => {
    currentCMView = makeCMView({ hasSelection: false })
    showContextMenuMock.mockResolvedValue('selectAll')
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    // After selectAll, all ranges must be non-empty.
    expect(currentCMView.state.selection.ranges.every(r => !r.empty)).toBe(true)
  })

  it('null action leaves undoDepth unchanged', async () => {
    currentCMView = makeCMView({ undoDepth: 2 })
    showContextMenuMock.mockResolvedValue(null)
    const { container } = render(<Editor {...defaultProps()} />)
    await act(async () => {
      rightClickCMEditor(container)
    })
    expect(currentCMView.state._undoDepth).toBe(2)
  })
})
