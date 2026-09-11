// @vitest-environment jsdom
//
// Regression test for issue #532: LiveMarkdown stays stale in Page mode when
// an agent edits the file externally. Pipeline: chokidar -> `file:changed` IPC
// -> App.tsx updates tab.content + bumps tab.version (clean-buffer branch) ->
// Editor receives new `initialContent` + `version` props.
//
// jsdom cannot simulate Milkdown/ProseMirror contentEditable, so we don't
// assert on rendered Milkdown DOM text. Instead we pin the remount-key
// CONTRACT at the Editor level: LiveMarkdown itself keys its inner instance
// by `remountKey` (see LiveMarkdown.tsx: `<LiveMarkdownInner key={String(props.remountKey)} />`),
// so mocking LiveMarkdown with an inner component keyed the same way lets us
// observe real React mount/unmount behavior driven purely by the remountKey
// value Editor computes.
//
// NOTE: mock specifiers below are resolved relative to THIS file (one
// directory below Editor.tsx), so sibling components use `../Foo` and `lib`
// modules use `../../lib/foo` — not the `./Foo` / `../lib/foo` shorthand
// Editor.tsx itself uses relative to its own location.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect } from 'react'
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

vi.mock('@uiw/react-codemirror', () => ({
  default: () => <div data-testid="codemirror" />,
}))

vi.mock('../../lib/cmLanguage', () => ({
  languageIdFor: () => null,
  loadLanguage: () => Promise.resolve(null),
}))

vi.mock('../../lib/cmJustReplacedHighlight', () => ({ justReplacedField: {} }))
vi.mock('../../lib/cmJustInsertedHighlight', () => ({
  justInsertedField: {},
  flashInserted: { of: () => ({}) },
  clearInsertedFlashes: { of: () => ({}) },
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
vi.mock('../FindReplaceOverlay', () => ({ FindReplaceOverlay: () => null }))
vi.mock('../CodeMirrorFindBar', () => ({ CodeMirrorFindBar: () => null }))
vi.mock('../../lib/visualStyle', () => ({ useVisualStyle: () => 'modern' }))
vi.mock('../../lib/wikilinks', () => ({
  isWikilinkHref: () => null,
  resolveWikilink: () => null,
}))
vi.mock('../../lib/paletteRanker', () => ({}))

// ---------------------------------------------------------------------------
// LiveMarkdown mock — records remountKey mount/unmount lifecycle and captures
// the body onChange callback, mirroring how the real component keys its inner
// instance by `remountKey` (LiveMarkdown.tsx).
// ---------------------------------------------------------------------------

let mountKeys: string[] = []
let unmountKeys: string[] = []
let capturedOnChange: ((body: string) => void) | null = null

function LiveMarkdownMockInner({ remountKey }: { remountKey: string }) {
  useEffect(() => {
    mountKeys.push(remountKey)
    return () => {
      unmountKeys.push(remountKey)
    }
  }, [remountKey])
  return <div data-testid="live-markdown" data-remount-key={remountKey} />
}

vi.mock('../LiveMarkdown', () => ({
  LiveMarkdown: (props: { remountKey: string | number; onChange: (body: string) => void }) => {
    capturedOnChange = props.onChange
    const key = String(props.remountKey)
    return <LiveMarkdownMockInner key={key} remountKey={key} />
  },
}))
// Editor.tsx lazy-loads Milkdown/ProseMirror via this wrapper's default
// export (#583) instead of importing LiveMarkdown directly — mock it too,
// with the same mount/unmount-tracking body, so the remount contract this
// spec pins still observes real React lifecycle through the Suspense boundary.
vi.mock('../LiveMarkdownLazy', () => ({
  default: (props: { remountKey: string | number; onChange: (body: string) => void }) => {
    capturedOnChange = props.onChange
    const key = String(props.remountKey)
    return <LiveMarkdownMockInner key={key} remountKey={key} />
  },
}))

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

// filePath is a .md file so hasPreview is true and the default mode state
// ('preview') puts the Editor in Page mode without any user interaction.
function baseProps(overrides: Partial<Parameters<typeof Editor>[0]> = {}) {
  return {
    filePath: '/vault/note.md',
    vaultPath: '/vault',
    initialContent: 'first',
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
  mountKeys = []
  unmountKeys = []
  capturedOnChange = null
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Editor (Page mode) — LiveMarkdown remount contract (#532)', () => {
  // Editor.tsx now lazy-loads LiveMarkdown behind a Suspense boundary
  // (#583) — even a mocked module resolves on a microtask, not
  // synchronously, so the mount effect needs an async act tick before the
  // mountKeys/unmountKeys assertions below can observe it.
  it('remounts LiveMarkdown when version changes on an external clean reload, same filePath', async () => {
    let rerender!: (ui: React.ReactElement) => void
    await act(async () => {
      const result = render(<Editor {...baseProps({ initialContent: 'first', version: 1 })} />)
      rerender = result.rerender
    })

    expect(mountKeys).toHaveLength(1)
    expect(unmountKeys).toHaveLength(0)

    // Simulates App.tsx's clean-buffer branch (App.tsx:596-609): same filePath,
    // new initialContent from disk, version bumped.
    await act(async () => {
      rerender(<Editor {...baseProps({ initialContent: 'second (external edit)', version: 2 })} />)
    })

    // LiveMarkdown must remount so it picks up the fresh external content
    // instead of freezing its body at the stale first-mount value.
    expect(unmountKeys).toHaveLength(1)
    expect(mountKeys).toHaveLength(2)
    expect(mountKeys[0]).not.toBe(mountKeys[1])
  })

  it('does NOT remount LiveMarkdown while typing (onChange path), version unchanged', async () => {
    await act(async () => {
      render(<Editor {...baseProps({ initialContent: 'first', version: 1 })} />)
    })

    expect(mountKeys).toHaveLength(1)

    act(() => {
      capturedOnChange?.('typed content, no external reload')
    })

    // Typing only flows through onChange/scheduleSave; filePath and version
    // are unchanged, so no remount should happen while the buffer is dirty.
    expect(mountKeys).toHaveLength(1)
    expect(unmountKeys).toHaveLength(0)
  })
})
