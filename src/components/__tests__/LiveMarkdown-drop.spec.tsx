// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Hoisted symbols / refs — module-stable identities that vi.mock factories
// and tests share. Real Plugin from prosemirror-state is fine — we read its
// public `.props.handleDOMEvents` instead of mocking it.
// ---------------------------------------------------------------------------

const { PARSER_CTX, EDITOR_VIEW_CTX, EDITOR_VIEW_OPTIONS_CTX, ROOT_CTX, DEFAULT_VALUE_CTX, PROSE_PLUGINS_CTX, LISTENER_CTX } = vi.hoisted(() => ({
  PARSER_CTX: Symbol('parserCtx'),
  EDITOR_VIEW_CTX: Symbol('editorViewCtx'),
  EDITOR_VIEW_OPTIONS_CTX: Symbol('editorViewOptionsCtx'),
  ROOT_CTX: Symbol('rootCtx'),
  DEFAULT_VALUE_CTX: Symbol('defaultValueCtx'),
  PROSE_PLUGINS_CTX: Symbol('prosePluginsCtx'),
  LISTENER_CTX: Symbol('listenerCtx'),
}))

// Captured handler refs filled when the editor's config callback runs.
const capturedHandlers: {
  dragover?: (view: unknown, event: DragEvent) => boolean
  drop?: (view: unknown, event: DragEvent) => boolean
} = {}

// Fake parser returns a doc-like node. childCount=1 + isTextblock=true exercises
// the inline-merge code path; multi-block markdown (with a blank line) bumps
// childCount to 2 so the slice-replace branch is taken. Inline fragment
// includes a fake node with `type.name === 'image'` when the markdown starts
// with `![` so the image-aware branch in insertMarkdownAt is exercised.
const fakeParser = vi.fn((md: string) => {
  const blocks = md.split('\n\n').filter(Boolean)
  const isImage = md.startsWith('![')
  const fakeNode = { type: { name: isImage ? 'image' : 'text' } }
  const inline = {
    _kind: 'fragment',
    _from: md,
    size: md.length,
    forEach: (cb: (n: { type: { name: string } }) => void) => cb(fakeNode),
  }
  return {
    _markdown: md,
    childCount: blocks.length,
    firstChild: { isTextblock: true, content: inline },
    content: { _kind: 'fragment', _from: md, size: md.length },
    type: { name: 'doc' },
  }
})

// Fake PM view — only the bits the drop handler touches.
const fakeView = {
  state: {
    schema: { text: (s: string) => ({ _kind: 'text', text: s }) },
    selection: { from: 5, to: 5 },
    get tr() {
      const doc = {
        content: { size: 1000 },
        resolve: (n: number) => ({ pos: n, marks: () => [] }),
      }
      return {
        _replaces: [] as Array<{ from: number; to: number; slice: unknown }>,
        _replaceWiths: [] as Array<{ from: number; to: number; content: unknown }>,
        _inserts: [] as Array<{ pos: number; content: unknown }>,
        doc,
        _splits: [] as Array<{ pos: number }>,
        replace(from: number, to: number, slice: unknown) {
          this._replaces.push({ from, to, slice })
          return this
        },
        split(pos: number) {
          this._splits.push({ pos })
          return this
        },
        replaceWith(from: number, to: number, content: unknown) {
          this._replaceWiths.push({ from, to, content })
          return this
        },
        insert(pos: number, content: unknown) {
          this._inserts.push({ pos, content })
          return this
        },
        setMeta: vi.fn(function (this: unknown) {
          return this
        }),
        setSelection: vi.fn(function (this: unknown) {
          return this
        }),
        setStoredMarks: vi.fn(function (this: unknown) {
          return this
        }),
      }
    },
  },
  dispatch: vi.fn(),
  posAtCoords: vi.fn(() => ({ pos: 12, inside: 0 })),
}

