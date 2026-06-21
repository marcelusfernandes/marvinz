/**
 * Component tests for LiveMarkdown rich-clipboard (issue #171).
 *
 * Wires the Milkdown/ProseMirror context menu copy/cut/paste through
 * `clipboardSerializer` / `clipboardParser` and the new
 * `window.marvin.editor.writeClipboardRich` / `readClipboardRich` IPC so
 * formatting survives cross-app paste.
 *
 * Mock strategy mirrors live-markdown-context-menu.spec.tsx: stub
 * `@milkdown/react`'s `useEditor` to return a fake editor whose ctx exposes
 * a controlled ProseMirror view, and assert IPC payloads + dispatches.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Fake ProseMirror view
// ---------------------------------------------------------------------------

type FakeSlice = { _kind: 'slice'; content: { _fragment: true; tag: string } }

type FakePMState = {
  selection: { empty: boolean; from: number; to: number }
  _undoDepth: number
  _redoDepth: number
  doc: {
    textBetween: (from: number, to: number, blockSep?: string, leafText?: string) => string
    slice: (from: number, to: number) => FakeSlice
  }
  tr: {
    deleteSelection: () => { _kind: 'delete' }
    insertText: (text: string) => { _kind: 'insertText'; _text: string }
    replaceSelection: (slice: unknown) => { _kind: 'replaceSelection'; _slice: unknown }
  }
}

type FakePMView = {
  state: FakePMState
  dom: HTMLElement
  focus: ReturnType<typeof vi.fn>
  dispatch: ReturnType<typeof vi.fn>
  someProp: ReturnType<typeof vi.fn>
}

const mockSerializeFragment = vi.fn((_fragment: unknown) => {
  // Return a DOM Node whose innerHTML (after wrapping) is non-trivial — the
  // wire-up wraps it in a div and reads .innerHTML, so a <strong> child is
  // enough to assert a non-empty html payload reached writeClipboardRich.
  const strong = document.createElement('strong')
  strong.textContent = 'hello'
  return strong
})

const mockClipboardSerializer = { serializeFragment: mockSerializeFragment }

const mockParseSlice = vi.fn((_dom: unknown, _opts: unknown) => ({
  _kind: 'parsed-slice',
}))

const mockClipboardParser = { parseSlice: mockParseSlice }

function makePMState(
  overrides: Partial<{
    hasSelection: boolean
    docText: string
    selectionFrom: number
    selectionTo: number
  }> = {}
): FakePMState {
  const docText = overrides.docText ?? 'hello world'
  const from = overrides.selectionFrom ?? 0
  const to = overrides.selectionTo ?? (overrides.hasSelection ? 5 : 0)
  return {
    selection: { empty: !overrides.hasSelection, from, to },
    _undoDepth: 0,
    _redoDepth: 0,
    doc: {
      textBetween: (f: number, t: number) => docText.slice(f, t),
      slice: (_f: number, _t: number) => ({
        _kind: 'slice' as const,
        content: { _fragment: true as const, tag: 'fragment' },
      }),
    },
    tr: {
      deleteSelection: () => ({ _kind: 'delete' }),
      insertText: (text: string) => ({ _kind: 'insertText', _text: text }),
      replaceSelection: (slice: unknown) => ({ _kind: 'replaceSelection', _slice: slice }),
    },
  }
}

function makePMView(
  stateOverrides?: Parameters<typeof makePMState>[0],
  opts: { hasSerializer?: boolean; hasParser?: boolean } = {}
): FakePMView {
  const dom = document.createElement('div')
  dom.setAttribute('data-pm-content', 'true')
  const hasSerializer = opts.hasSerializer ?? true
  const hasParser = opts.hasParser ?? true
  const someProp = vi.fn((name: string) => {
    if (name === 'clipboardSerializer') return hasSerializer ? mockClipboardSerializer : undefined
    if (name === 'clipboardParser') return hasParser ? mockClipboardParser : undefined
    return undefined
  })
  return {
    state: makePMState(stateOverrides),
    dom,
    focus: vi.fn(),
    dispatch: vi.fn(),
    someProp,
  }
}

let currentPMView: FakePMView = makePMView()

// ---------------------------------------------------------------------------
// Mocks for prosemirror + milkdown deps (same shape as
// live-markdown-context-menu.spec.tsx — needed because LiveMarkdown imports
// these eagerly at module load time)
// ---------------------------------------------------------------------------

vi.mock('prosemirror-history', () => ({
  undo: vi.fn(),
  redo: vi.fn(),
  undoDepth: (state: FakePMState) => state._undoDepth,
  redoDepth: (state: FakePMState) => state._redoDepth,
  history: () => ({}),
}))

vi.mock('prosemirror-commands', () => ({
  selectAll: vi.fn(),
}))

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
let writeClipboardRichMock: ReturnType<typeof vi.fn>
let readClipboardRichMock: ReturnType<typeof vi.fn>
let getSpellcheckContextMock: ReturnType<typeof vi.fn>

function setupMarvinMock() {
  showContextMenuMock = vi.fn()
  canPasteMock = vi.fn().mockResolvedValue(true)
  writeClipboardRichMock = vi.fn().mockResolvedValue(undefined)
  readClipboardRichMock = vi.fn().mockResolvedValue({ html: '', text: '' })
  getSpellcheckContextMock = vi.fn().mockResolvedValue({ misspelledWord: '', suggestions: [] })
  Object.defineProperty(globalThis, 'window', {
    value: {
      ...(typeof window !== 'undefined' ? window : {}),
      marvin: {
        app: {
          showContextMenu: showContextMenuMock,
          canPaste: canPasteMock,
        },
        editor: {
          writeClipboard: vi.fn(),
          readClipboard: vi.fn(),
          writeClipboardRich: writeClipboardRichMock,
          readClipboardRich: readClipboardRichMock,
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
    body: 'hello world',
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

beforeEach(() => {
  setupMarvinMock()
  mockSerializeFragment.mockClear()
  mockParseSlice.mockClear()
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
// Copy / Cut — rich serialization
// ---------------------------------------------------------------------------

describe('LiveMarkdown rich clipboard — copy', () => {
  it('serializes selection through clipboardSerializer and calls writeClipboardRich with html + text', async () => {
    currentPMView = makePMView({
      hasSelection: true,
      docText: 'hello world',
      selectionFrom: 0,
      selectionTo: 5,
    })
    showContextMenuMock.mockResolvedValue('copy')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(mockSerializeFragment).toHaveBeenCalledTimes(1)
    expect(writeClipboardRichMock).toHaveBeenCalledTimes(1)
    const payload = writeClipboardRichMock.mock.calls[0][0] as { html: string; text: string }
    expect(payload.html).toContain('<strong>hello</strong>')
    expect(payload.text).toBe('hello')
    // Copy must NOT mutate the doc.
    expect(currentPMView.dispatch).not.toHaveBeenCalled()
  })

  it('writeClipboardRich payload has empty html when clipboardSerializer is unavailable', async () => {
    currentPMView = makePMView(
      { hasSelection: true, docText: 'hello world', selectionFrom: 0, selectionTo: 5 },
      { hasSerializer: false }
    )
    showContextMenuMock.mockResolvedValue('copy')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(writeClipboardRichMock).toHaveBeenCalledTimes(1)
    const payload = writeClipboardRichMock.mock.calls[0][0] as { html: string; text: string }
    expect(payload.html).toBe('')
    expect(payload.text).toBe('hello')
  })

  it('does not write clipboard when selection is empty', async () => {
    currentPMView = makePMView({ hasSelection: false })
    showContextMenuMock.mockResolvedValue('copy')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(writeClipboardRichMock).not.toHaveBeenCalled()
    expect(mockSerializeFragment).not.toHaveBeenCalled()
  })
})

describe('LiveMarkdown rich clipboard — cut', () => {
  it('writes rich payload then dispatches deleteSelection', async () => {
    currentPMView = makePMView({
      hasSelection: true,
      docText: 'hello world',
      selectionFrom: 0,
      selectionTo: 5,
    })
    showContextMenuMock.mockResolvedValue('cut')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(writeClipboardRichMock).toHaveBeenCalledTimes(1)
    const payload = writeClipboardRichMock.mock.calls[0][0] as { html: string; text: string }
    expect(payload.html).toContain('<strong>hello</strong>')
    expect(payload.text).toBe('hello')
    // deleteSelection dispatched AFTER write.
    expect(currentPMView.dispatch).toHaveBeenCalledWith({ _kind: 'delete' })
    const writeOrder = writeClipboardRichMock.mock.invocationCallOrder[0]
    const dispatchOrder = currentPMView.dispatch.mock.invocationCallOrder[0]
    expect(writeOrder).toBeLessThan(dispatchOrder)
  })
})

// ---------------------------------------------------------------------------
// Paste — html branch via clipboardParser
// ---------------------------------------------------------------------------

describe('LiveMarkdown rich clipboard — paste', () => {
  it('parses html through clipboardParser and dispatches replaceSelection', async () => {
    currentPMView = makePMView()
    readClipboardRichMock.mockResolvedValue({
      html: '<p><strong>rich</strong> paste</p>',
      text: 'rich paste',
    })
    showContextMenuMock.mockResolvedValue('paste')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(readClipboardRichMock).toHaveBeenCalledTimes(1)
    expect(mockParseSlice).toHaveBeenCalledTimes(1)
    // parseSlice receives the parsed <body> element and preserveWhitespace opts.
    const [domArg, optsArg] = mockParseSlice.mock.calls[0] as [
      Element,
      { preserveWhitespace: string },
    ]
    expect(domArg).toBeInstanceOf(Element)
    expect(domArg.tagName.toLowerCase()).toBe('body')
    expect(optsArg.preserveWhitespace).toBe('full')
    expect(currentPMView.dispatch).toHaveBeenCalledWith({
      _kind: 'replaceSelection',
      _slice: { _kind: 'parsed-slice' },
    })
  })

  it('falls back to insertText when payload has only text', async () => {
    currentPMView = makePMView()
    readClipboardRichMock.mockResolvedValue({ html: '', text: 'plain text' })
    showContextMenuMock.mockResolvedValue('paste')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(mockParseSlice).not.toHaveBeenCalled()
    expect(currentPMView.dispatch).toHaveBeenCalledWith({
      _kind: 'insertText',
      _text: 'plain text',
    })
  })

  it('does nothing when payload is empty', async () => {
    currentPMView = makePMView()
    readClipboardRichMock.mockResolvedValue({ html: '', text: '' })
    showContextMenuMock.mockResolvedValue('paste')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(mockParseSlice).not.toHaveBeenCalled()
    expect(currentPMView.dispatch).not.toHaveBeenCalled()
  })

  it('falls back to text insert when clipboardParser is unavailable but html is present', async () => {
    currentPMView = makePMView(undefined, { hasParser: false })
    readClipboardRichMock.mockResolvedValue({
      html: '<p>rich</p>',
      text: 'rich',
    })
    showContextMenuMock.mockResolvedValue('paste')
    const { container } = render(<LiveMarkdown {...defaultProps()} />)
    await act(async () => {
      rightClickLiveMD(container)
    })
    expect(mockParseSlice).not.toHaveBeenCalled()
    expect(currentPMView.dispatch).toHaveBeenCalledWith({
      _kind: 'insertText',
      _text: 'rich',
    })
  })
})
