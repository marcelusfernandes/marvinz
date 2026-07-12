// @vitest-environment jsdom
//
// TDD RED for issue #558 (perf(editor): debounce frontmatter re-split/re-
// serialize in Page/Preview mode). `handleBodyChange` (Editor.tsx) currently
// calls `splitFrontmatter`/`serializeFrontmatter` unconditionally on every
// ProseMirror body-change callback — i.e. every keystroke in Page/Preview
// mode — even though the frontmatter block only ever changes through the
// Properties panel (`handlePropertiesChange`).
//
// Because this is a perf issue, "RED" here is a call-count/behavior
// assertion, not a timing benchmark: with fake timers, N rapid body edits
// must collapse into ~1 `serializeFrontmatter` call (not N) once the save
// debounce window settles. Today it's called once per keystroke.
// `serializeFrontmatter` is the cleanest discriminator — it's called ONLY
// from `handleBodyChange` (the separate `frontmatter`/`previewBody`
// `useMemo` that feeds the Properties panel calls `splitFrontmatter` on
// every render regardless of this fix, out of scope per the issue, so
// asserting on `splitFrontmatter`'s raw count would conflate the two).
//
// Coverage:
//   1. RED: N rapid body edits collapse into ~1 serializeFrontmatter call
//      after the debounce window settles.
//   2. Guard: last-state-always-wins — the flushed/saved content reflects
//      the FINAL body typed during the burst, never an intermediate one.
//   3. Guard: flushSave() (blur/tab-close/manual-save path) forces an
//      immediate, correctly-reassembled save even before the debounce
//      window elapses — a deferred-reassembly fix must not skip the work
//      when flushed early.
//   4. Guard: editing frontmatter via the Properties panel is still
//      correctly reflected in the next body edit's saved output (cache
//      invalidated on `handlePropertiesChange`, per the issue's AC).
// Guards 2-4 pass against today's code too (no caching yet, so nothing to
// invalidate incorrectly) — they exist to catch the fix regressing them.
//
// Strategy: mount the real Editor in Page/Preview mode (.md file, default
// mode state), reusing the LiveMarkdown/CodeMirror mocking pattern from
// editor-livemarkdown-remount.spec.tsx and the fake-timers pattern from
// editor-save-mode.spec.tsx. `../../lib/frontmatter` is mocked as a spy
// wrapping the REAL implementation (not a dumb stub), so content-fidelity
// assertions stay meaningful while call counts are observable.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'

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
// counts are observable — the crux of what #558 needs to exercise.
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
// Properties mock (above) captures its onChange (handlePropertiesChange).
// ---------------------------------------------------------------------------

let capturedOnChange: ((body: string) => void) | null = null
let capturedPropertiesOnChange: ((next: Record<string, unknown>) => void) | null = null

vi.mock('../LiveMarkdown', () => ({
  LiveMarkdown: (props: { onChange: (body: string) => void }) => {
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
  splitFrontmatterMock.mockClear()
  serializeFrontmatterMock.mockClear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.runAllTimers()
  vi.useRealTimers()
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

describe('Frontmatter re-split/re-serialize must be debounced in Page/Preview mode (issue #558)', () => {
  it('N rapid body-only edits collapse into ~1 serializeFrontmatter call after the debounce window settles', () => {
    render(<Editor {...baseProps()} />)

    // Mount itself exercises the frontmatter/previewBody useMemo once;
    // isolate the burst's own call count from that baseline.
    splitFrontmatterMock.mockClear()
    serializeFrontmatterMock.mockClear()

    typeBody('original body A')
    typeBody('original body AB')
    typeBody('original body ABC')
    typeBody('original body ABCD')
    typeBody('original body ABCDE')

    act(() => {
      vi.runAllTimers()
    })

    // FAILS today: handleBodyChange calls serializeFrontmatter on every
    // invocation, so 5 body edits produce 5 calls, not ~1.
    expect(serializeFrontmatterMock.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('the flushed save reflects the LAST body typed during the burst, never an intermediate one', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<Editor {...baseProps({ onSave })} />)

    typeBody('final body wins A')
    typeBody('final body wins AB')
    typeBody('final body wins ABC')

    await act(async () => {
      vi.runAllTimers()
    })

    expect(onSave).toHaveBeenCalledTimes(1)
    const saved = onSave.mock.calls[0][0] as string
    expect(saved).toContain('final body wins ABC')
    expect(saved).not.toContain('final body wins A\n')
    expect(saved).not.toContain('final body wins AB\n')
    expect(saved).toMatch(/^---\ntitle: Test Note/)
  })

  it('flushSave forces an immediate, correctly-reassembled save before the debounce window elapses', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    let flush: (() => Promise<void>) | null = null

    render(
      <Editor
        {...baseProps({ onSave })}
        onFlushSave={(fn: () => Promise<void>) => {
          flush = fn
        }}
      />
    )

    typeBody('flushed body change')

    // Flush immediately — the debounce window has NOT elapsed.
    await act(async () => {
      await flush?.()
    })

    expect(onSave).toHaveBeenCalledTimes(1)
    const saved = onSave.mock.calls[0][0] as string
    expect(saved).toContain('flushed body change')
    expect(saved).toMatch(/^---\ntitle: Test Note/)
  })

  it('editing frontmatter via the Properties panel is reflected in the next body edit (cache invalidated correctly)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<Editor {...baseProps({ onSave })} />)

    // Change frontmatter through the Properties panel.
    act(() => {
      capturedPropertiesOnChange?.({ title: 'Updated Title', tags: ['alpha'] })
    })

    // Then a body-only edit.
    typeBody('body after properties edit')

    await act(async () => {
      vi.runAllTimers()
    })

    expect(onSave).toHaveBeenCalled()
    const saved = onSave.mock.calls[onSave.mock.calls.length - 1][0] as string
    expect(saved).toContain('title: Updated Title')
    expect(saved).toContain('body after properties edit')
  })
})
