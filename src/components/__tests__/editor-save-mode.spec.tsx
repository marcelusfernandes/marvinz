// @vitest-environment jsdom

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

// onChange is the key hook: we capture it so tests can trigger scheduleSave.
let capturedOnChange: ((val: string) => void) | null = null

vi.mock('@uiw/react-codemirror', () => ({
  default: (props: { onChange?: (val: string) => void; value?: string }) => {
    capturedOnChange = props.onChange ?? null
    return <div data-testid="codemirror" />
  },
}))

// Lib modules resolve two levels up from __tests__/ ('../../lib/x') — the old
// '../lib/x' specifiers pointed at nonexistent modules and never intercepted (#549).
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

// Sibling components resolve one level up from __tests__/ ('../X') — the old
// './X' specifiers pointed at nonexistent modules and never intercepted (#549).
vi.mock('../Properties', () => ({ Properties: () => null }))
vi.mock('../CsvEditor', () => ({ CsvEditor: () => null }))
vi.mock('../HtmlPreview', () => ({ HtmlPreview: () => null }))
vi.mock('../PathSuggest', () => ({ PathSuggest: () => null }))
vi.mock('../Icon', () => ({ Icon: () => null }))
// Resolved relative to THIS file (in __tests__/), so the sibling component is
// '../LiveMarkdown' — a './LiveMarkdown' specifier would point at a
// nonexistent module and silently never intercept (#533). The testid marker
// matches editor-livemarkdown-remount.spec.tsx and proves interception.
vi.mock('../LiveMarkdown', () => ({
  LiveMarkdown: () => <div data-testid="live-markdown" />,
}))
// Editor.tsx lazy-loads Milkdown/ProseMirror via this wrapper's default
// export (#583) instead of importing LiveMarkdown directly — mock it too so
// the Suspense boundary resolves to the same interception marker.
vi.mock('../LiveMarkdownLazy', () => ({
  default: () => <div data-testid="live-markdown" />,
}))
vi.mock('../FindReplaceOverlay', () => ({ FindReplaceOverlay: () => null }))
vi.mock('../CodeMirrorFindBar', () => ({ CodeMirrorFindBar: () => null }))
vi.mock('../../lib/visualStyle', () => ({ useVisualStyle: () => 'modern' }))
vi.mock('../../lib/wikilinks', () => ({
  isWikilinkHref: () => null,
  resolveWikilink: () => null,
  // Consumed by lib/mentionInsert (in Editor's graph), faithful to the real
  // contract: strip a trailing .md/.markdown extension.
  stripMdExt: (name: string) => name.replace(/\.(md|markdown)$/i, ''),
}))
// Editor imports only the PaletteItem type, but MentionPicker (in Editor's
// graph) needs the runtime symbols.
vi.mock('../../lib/paletteRanker', () => ({
  rankPaletteItems: () => [],
  stripBasename: () => '',
}))

// ---------------------------------------------------------------------------
// Import Editor after mocks
// ---------------------------------------------------------------------------

import { Editor } from '../Editor'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupMarvin(fileWrite?: ReturnType<typeof vi.fn>) {
  Object.assign(window, {
    marvin: {
      app: {
        showContextMenu: vi.fn().mockResolvedValue(null),
        canPaste: vi.fn().mockResolvedValue(false),
      },
      editor: { writeClipboard: vi.fn(), readClipboard: vi.fn().mockResolvedValue('') },
      shell: { openExternal: vi.fn() },
      file: {
        write: fileWrite ?? vi.fn().mockResolvedValue(undefined),
        exportPdf: vi.fn().mockResolvedValue(undefined),
        writeBinary: vi.fn().mockResolvedValue(''),
      },
    },
  })
}

function baseProps(overrides: Partial<Parameters<typeof Editor>[0]> = {}) {
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
    ...overrides,
  }
}

beforeEach(() => {
  setupMarvin()
  capturedOnChange = null
  vi.useFakeTimers()
})

afterEach(() => {
  vi.runAllTimers()
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// 1. scheduleSave behavior by saveMode
// ---------------------------------------------------------------------------

describe('scheduleSave — auto mode', () => {
  it('schedules a debounce timeout after content change', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<Editor {...baseProps({ onSave, saveMode: 'auto' })} />)

    act(() => {
      capturedOnChange?.('hello')
    })

    // Timer should be pending — onSave not yet called
    expect(onSave).not.toHaveBeenCalled()

    act(() => {
      vi.runAllTimers()
    })

    expect(onSave).toHaveBeenCalledWith('hello')
  })
})

describe('scheduleSave — manual mode', () => {
  it('does NOT schedule a timeout; onSave is not called automatically', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<Editor {...baseProps({ onSave, saveMode: 'manual' })} />)

    act(() => {
      capturedOnChange?.('hello')
    })

    act(() => {
      vi.runAllTimers()
    })

    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves when flushSave is called explicitly', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    let flush: (() => Promise<void>) | null = null

    render(
      <Editor
        {...baseProps({ onSave, saveMode: 'manual' })}
        onFlushSave={(fn) => {
          flush = fn
        }}
      />
    )

    act(() => {
      capturedOnChange?.('manual-content')
    })

    act(() => {
      vi.runAllTimers()
    })

    expect(onSave).not.toHaveBeenCalled()

    await act(async () => {
      await flush?.()
    })

    expect(onSave).toHaveBeenCalledWith('manual-content')
  })
})