// Fake ctx satisfies the surface area both LiveMarkdown internals and the
// dropPlugin touch. `update(PROSE_PLUGINS_CTX, …)` lets us pluck the drop
// plugin from the returned list and grab its DOM handlers.
const fakeCtx = {
  set: vi.fn(),
  update: vi.fn((key: symbol, updater: (prev: unknown[]) => unknown[]) => {
    if (key !== PROSE_PLUGINS_CTX) return
    const plugins = updater([])
    for (const p of plugins) {
      const handlers = (p as { spec?: { props?: { handleDOMEvents?: typeof capturedHandlers } } })
        ?.spec?.props?.handleDOMEvents
      if (handlers?.drop && handlers?.dragover) {
        capturedHandlers.drop = handlers.drop
        capturedHandlers.dragover = handlers.dragover
      }
    }
  }),
  get: vi.fn((key: symbol) => {
    if (key === PARSER_CTX) return fakeParser
    if (key === LISTENER_CTX) return { markdownUpdated: vi.fn() }
    if (key === EDITOR_VIEW_CTX) return fakeView
    return undefined
  }),
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@milkdown/core', () => ({
  Editor: {
    make: () => {
      const builder = {
        config: (cb: (ctx: typeof fakeCtx) => void) => {
          cb(fakeCtx)
          return builder
        },
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
  Milkdown: () => null,
  MilkdownProvider: ({ children }: { children: React.ReactNode }) => children,
  useEditor: (cb: (root: HTMLElement) => unknown) => {
    cb(document.createElement('div'))
    return { get: () => null }
  },
}))

vi.mock('@milkdown/preset-commonmark', () => ({ commonmark: {} }))
vi.mock('@milkdown/preset-gfm', () => ({ gfm: {} }))
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

// Use real Plugin (drop handler is read from .spec.props), stub TextSelection
// so .near() doesn't crash on our fake ResolvedPos.
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

vi.mock('../../lib/imageNodeView', () => ({ imageNodeView: () => ({}) }))
vi.mock('../../lib/pmJustReplacedHighlight', () => ({ justReplacedPlugin: () => ({}) }))
vi.mock('../../lib/wikilinks', () => ({
  parseWikilinks: (s: string) => s,
  unparseWikilinks: (s: string) => s,
}))

// ---------------------------------------------------------------------------
// Import after all mocks
// ---------------------------------------------------------------------------

import { LiveMarkdown } from '../LiveMarkdown'

// ---------------------------------------------------------------------------
// window.marvin mock
// ---------------------------------------------------------------------------

let writeBinaryMock: ReturnType<typeof vi.fn>

function setupMarvinMock(writeBinary?: ReturnType<typeof vi.fn>) {
  writeBinaryMock = writeBinary ?? vi.fn(async ({ relPath }: { relPath: string }) => relPath)
  Object.defineProperty(globalThis, 'window', {
    value: {
      ...(typeof window !== 'undefined' ? window : {}),
      marvin: {
        file: { writeBinary: writeBinaryMock },
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
// Helpers
// ---------------------------------------------------------------------------

function makeDragEvent(files: File[], internalPath = ''): DragEvent {
  const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
  const types: string[] = []
  if (internalPath) types.push('application/x-marvin-path')
  if (files.length > 0) types.push('Files')
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      files: files as unknown as FileList,
      items: [],
      types,
      getData: (k: string) =>
        k === 'application/x-marvin-path' ? internalPath : '',
      dropEffect: 'none',
    },
    writable: false,
  })
  Object.defineProperty(event, 'preventDefault', { value: vi.fn(), writable: false })
  Object.defineProperty(event, 'stopPropagation', { value: vi.fn(), writable: false })
  Object.defineProperty(event, 'clientX', { value: 100, writable: false })
  Object.defineProperty(event, 'clientY', { value: 100, writable: false })
  return event
}

function defaultProps() {
  return {
    body: '',
    onChange: vi.fn(),
    onLinkClick: vi.fn(),
    filePath: '/vault/note.md',
    vaultPath: '/vault',
    paletteItems: [],
    remountKey: 'k',
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  setupMarvinMock()
  capturedHandlers.drop = undefined
  capturedHandlers.dragover = undefined
  fakeParser.mockClear()
  fakeView.dispatch.mockClear()
  fakeView.posAtCoords.mockClear()
  fakeView.state.tr._replaces = []
})

// ===========================================================================
// Tests
// ===========================================================================

describe('LiveMarkdown — Milkdown drop handler (issue #290)', () => {
  it('registers dragover + drop handlers on the prose plugin stack', () => {
    render(<LiveMarkdown {...defaultProps()} />)
    expect(capturedHandlers.drop).toBeTypeOf('function')
    expect(capturedHandlers.dragover).toBeTypeOf('function')
  })

  it('image drop: writeBinary called once, image markdown parsed and inserted', async () => {
    const onImportToast = vi.fn()
    render(<LiveMarkdown {...defaultProps()} onImportToast={onImportToast} />)

    const file = new File(['png'], 'photo.png', { type: 'image/png' })
    const event = makeDragEvent([file])
    const result = capturedHandlers.drop!(fakeView, event)

    expect(result).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    await new Promise((r) => setTimeout(r, 30))

    expect(writeBinaryMock).toHaveBeenCalledTimes(1)
    const markdownArg = fakeParser.mock.calls[0]?.[0] as string
    expect(markdownArg).toMatch(/^!\[photo\.png\]\(attachments\/.+\.png\)$/)
    expect(fakeView.dispatch).toHaveBeenCalledTimes(1)
    expect(onImportToast).toHaveBeenCalledWith({
      state: 'success',
      message: 'Imported 1 attachment.',
    })
  })

  it('non-image drop: link markdown parsed and inserted', async () => {
    const onImportToast = vi.fn()
    render(<LiveMarkdown {...defaultProps()} onImportToast={onImportToast} />)

    const file = new File(['pdf'], 'doc.pdf', { type: 'application/pdf' })
    capturedHandlers.drop!(fakeView, makeDragEvent([file]))
    await new Promise((r) => setTimeout(r, 30))

    const markdownArg = fakeParser.mock.calls[0]?.[0] as string
    expect(markdownArg).toMatch(/^\[doc\.pdf\]\(attachments\/.+\.pdf\)$/)
    expect(onImportToast).toHaveBeenCalledWith({
      state: 'success',
      message: 'Imported 1 attachment.',
    })
  })

  it('multiple files: writeBinary twice, joined markdown parsed in single transaction', async () => {
    const onImportToast = vi.fn()
    render(<LiveMarkdown {...defaultProps()} onImportToast={onImportToast} />)

    const img = new File(['i'], 'photo.png', { type: 'image/png' })
    const pdf = new File(['p'], 'doc.pdf', { type: 'application/pdf' })
    capturedHandlers.drop!(fakeView, makeDragEvent([img, pdf]))
    await new Promise((r) => setTimeout(r, 30))

    expect(writeBinaryMock).toHaveBeenCalledTimes(2)
    expect(fakeView.dispatch).toHaveBeenCalledTimes(1)
    const markdownArg = fakeParser.mock.calls[0]?.[0] as string
    expect(markdownArg).toMatch(/!\[photo\.png\]/)
    expect(markdownArg).toMatch(/\[doc\.pdf\]/)
    expect(onImportToast).toHaveBeenCalledWith({
      state: 'success',
      message: 'Imported 2 attachments.',
    })
  })

  it('internal drag from file tree: parser receives angle-bracket-wrapped link, no IPC', () => {
    const onImportToast = vi.fn()
    render(<LiveMarkdown {...defaultProps()} onImportToast={onImportToast} />)

    capturedHandlers.drop!(fakeView, makeDragEvent([], '/vault/Captura de Tela.png'))

    expect(writeBinaryMock).not.toHaveBeenCalled()
    expect(fakeParser).toHaveBeenCalledWith('![Captura de Tela.png](<Captura de Tela.png>)')
    expect(fakeView.dispatch).toHaveBeenCalledTimes(1)
  })

  it('oversized file: rejected with error toast, parser never called', async () => {
    const onImportToast = vi.fn()
    render(<LiveMarkdown {...defaultProps()} onImportToast={onImportToast} />)

    const big = Object.defineProperty(
      new File(['x'], 'huge.png', { type: 'image/png' }),
      'size',
      { value: 26 * 1024 * 1024 },
    )
    capturedHandlers.drop!(fakeView, makeDragEvent([big]))
    await new Promise((r) => setTimeout(r, 30))

    expect(writeBinaryMock).not.toHaveBeenCalled()
    expect(fakeParser).not.toHaveBeenCalled()
    expect(onImportToast).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'error',
        message: expect.stringContaining('huge.png'),
      }),
    )
  })

  it('IPC rejection: emits error toast, parser not called for that file', async () => {
    setupMarvinMock(vi.fn().mockRejectedValue(new Error('MARVIN_FS_EACCES')))
    const onImportToast = vi.fn()
    render(<LiveMarkdown {...defaultProps()} onImportToast={onImportToast} />)

    const file = new File(['x'], 'secret.md', { type: 'text/markdown' })
    capturedHandlers.drop!(fakeView, makeDragEvent([file]))
    await new Promise((r) => setTimeout(r, 30))

    expect(writeBinaryMock).toHaveBeenCalled()
    expect(onImportToast).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'error',
        message: expect.stringContaining('secret.md'),
      }),
    )
  })

  it('image drop: inserts inline (no paragraph split, no trailing space)', async () => {
    render(<LiveMarkdown {...defaultProps()} />)

    const file = new File(['png'], 'photo.png', { type: 'image/png' })
    capturedHandlers.drop!(fakeView, makeDragEvent([file]))
    await new Promise((r) => setTimeout(r, 30))

    // Image atoms don't carry marks so the trailing-space escape isn't fired;
    // the image stays inline with surrounding text instead of getting its
    // own paragraph (avoids serializing as a blank line in markdown source).
    const tr = (fakeView.dispatch.mock.calls[0]?.[0] as unknown) as {
      _splits: unknown[]
      _inserts: unknown[]
    }
    expect(tr._splits.length).toBe(0)
    expect(tr._inserts.length).toBe(0)
  })

  it('non-image link drop: inserts trailing space (no paragraph split)', async () => {
    render(<LiveMarkdown {...defaultProps()} />)

    // Custom parser path: marks() returns [link] so the space-escape branch
    // fires for this single test.
    const linkSpyView = {
      ...fakeView,
      state: {
        ...fakeView.state,
        get tr() {
          const base = fakeView.state.tr
          base.doc.resolve = (n: number) => ({
            pos: n,
            marks: () => [{ type: { name: 'link' } }],
          })
          return base
        },
      },
    }

    const file = new File(['pdf'], 'doc.pdf', { type: 'application/pdf' })
    capturedHandlers.drop!(linkSpyView, makeDragEvent([file]))
    await new Promise((r) => setTimeout(r, 30))

    const tr = (linkSpyView.dispatch.mock.calls[0]?.[0] as unknown) as {
      _splits: unknown[]
      _inserts: unknown[]
    }
    expect(tr._splits.length).toBe(0)
    expect(tr._inserts.length).toBe(1)
  })

  it('dragover accepts the drop only for Files / marvin-path types', () => {
    render(<LiveMarkdown {...defaultProps()} />)

    const textEvent = makeDragEvent([])
    expect(capturedHandlers.dragover!(fakeView, textEvent)).toBe(false)

    const fileEvent = makeDragEvent([new File(['x'], 'a.png', { type: 'image/png' })])
    expect(capturedHandlers.dragover!(fakeView, fileEvent)).toBe(true)
    expect(fileEvent.preventDefault).toHaveBeenCalled()
  })
})
