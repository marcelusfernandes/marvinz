// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Module-level shared objects — must NOT be vi.hoisted(), because storing
// a React component closure inside a vi.hoisted() object causes Vitest's
// reactive proxy to deep-traverse it and OOM.
// ---------------------------------------------------------------------------

// Simulated contentDOM that receives real DOM events wired in the mock below.
// Recreated in beforeEach so listeners don't bleed across tests.
let editorContentDOM: HTMLDivElement = document.createElement('div')
editorContentDOM.className = 'cm-content'

// Fake EditorView: dispatch accumulates inserted text in state._text.
const fakeView = {
  state: { _text: '', selection: { main: { head: 0 } } },
  dispatch: vi.fn(),
  posAtCoords: vi.fn(() => 0),
}
fakeView.dispatch.mockImplementation(
  (tr: { changes?: { from: number; insert: string } }) => {
    if (tr.changes) {
      fakeView.state._text =
        fakeView.state._text.slice(0, tr.changes.from) +
        tr.changes.insert +
        fakeView.state._text.slice(tr.changes.from)
    }
  },
)

// ---------------------------------------------------------------------------
// Mocks — all before the Editor import
// ---------------------------------------------------------------------------

vi.mock('@codemirror/view', () => ({
  EditorView: {
    lineWrapping: {},
    // Wire real DOM event listeners so tests can fire events directly.
    domEventHandlers: (
      handlers: Record<string, (e: Event, view: typeof fakeView) => boolean>,
    ) => {
      for (const [type, fn] of Object.entries(handlers)) {
        editorContentDOM.addEventListener(type, (e) => fn(e as DragEvent, fakeView))
      }
      return {}
    },
  },
  keymap: { of: (...args: unknown[]) => ({ _ext: 'keymap', _bindings: args[0] }) },
  Decoration: {
    mark: () => ({ range: (from: number, to: number) => ({ from, to }) }),
    none: { update: () => null },
  },
  // `mentionTrigger` calls ViewPlugin.define at module load. The returned
  // extension shape is never executed in these tests because the fake
  // CodeMirror mock doesn't run extensions — a sentinel object suffices.
  ViewPlugin: { define: () => ({}) },
}))

vi.mock('@codemirror/search', () => ({
  search: (_opts?: unknown) => ({ _ext: 'search' }),
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
  SearchQuery: class {
    constructor() {}
  },
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
  syntaxTree: () => ({ resolveInner: () => ({ name: '', parent: null }) }),
}))

vi.mock('@codemirror/state', () => ({
  StateEffect: { define: () => ({ of: (v: unknown) => ({ value: v }) }) },
  StateField: { define: () => ({}) },
  EditorSelection: { cursor: (pos: number) => ({ anchor: pos, head: pos }) },
}))

vi.mock('@uiw/react-codemirror', () => ({
  default: (props: { onCreateEditor?: (v: unknown) => void }) => {
    // Attach contentDOM to rendered div, then notify the Editor via onCreateEditor.
    // Use a ref callback to avoid calling setState during render.
    const attachRef = (el: HTMLDivElement | null) => {
      if (el && !el.contains(editorContentDOM)) el.appendChild(editorContentDOM)
    }
    // Defer onCreateEditor past the render phase to avoid React warning.
    setTimeout(() => props.onCreateEditor?.(fakeView), 0)
    return <div className="cm-editor" ref={attachRef} />
  },
}))

vi.mock('../lib/cmLanguage', () => ({
  languageIdFor: () => null,
  loadLanguage: () => Promise.resolve(null),
}))

vi.mock('../lib/cmJustReplacedHighlight', () => ({ justReplacedField: {} }))

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
vi.mock('./LiveMarkdown', () => ({
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
vi.mock('./MentionPicker', () => ({ MentionPicker: () => null }))

// ---------------------------------------------------------------------------
// Import Editor after all mocks
// ---------------------------------------------------------------------------

import { Editor } from '../Editor'
import type { ImportToastState } from '../ImportToast'

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
        app: {
          showContextMenu: vi.fn().mockResolvedValue(null),
          canPaste: vi.fn().mockResolvedValue(false),
        },
        editor: {
          writeClipboard: vi.fn().mockResolvedValue(undefined),
          readClipboard: vi.fn().mockResolvedValue(''),
        },
        shell: { openExternal: vi.fn() },
        file: {
          writeBinary: writeBinaryMock,
          exportPdf: vi.fn().mockResolvedValue(undefined),
        },
      },
    },
    writable: true,
    configurable: true,
  })
}

// ---------------------------------------------------------------------------
// Default props — .ts extension forces edit mode (no preview), so CodeMirror renders
// ---------------------------------------------------------------------------