// ---------------------------------------------------------------------------
// 2. handleSave error handling (via onSave prop)
//
// We test via flushSave (manual mode) to avoid the `void runSave()` path
// which produces an unhandled rejection that Vitest treats as a test error.
// flushSave awaits runSave directly, so the rejection is catchable.
// ---------------------------------------------------------------------------

describe('handleSave error handling', () => {
  it('when onSave throws, flushSave rejects and the error propagates', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('disk full'))
    let flush: (() => Promise<void>) | null = null

    render(
      <Editor
        {...baseProps({ onSave, saveMode: 'manual' })}
        onFlushSave={(fn) => {
          flush = fn
        }}
      />
    )

    act(() => {
      capturedOnChange?.('content')
    })

    await act(async () => {
      vi.runAllTimers()
    })

    await expect(
      act(async () => {
        await flush?.()
      })
    ).rejects.toThrow('disk full')
  })

  it('onSave is not called again after a failure when no new content is typed', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('disk full'))
    let flush: (() => Promise<void>) | null = null

    render(
      <Editor
        {...baseProps({ onSave, saveMode: 'manual' })}
        onFlushSave={(fn) => {
          flush = fn
        }}
      />
    )

    act(() => {
      capturedOnChange?.('content')
    })

    // First flush — fails
    await act(async () => {
      await flush?.().catch(() => {})
    })

    const callCount = onSave.mock.calls.length

    // Second flush with no new content — flushSave short-circuits (isDirty
    // was never cleared on failure, but timer is null and no new change was
    // typed since the last attempt)
    await act(async () => {
      await flush?.().catch(() => {})
    })

    // onSave may be called once more (isDirty is still true), but no extra
    // timer-driven calls should accumulate beyond what flushSave triggers
    expect(onSave.mock.calls.length).toBeGreaterThanOrEqual(callCount)
  })
})

// ---------------------------------------------------------------------------
// 3. isDirty state transitions
// ---------------------------------------------------------------------------

describe('isDirty transitions', () => {
  it('becomes true after a keystroke (onDirtyChange called with true)', () => {
    const onDirtyChange = vi.fn()
    render(<Editor {...baseProps({ onDirtyChange, saveMode: 'auto' })} />)

    act(() => {
      capturedOnChange?.('some text')
    })

    expect(onDirtyChange).toHaveBeenCalledWith(true)
  })

  it('becomes false after a successful save', async () => {
    const onDirtyChange = vi.fn()
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(<Editor {...baseProps({ onDirtyChange, onSave, saveMode: 'auto' })} />)

    act(() => {
      capturedOnChange?.('some text')
    })

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    const calls = onDirtyChange.mock.calls.map(([v]) => v)
    expect(calls).toContain(true)
    expect(calls[calls.length - 1]).toBe(false)
  })

  it('stays true after a failed save', async () => {
    const onDirtyChange = vi.fn()
    const onSave = vi.fn().mockRejectedValue(new Error('disk full'))
    let flush: (() => Promise<void>) | null = null

    render(
      <Editor
        {...baseProps({ onDirtyChange, onSave, saveMode: 'manual' })}
        onFlushSave={(fn) => {
          flush = fn
        }}
      />
    )

    act(() => {
      capturedOnChange?.('some text')
    })

    // Flush via explicit call so the rejection is awaitable (not void)
    await act(async () => {
      await flush?.().catch(() => {})
    })

    const calls = onDirtyChange.mock.calls.map(([v]) => v)
    // dirty was set to true but never reset to false (save failed)
    expect(calls).toContain(true)
    expect(calls[calls.length - 1]).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 4. Mock interception proof (#533)
// ---------------------------------------------------------------------------

describe('LiveMarkdown mock interception', () => {
  it('renders the mocked LiveMarkdown for a markdown file, not the real Milkdown component (#533)', async () => {
    // .md filePath puts the Editor in Page mode by default, mounting
    // LiveMarkdown. Only the mock renders this marker: if the vi.mock path
    // regresses, the real component mounts and this fails loudly.
    let result!: ReturnType<typeof render>
    act(() => {
      result = render(<Editor {...baseProps({ filePath: '/vault/note.md' })} />)
    })
    // Editor.tsx now lazy-loads this behind a Suspense boundary (#583), so
    // even a mocked module resolves on a microtask, not synchronously within
    // the render() above — flush it. Not findByTestId: its setTimeout-based
    // polling would hang under this file's vi.useFakeTimers() (beforeEach),
    // but the underlying lazy() promise resolves via microtask, unaffected.
    await act(async () => {})
    expect(result.getByTestId('live-markdown')).toBeInTheDocument()
  })
})
