// @vitest-environment jsdom
//
// TDD RED for issue #558 (perf(editor): debounce frontmatter re-split/re-
// serialize in Page/Preview mode). `handleBodyChange` (Editor.tsx) currently
// calls `splitFrontmatter`/`serializeFrontmatter` unconditionally on every
// ProseMirror body-change callback — i.e. every keystroke in Page/Preview
// mode — even though the frontmatter block only ever changes through the
// Properties panel (`handlePropertiesChange`). The separate `frontmatter`/
// `previewBody` `useMemo` (~Editor.tsx:836) recomputes the same way, on
// every `value` change (also every keystroke).
//
// Design decision (react-dev + team-lead, final): a CACHE/memoization, NOT
// a debounce/deferral. Deferring the frontmatter reassembly to the save
// timer was rejected — it would mean `onBufferChange`/the live buffer could
// carry a body-only fragment during the deferred window, risking data loss
// if a save/close/navigation happened mid-window. So there is NO debounce
// window for this work: the full document (frontmatter + body) must reach
// `onBufferChange`/save on every single call, immediately. Only the
// (expensive) full split+YAML-parse / serialize+YAML-stringify calls
// themselves are cached — keyed on the frontmatter block being unchanged
// (a cheap check, e.g. a prefix/`startsWith` comparison) — and a real
// frontmatter change (Properties panel) invalidates that cache and
// recomputes immediately, no waiting window either.
//
// Coverage:
//   1. RED: N rapid body-only edits collapse into O(1) full
//      splitFrontmatter/serializeFrontmatter calls (spied GLOBALLY, across
//      BOTH call sites: handleBodyChange and the previewBody useMemo) —
//      today each scales linearly with N.
//   2. Guard (data-loss): `onBufferChange` always receives the FULL
//      reassembled document on every call, never a body-only fragment —
//      the caching must never leak into what's buffered/saved.
//   3. Guard (immediate invalidation): a real frontmatter change via the
//      Properties panel is reflected immediately (same tick, no waiting) —
//      both in the data the Properties panel itself renders, and in the
//      very next body edit's reassembled output.
//   4. Guard (pre-existing disk-write debounce unaffected): the actual
//      disk save (SAVE_DEBOUNCE_MS, unrelated/out-of-scope per the issue)
//      still eventually persists the correctly cached+reassembled content.
//
// Strategy: mount the real Editor in Page/Preview mode (.md file, default
// mode state), reusing the LiveMarkdown mocking pattern from
// editor-livemarkdown-remount.spec.tsx. `../../lib/frontmatter` is mocked
// as a spy wrapping the REAL implementation (not a dumb stub), so content-
// fidelity assertions stay meaningful while call counts are observable.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

// Spy-wrap the REAL frontmatter module so content-fidelity assertions stay
// meaningful (round-trips through the real yaml parse/stringify) while call
// counts are observable — the crux of what #558 needs to exercise. This spy
// is GLOBAL: it counts calls from BOTH real call sites (handleBodyChange and
// the previewBody useMemo), matching the fix's single shared cache.
vi.mock('../../lib/frontmatter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/frontmatter')>()
  return {
    ...actual,
    splitFrontmatter: vi.fn(actual.splitFrontmatter),
    serializeFrontmatter: vi.fn(actual.serializeFrontmatter),
  }
})

vi.mock('../Properties', () => ({
  Properties: (props: {
    data: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
  }) => {
    capturedPropertiesOnChange = props.onChange
    lastPropertiesData = props.data
    return <div data-testid="properties" />
  },
}))
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
// LiveMarkdown mock — captures the body onChange callback (handleBodyChange).
// Properties mock (above) captures its onChange (handlePropertiesChange) and
// the `data` it's currently rendering, so tests can assert on it directly
// without waiting for anything (the fix invalidates/recomputes immediately).
// ---------------------------------------------------------------------------

let capturedOnChange: ((body: string) => void) | null = null
let capturedPropertiesOnChange: ((next: Record<string, unknown>) => void) | null = null
let lastPropertiesData: Record<string, unknown> | null = null

vi.mock('../LiveMarkdown', () => ({
  LiveMarkdown: (props: { onChange: (body: string) => void }) => {
    capturedOnChange = props.onChange
    return <div data-testid="live-markdown" />
  },
}))
// Editor.tsx lazy-loads Milkdown/ProseMirror via this wrapper's default
// export (#583) instead of importing LiveMarkdown directly — mock it too so
// capturedOnChange still gets set through the Suspense boundary.
vi.mock('../LiveMarkdownLazy', () => ({
  default: (props: { onChange: (body: string) => void }) => {
    capturedOnChange = props.onChange
    return <div data-testid="live-markdown" />
  },
}))

// ---------------------------------------------------------------------------
// Import Editor (+ the spied frontmatter fns) after mocks
// ---------------------------------------------------------------------------

import { Editor } from '../Editor'
import { splitFrontmatter, serializeFrontmatter } from '../../lib/frontmatter'

const splitFrontmatterMock = vi.mocked(splitFrontmatter)
const serializeFrontmatterMock = vi.mocked(serializeFrontmatter)

// ---------------------------------------------------------------------------
// window.marvin mock
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