function defaultProps() {
  return {
    filePath: '/vault/note.ts',
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
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDragEvent(
  files: File[],
  internalPath = '',
  internalPaths: string[] = [],
): DragEvent {
  const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
  const types: string[] = []
  if (internalPaths.length > 0) types.push('application/x-marvin-paths')
  else if (internalPath) types.push('application/x-marvin-path')
  if (files.length > 0) types.push('Files')
  const mimeData: Record<string, string> = {}
  if (internalPath) mimeData['application/x-marvin-path'] = internalPath
  if (internalPaths.length > 0) mimeData['application/x-marvin-paths'] = JSON.stringify(internalPaths)
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      files: files as unknown as FileList,
      items: [],
      types,
      getData: (k: string) => mimeData[k] ?? '',
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

// Render Editor, fire a drop on contentDOM, wait for async handleDrop to finish.
async function renderAndDrop(
  files: File[],
  onImportToast: (toast: { state: ImportToastState; message: string }) => void,
) {
  fakeView.state._text = ''
  fakeView.dispatch.mockClear()
  fakeView.posAtCoords.mockClear()

  render(<Editor {...defaultProps()} onImportToast={onImportToast} />)

  // Wait for the deferred onCreateEditor and for useMemo to register the listener
  await new Promise((r) => setTimeout(r, 10))

  editorContentDOM.dispatchEvent(makeDragEvent(files))

  // Wait for the async handleDrop (arrayBuffer → writeBinary → dispatch → toast)
  await new Promise((r) => setTimeout(r, 50))
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Fresh contentDOM so listeners from prior renders don't fire on this test's event.
  editorContentDOM = document.createElement('div')
  editorContentDOM.className = 'cm-content'
  setupMarvinMock()
  fakeView.state._text = ''
  fakeView.dispatch.mockClear()
  fakeView.posAtCoords.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ===========================================================================
// Tests
// ===========================================================================

describe('Editor — CodeMirror drop handler (issue #289)', () => {
  it('image drop: writeBinary called once, image markdown inserted, singular success toast', async () => {
    const onImportToast = vi.fn()
    const file = new File(['fake-png'], 'photo.png', { type: 'image/png' })
    await renderAndDrop([file], onImportToast)

    expect(writeBinaryMock).toHaveBeenCalledTimes(1)
    expect(writeBinaryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        vaultPath: '/vault',
        relPath: expect.stringMatching(/^attachments\/.+\.png$/),
        base64Bytes: expect.any(String),
      }),
    )
    expect(writeBinaryMock.mock.calls[0][0]).not.toHaveProperty('maxBytes')
    expect(fakeView.state._text).toMatch(/!\[photo\.png\]\(attachments\/.+\.png\)/)
    expect(onImportToast).toHaveBeenCalledTimes(1)
    expect(onImportToast).toHaveBeenCalledWith({
      state: 'success',
      message: 'Imported 1 attachment.',
    })
  })

  it('non-image drop: link markdown inserted, singular success toast', async () => {
    const onImportToast = vi.fn()
    const file = new File(['pdf-bytes'], 'doc.pdf', { type: 'application/pdf' })
    await renderAndDrop([file], onImportToast)

    expect(writeBinaryMock).toHaveBeenCalledTimes(1)
    expect(fakeView.state._text).toMatch(/\[doc\.pdf\]\(attachments\/.+\.pdf\)/)
    expect(onImportToast).toHaveBeenCalledTimes(1)
    expect(onImportToast).toHaveBeenCalledWith({
      state: 'success',
      message: 'Imported 1 attachment.',
    })
  })

  it('multiple files: writeBinary twice in order, both markdowns present, plural toast', async () => {
    const onImportToast = vi.fn()
    const img = new File(['img'], 'photo.png', { type: 'image/png' })
    const pdf = new File(['pdf'], 'doc.pdf', { type: 'application/pdf' })
    await renderAndDrop([img, pdf], onImportToast)

    expect(writeBinaryMock).toHaveBeenCalledTimes(2)
    expect(writeBinaryMock.mock.calls[0][0].relPath).toMatch(/\.png$/)
    expect(writeBinaryMock.mock.calls[1][0].relPath).toMatch(/\.pdf$/)
    expect(fakeView.state._text).toMatch(/!\[photo\.png\]/)
    expect(fakeView.state._text).toMatch(/\[doc\.pdf\]/)
    expect(onImportToast).toHaveBeenCalledTimes(1)
    expect(onImportToast).toHaveBeenCalledWith({
      state: 'success',
      message: 'Imported 2 attachments.',
    })
  })

  it('oversized file: writeBinary not called, error toast contains filename and size limit', async () => {
    const onImportToast = vi.fn()
    const bigFile = Object.defineProperty(
      new File(['x'], 'huge.png', { type: 'image/png' }),
      'size',
      { value: 26 * 1024 * 1024 },
    )
    await renderAndDrop([bigFile], onImportToast)

    expect(writeBinaryMock).not.toHaveBeenCalled()
    expect(onImportToast).toHaveBeenCalledTimes(1)
    const toast = onImportToast.mock.calls[0][0] as { state: string; message: string }
    expect(toast.state).toBe('error')
    expect(toast.message).toContain('larger than 25 MB')
    expect(toast.message).toContain('huge.png')
  })

  it('note in subfolder: external drop inserts ../attachments/ link (file-relative)', async () => {
    const onImportToast = vi.fn()
    const file = new File(['png'], 'photo.png', { type: 'image/png' })
    fakeView.state._text = ''
    fakeView.dispatch.mockClear()
    render(
      <Editor
        {...defaultProps()}
        filePath="/vault/sub/note.ts"
        onImportToast={onImportToast}
      />,
    )
    await new Promise((r) => setTimeout(r, 10))
    editorContentDOM.dispatchEvent(makeDragEvent([file]))
    await new Promise((r) => setTimeout(r, 50))

    expect(fakeView.state._text).toMatch(/!\[photo\.png\]\(\.\.\/attachments\/.+\.png\)/)
  })

  it('internal drag from file tree: inserts relative markdown link without IPC copy', async () => {
    const onImportToast = vi.fn()
    render(<Editor {...defaultProps()} onImportToast={onImportToast} />)
    await new Promise((r) => setTimeout(r, 10))

    editorContentDOM.dispatchEvent(makeDragEvent([], '/vault/sub/photo.png'))
    await new Promise((r) => setTimeout(r, 20))

    expect(writeBinaryMock).not.toHaveBeenCalled()
    expect(fakeView.state._text).toBe('![photo.png](sub/photo.png)')
  })

  it('internal drag with spaces in filename: wraps link in angle brackets (raw path)', async () => {
    const onImportToast = vi.fn()
    render(<Editor {...defaultProps()} onImportToast={onImportToast} />)
    await new Promise((r) => setTimeout(r, 10))

    editorContentDOM.dispatchEvent(makeDragEvent([], '/vault/Captura de Tela.png'))
    await new Promise((r) => setTimeout(r, 20))

    expect(fakeView.state._text).toBe('![Captura de Tela.png](<Captura de Tela.png>)')
  })

  it('IPC rejection: error toast contains filename and error message', async () => {
    setupMarvinMock(vi.fn().mockRejectedValue(new Error('MARVIN_FS_EACCES')))
    const onImportToast = vi.fn()
    const file = new File(['bytes'], 'secret.md', { type: 'text/markdown' })
    await renderAndDrop([file], onImportToast)

    expect(writeBinaryMock).toHaveBeenCalledTimes(1)
    expect(onImportToast).toHaveBeenCalledTimes(1)
    const toast = onImportToast.mock.calls[0][0] as { state: string; message: string }
    expect(toast.state).toBe('error')
    expect(toast.message).toContain('secret.md')
    expect(toast.message).toContain('MARVIN_FS_EACCES')
  })

  it('plural MIME (3 paths): inserts 3 markdown lines joined by \\n in one dispatch', async () => {
    const onImportToast = vi.fn()
    render(<Editor {...defaultProps()} onImportToast={onImportToast} />)
    await new Promise((r) => setTimeout(r, 10))
    // Clear any dispatches from initialization before measuring drop behavior.
    fakeView.dispatch.mockClear()
    fakeView.state._text = ''

    const paths = ['/vault/a.md', '/vault/b.md', '/vault/c.md']
    editorContentDOM.dispatchEvent(makeDragEvent([], '', paths))
    await new Promise((r) => setTimeout(r, 20))

    expect(writeBinaryMock).not.toHaveBeenCalled()
    // Filter to content-changing dispatches only — a follow-up decoration-clear
    // setTimeout fires after 500ms and must not break the undo-atomicity assertion.
    const contentDispatches = fakeView.dispatch.mock.calls.filter(
      (c) => (c[0] as { changes?: unknown })?.changes != null,
    )
    expect(contentDispatches).toHaveLength(1)
    // Each path relative to /vault/note.ts → file name only (same dir)
    expect(fakeView.state._text).toContain('[a.md](a.md)')
    expect(fakeView.state._text).toContain('[b.md](b.md)')
    expect(fakeView.state._text).toContain('[c.md](c.md)')
    const lines = fakeView.state._text.split('\n')
    expect(lines).toHaveLength(3)
  })

  it('singular MIME only: backward-compat single line inserted (no regression)', async () => {
    const onImportToast = vi.fn()
    render(<Editor {...defaultProps()} onImportToast={onImportToast} />)
    await new Promise((r) => setTimeout(r, 10))

    editorContentDOM.dispatchEvent(makeDragEvent([], '/vault/note2.md'))
    await new Promise((r) => setTimeout(r, 20))

    expect(writeBinaryMock).not.toHaveBeenCalled()
    expect(fakeView.state._text).toBe('[note2.md](note2.md)')
  })

  it('dragover accepts plural MIME type', async () => {
    render(<Editor {...defaultProps()} onImportToast={vi.fn()} />)
    await new Promise((r) => setTimeout(r, 10))

    const dragoverEvent = new Event('dragover', {
      bubbles: true,
      cancelable: true,
    }) as DragEvent
    const preventDefaultSpy = vi.fn()
    Object.defineProperty(dragoverEvent, 'dataTransfer', {
      value: {
        types: ['application/x-marvin-paths'],
        dropEffect: 'none',
      },
      writable: false,
    })
    Object.defineProperty(dragoverEvent, 'preventDefault', {
      value: preventDefaultSpy,
      writable: false,
    })
    editorContentDOM.dispatchEvent(dragoverEvent)
    expect(preventDefaultSpy).toHaveBeenCalled()
  })
})