// filePath is a .md file so hasPreview is true, and the default mode state
// ('preview') puts the Editor in Page mode without any user interaction.
// initialContent carries a real frontmatter block so split/serialize are
// actually exercised on every body change (not short-circuited by `!data`).
function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    filePath: '/vault/note.md',
    vaultPath: '/vault',
    initialContent: '---\ntitle: Test Note\ntags:\n  - alpha\n---\n\noriginal body',
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
  capturedOnChange = null
  capturedPropertiesOnChange = null
  lastPropertiesData = null
  splitFrontmatterMock.mockClear()
  serializeFrontmatterMock.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function typeBody(text: string) {
  act(() => {
    capturedOnChange?.(text)
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Frontmatter re-split/re-serialize must be cached, not recomputed per keystroke, in Page/Preview mode (issue #558)', () => {
  it('N rapid body-only edits collapse into O(1) full split/serialize calls (no debounce window — recompute is immediate but cached)', async () => {
    const result = render(<Editor {...baseProps()} />)
    // Editor.tsx now lazy-loads LiveMarkdown behind a Suspense boundary
    // (#583) — capturedOnChange is only set once the mock resolves, which
    // happens on a microtask, not synchronously within render() above.
    await result.findByTestId('live-markdown')

    // Mount itself exercises the frontmatter/previewBody useMemo once;
    // isolate the burst's own call count from that baseline.
    splitFrontmatterMock.mockClear()
    serializeFrontmatterMock.mockClear()

    typeBody('original body A')
    typeBody('original body AB')
    typeBody('original body ABC')
    typeBody('original body ABCD')
    typeBody('original body ABCDE')

    // No timers/advance needed — the fix has no debounce window for this
    // work at all; the assertion is purely about call count and content.
    // FAILS today: handleBodyChange calls splitFrontmatter+serializeFrontmatter
    // on every invocation, and the previewBody useMemo calls splitFrontmatter
    // on every `value` change too — both scale linearly with the 5 edits.
    expect(splitFrontmatterMock.mock.calls.length).toBeLessThanOrEqual(2)
    expect(serializeFrontmatterMock.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('onBufferChange always receives the FULL reassembled document, never a body-only fragment (no data loss from caching)', async () => {
    const onBufferChange = vi.fn()
    const result = render(<Editor {...baseProps({ onBufferChange })} />)
    await result.findByTestId('live-markdown')

    typeBody('body only text one')
    typeBody('body only text two')
    typeBody('body only text three')

    expect(onBufferChange.mock.calls.length).toBeGreaterThan(0)
    // Every single call, not just the last — the cache must never leak a
    // body-only buffer state at any point in the sequence.
    for (const call of onBufferChange.mock.calls) {
      const buffered = call[0] as string
      expect(buffered).toMatch(/^---\ntitle: Test Note/)
    }
    const lastBuffered = onBufferChange.mock.calls[
      onBufferChange.mock.calls.length - 1
    ][0] as string
    expect(lastBuffered).toContain('body only text three')
  })

  it('a real frontmatter change via the Properties panel is reflected immediately — no waiting window', async () => {
    const onBufferChange = vi.fn()
    const result = render(<Editor {...baseProps({ onBufferChange })} />)
    await result.findByTestId('live-markdown')

    act(() => {
      capturedPropertiesOnChange?.({ title: 'Updated Title', tags: ['alpha'] })
    })

    // Immediate — same tick, no timers/advance. Properties itself must
    // already be rendering the new data...
    expect(lastPropertiesData?.title).toBe('Updated Title')
    // ...and the buffered document must already carry it too.
    const lastBuffered = onBufferChange.mock.calls[
      onBufferChange.mock.calls.length - 1
    ][0] as string
    expect(lastBuffered).toContain('title: Updated Title')

    // The very next body edit must build on the NEW frontmatter, not a
    // stale cached copy from before the Properties change.
    typeBody('body after properties edit')
    const finalBuffered = onBufferChange.mock.calls[
      onBufferChange.mock.calls.length - 1
    ][0] as string
    expect(finalBuffered).toContain('title: Updated Title')
    expect(finalBuffered).toContain('body after properties edit')
  })

  it('the pre-existing disk-write debounce (unrelated, out of scope) still eventually persists the correctly cached+reassembled content', async () => {
    vi.useFakeTimers()
    try {
      const onSave = vi.fn().mockResolvedValue(undefined)
      render(<Editor {...baseProps({ onSave })} />)
      // Editor.tsx now lazy-loads LiveMarkdown behind a Suspense boundary
      // (#583) — flush the microtask it resolves on before typing. Not
      // findByTestId: its setTimeout-based polling would hang under fake
      // timers, but the underlying lazy() promise resolves via microtask,
      // unaffected by vi.useFakeTimers() (which only fakes macrotasks).
      await act(async () => {})

      typeBody('body before disk save A')
      typeBody('body before disk save AB')

      await act(async () => {
        vi.runAllTimers()
      })

      expect(onSave).toHaveBeenCalledTimes(1)
      const saved = onSave.mock.calls[0][0] as string
      expect(saved).toMatch(/^---\ntitle: Test Note/)
      expect(saved).toContain('body before disk save AB')
    } finally {
      vi.runAllTimers()
      vi.useRealTimers()
    }
  })
})
