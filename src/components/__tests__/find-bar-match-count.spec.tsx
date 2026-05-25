/**
 * Match-count readout contracts for issue #166's find bars.
 *
 * One spec covers both `FindReplaceOverlay` (PM driver) and
 * `CodeMirrorFindBar` (CM driver):
 *
 *   - "query X has Y matches" — when the engine reports N matches,
 *     `data-testid="*-search-count"` renders the total.
 *   - "current index updates when navigating next" — after click on Next,
 *     the readout shifts from `N matches` to `K of N`.
 *
 * The counters use a 150ms debounce; tests advance fake timers between
 * input changes / clicks and assertions.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Hoisted spies + fakes for prosemirror-search
// ---------------------------------------------------------------------------

const {
  mockGetMatchHighlights,
  mockFindNextPM,
  mockFindPrevPM,
  mockSetSearchState,
  mockGetSearchStatePM,
  mockSearchPluginPM,
} = vi.hoisted(() => ({
  mockGetMatchHighlights: vi.fn(),
  mockFindNextPM: vi.fn(() => true),
  mockFindPrevPM: vi.fn(() => true),
  mockSetSearchState: vi.fn((tr: unknown) => tr),
  mockGetSearchStatePM: vi.fn(() => undefined),
  mockSearchPluginPM: vi.fn(() => ({ _plugin: 'pm-search' })),
}))

vi.mock('prosemirror-search', () => ({
  search: (...args: unknown[]) => mockSearchPluginPM(...args),
  findNext: (...args: unknown[]) => mockFindNextPM(...args),
  findPrev: (...args: unknown[]) => mockFindPrevPM(...args),
  replaceNext: vi.fn(),
  replaceAll: vi.fn(),
  setSearchState: (...args: unknown[]) => mockSetSearchState(...args),
  getSearchState: (...args: unknown[]) => mockGetSearchStatePM(...args),
  getMatchHighlights: (...args: unknown[]) => mockGetMatchHighlights(...args),
  SearchQuery: class {
    readonly search: string
    readonly replace: string
    constructor(cfg: { search: string; replace?: string }) {
      this.search = cfg.search
      this.replace = cfg.replace ?? ''
    }
  },
}))

// ---------------------------------------------------------------------------
// Hoisted spies + fakes for @codemirror/search
// ---------------------------------------------------------------------------

const {
  mockFindNextCM,
  mockFindPreviousCM,
  cmMatchesRef,
  FakeSearchCursor,
} = vi.hoisted(() => {
  const cmMatchesRef = { value: [] as { from: number; to: number }[] }
  class FakeSearchCursor {
    private index = 0
    value: { from: number; to: number } = { from: 0, to: 0 }
    done = false
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_doc: unknown, _query: string) {}
    next() {
      if (this.index >= cmMatchesRef.value.length) {
        this.done = true
        return { value: { from: 0, to: 0 }, done: true }
      }
      this.value = cmMatchesRef.value[this.index]
      this.index += 1
      return { value: this.value, done: false }
    }
  }
  return {
    mockFindNextCM: vi.fn(() => true),
    mockFindPreviousCM: vi.fn(() => true),
    cmMatchesRef,
    FakeSearchCursor,
  }
})

vi.mock('@codemirror/search', () => ({
  SearchCursor: FakeSearchCursor,
  SearchQuery: class {
    readonly search: string
    constructor(cfg: { search: string; replace?: string }) {
      this.search = cfg.search
    }
  },
  findNext: (...args: unknown[]) => mockFindNextCM(...args),
  findPrevious: (...args: unknown[]) => mockFindPreviousCM(...args),
  replaceAll: vi.fn(),
  replaceNext: vi.fn(),
  setSearchQuery: { of: (q: unknown) => ({ _effect: 'setSearchQuery', q }) },
}))

// CodeMirrorFindBar now uses a type-only import of EditorView and drives
// scrolling via a manual `scrollContainer.scrollTo({...})` call inside a
// `requestAnimationFrame`. No runtime mock of @codemirror/view needed.

// ---------------------------------------------------------------------------
// Mock Icon (both bars render it)
// ---------------------------------------------------------------------------

vi.mock('./Icon', () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { FindReplaceOverlay } from '../FindReplaceOverlay'
import { CodeMirrorFindBar } from '../CodeMirrorFindBar'

// ---------------------------------------------------------------------------
// Fake views
// ---------------------------------------------------------------------------

/** Builds a DOM element nested under a `.md-preview` ancestor with a
 * spy-able `scrollTo` and a stable `getBoundingClientRect`. The bar's
 * `scrollSelectionIntoView` walks up via `closest('.md-preview')` to find
 * the scrolling container. */
function makeScrollAncestor(): {
  container: HTMLElement
  editorDom: HTMLElement
  scrollTo: ReturnType<typeof vi.fn>
} {
  const container = document.createElement('div')
  container.className = 'md-preview'
  container.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600 } as DOMRect)
  // jsdom doesn't implement scrollTo; install a spy.
  const scrollTo = vi.fn()
  ;(container as unknown as { scrollTo: typeof scrollTo }).scrollTo = scrollTo
  Object.defineProperty(container, 'scrollTop', {
    value: 0,
    writable: true,
    configurable: true,
  })
  const editorDom = document.createElement('div')
  container.appendChild(editorDom)
  document.body.appendChild(container)
  return { container, editorDom, scrollTo }
}

function makeFakePMView(selFrom = 0, selTo = 0) {
  const { editorDom, scrollTo } = makeScrollAncestor()
  const tr = {
    _isTr: true,
    scrollIntoView: vi.fn(() => tr),
    // Replace flow stamps a meta on the dispatched tr to flash the
    // just-written range. Mock as a chainable no-op.
    setMeta: vi.fn(() => tr),
  }
  return {
    state: {
      selection: { empty: selFrom === selTo, from: selFrom, to: selTo },
      tr,
    },
    dom: editorDom,
    focus: vi.fn(),
    dispatch: vi.fn(),
    coordsAtPos: vi.fn(() => ({ top: 200, left: 0, bottom: 220, right: 100 })),
    _scrollTo: scrollTo,
  }
}

function makeFakeCMView(selFrom = 0, selTo = 0) {
  const { container, scrollTo } = makeScrollAncestor()
  return {
    state: {
      selection: { main: { from: selFrom, to: selFrom === selTo ? selFrom : selTo } },
      doc: { _isDoc: true },
    },
    focus: vi.fn(),
    dispatch: vi.fn(),
    coordsAtPos: vi.fn(() => ({ top: 200, left: 0, bottom: 220, right: 100 })),
    // `view.scrollDOM` is the CM-side overflow container; in our app the
    // shared `.md-preview` ancestor plays the same role, so we reuse it.
    scrollDOM: container,
    _scrollTo: scrollTo,
  }
}

// ---------------------------------------------------------------------------
// Helper: drive the 150ms debounce + flush React state
// ---------------------------------------------------------------------------

async function flushDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(160)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  // The bars schedule scroll measurements inside `requestAnimationFrame`
  // so the PM/CM dispatch lands first. jsdom doesn't drive rAF on a real
  // frame loop, so we run the callback synchronously for deterministic
  // assertions.
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    cb(0)
    return 0 as unknown as number
  })
  mockGetMatchHighlights.mockReset()
  mockFindNextPM.mockClear()
  mockFindPrevPM.mockClear()
  mockSetSearchState.mockClear()
  mockGetSearchStatePM.mockReset().mockReturnValue(undefined)
  mockSearchPluginPM.mockClear()
  mockFindNextCM.mockClear()
  mockFindPreviousCM.mockClear()
  cmMatchesRef.value = []
})

afterEach(() => {
  vi.useRealTimers()
  // Clean up any DOM the scroll-ancestor helper left around.
  document.body.innerHTML = ''
})

// ===========================================================================
// FindReplaceOverlay (Milkdown / PM) — match count
// ===========================================================================

describe('FindReplaceOverlay — match count readout', () => {
  it('shows "Y matches" when the query has Y matches and no current selection', async () => {
    const view = makeFakePMView()
    // Fake DecorationSet.find() return: three matches in the doc.
    mockGetMatchHighlights.mockReturnValue({
      find: () => [
        { from: 10, to: 15 },
        { from: 30, to: 35 },
        { from: 50, to: 55 },
      ],
    })
    const { container } = render(
      <FindReplaceOverlay view={view as never} onClose={vi.fn()} />,
    )
    const input = container.querySelector(
      'input[data-testid="pm-search-input"]',
    ) as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'foo' } })
    })
    await flushDebounce()
    const count = container.querySelector('[data-testid="pm-search-count"]')
    expect(count).not.toBeNull()
    expect(count!.textContent).toBe('3 matches')
  })

  it('shows "K of N" after clicking next selects a match', async () => {
    const matches = [
      { from: 10, to: 15 },
      { from: 30, to: 35 },
      { from: 50, to: 55 },
    ]
    const view = makeFakePMView()
    mockGetMatchHighlights.mockReturnValue({ find: () => matches })
    // Simulate `findNext` walking matches in order: each call advances to
    // the next match (wraps to the first when the current is past the end).
    let nextIdx = 0
    mockFindNextPM.mockImplementation(() => {
      const m = matches[nextIdx % matches.length]
      view.state.selection = { empty: false, from: m.from, to: m.to } as never
      nextIdx += 1
      return true
    })

    const { container, rerender } = render(
      <FindReplaceOverlay view={view as never} onClose={vi.fn()} />,
    )
    const input = container.querySelector(
      'input[data-testid="pm-search-input"]',
    ) as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'foo' } })
    })
    await flushDebounce()
    // Auto-jump on query change moves selection to matches[0] → "1 of 3".
    expect(container.querySelector('[data-testid="pm-search-count"]')!.textContent).toBe(
      '1 of 3',
    )
    // Click Next — advances to matches[1].
    const nextBtn = container.querySelector(
      '[data-testid="pm-search-next"]',
    ) as HTMLElement
    await act(async () => {
      fireEvent.click(nextBtn)
    })
    rerender(<FindReplaceOverlay view={view as never} onClose={vi.fn()} />)
    await flushDebounce()
    expect(container.querySelector('[data-testid="pm-search-count"]')!.textContent).toBe(
      '2 of 3',
    )
  })
})

// ===========================================================================
// CodeMirrorFindBar — match count
// ===========================================================================

describe('CodeMirrorFindBar — match count readout', () => {
  it('shows "Y matches" when SearchCursor reports Y matches', async () => {
    const view = makeFakeCMView()
    cmMatchesRef.value = [
      { from: 5, to: 10 },
      { from: 20, to: 25 },
    ]
    const { container } = render(
      <CodeMirrorFindBar view={view as never} onClose={vi.fn()} />,
    )
    const input = container.querySelector(
      'input[data-testid="cm-search-input"]',
    ) as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'bar' } })
    })
    await flushDebounce()
    const count = container.querySelector('[data-testid="cm-search-count"]')
    expect(count).not.toBeNull()
    expect(count!.textContent).toBe('2 matches')
  })

  it('shows "K of N" after clicking next moves the selection onto a match', async () => {
    cmMatchesRef.value = [
      { from: 5, to: 10 },
      { from: 20, to: 25 },
      { from: 40, to: 45 },
    ]
    const view = makeFakeCMView()
    // Simulate CM advancing the cursor through each match on every call.
    let nextIdx = 0
    mockFindNextCM.mockImplementation(() => {
      if (cmMatchesRef.value.length === 0) return false
      const m = cmMatchesRef.value[nextIdx % cmMatchesRef.value.length]
      view.state.selection = { main: { from: m.from, to: m.to } } as never
      nextIdx += 1
      return true
    })
    const { container, rerender } = render(
      <CodeMirrorFindBar view={view as never} onClose={vi.fn()} />,
    )
    const input = container.querySelector(
      'input[data-testid="cm-search-input"]',
    ) as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'bar' } })
    })
    await flushDebounce()
    // Auto-jump on query change moves selection to matches[0] → "1 of 3".
    expect(container.querySelector('[data-testid="cm-search-count"]')!.textContent).toBe(
      '1 of 3',
    )
    const nextBtn = container.querySelector(
      '[data-testid="cm-search-next"]',
    ) as HTMLElement
    await act(async () => {
      fireEvent.click(nextBtn)
    })
    rerender(<CodeMirrorFindBar view={view as never} onClose={vi.fn()} />)
    await flushDebounce()
    expect(container.querySelector('[data-testid="cm-search-count"]')!.textContent).toBe(
      '2 of 3',
    )
  })
})

// ===========================================================================
// Empty / no-results
// ===========================================================================

describe('match-count edge cases', () => {
  it('PM: empty query → count badge shows "No results" so the slot stays present', async () => {
    const view = makeFakePMView()
    mockGetMatchHighlights.mockReturnValue({ find: () => [] })
    const { container } = render(
      <FindReplaceOverlay view={view as never} onClose={vi.fn()} />,
    )
    await flushDebounce()
    const badge = container.querySelector('[data-testid="pm-search-count"]')
    expect(badge).not.toBeNull()
    expect(badge!.textContent).toBe('No results')
  })

  it('CM: zero matches for non-empty query → "No results"', async () => {
    const view = makeFakeCMView()
    cmMatchesRef.value = []
    const { container } = render(
      <CodeMirrorFindBar view={view as never} onClose={vi.fn()} />,
    )
    const input = container.querySelector(
      'input[data-testid="cm-search-input"]',
    ) as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'xyz' } })
    })
    await flushDebounce()
    expect(container.querySelector('[data-testid="cm-search-count"]')!.textContent).toBe(
      'No results',
    )
  })
})

// ===========================================================================
// scroll-into-view after navigation
// ===========================================================================

describe('find-bar — scroll active match into view', () => {
  it('CM: clicking next calls scrollTo on the overflow ancestor', async () => {
    cmMatchesRef.value = [
      { from: 5, to: 10 },
      { from: 1000, to: 1005 },
    ]
    const view = makeFakeCMView()
    mockFindNextCM.mockImplementation(() => {
      view.state.selection = { main: { from: 1000, to: 1005 } } as never
      return true
    })
    const { container } = render(
      <CodeMirrorFindBar view={view as never} onClose={vi.fn()} />,
    )
    const nextBtn = container.querySelector(
      '[data-testid="cm-search-next"]',
    ) as HTMLElement
    await act(async () => {
      fireEvent.click(nextBtn)
    })
    expect(view._scrollTo).toHaveBeenCalled()
    // Target is `scrollTop + (coordsTop - containerTop) - 80` = 0 + 200 - 80.
    expect(view._scrollTo.mock.calls[0][0]).toMatchObject({
      top: 120,
      behavior: 'smooth',
    })
  })

  it('PM: clicking next calls scrollTo on the overflow ancestor', async () => {
    const matches = [
      { from: 10, to: 15 },
      { from: 2000, to: 2005 },
    ]
    const view = makeFakePMView()
    mockGetMatchHighlights.mockReturnValue({ find: () => matches })
    mockFindNextPM.mockImplementation(() => {
      view.state.selection = { empty: false, from: 2000, to: 2005 } as never
      return true
    })
    const { container } = render(
      <FindReplaceOverlay view={view as never} onClose={vi.fn()} />,
    )
    const nextBtn = container.querySelector(
      '[data-testid="pm-search-next"]',
    ) as HTMLElement
    await act(async () => {
      fireEvent.click(nextBtn)
    })
    expect(view._scrollTo).toHaveBeenCalled()
    expect(view._scrollTo.mock.calls[0][0]).toMatchObject({
      top: 120,
      behavior: 'smooth',
    })
  })

  it('CM: typing a query with matches auto-jumps + scrolls to the first match', async () => {
    cmMatchesRef.value = [
      { from: 50, to: 55 },
      { from: 500, to: 505 },
    ]
    const view = makeFakeCMView()
    mockFindNextCM.mockImplementation(() => {
      view.state.selection = { main: { from: 50, to: 55 } } as never
      return true
    })
    const { container } = render(
      <CodeMirrorFindBar view={view as never} onClose={vi.fn()} />,
    )
    const input = container.querySelector(
      'input[data-testid="cm-search-input"]',
    ) as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'foo' } })
    })
    // Auto-jump fires synchronously inside the query effect — no debounce.
    expect(mockFindNextCM).toHaveBeenCalled()
    expect(view._scrollTo).toHaveBeenCalled()
  })

  it('PM: typing a query with matches auto-jumps + scrolls to the first match', async () => {
    const matches = [{ from: 100, to: 105 }]
    const view = makeFakePMView()
    mockGetMatchHighlights.mockReturnValue({ find: () => matches })
    mockFindNextPM.mockImplementation(() => {
      view.state.selection = { empty: false, from: 100, to: 105 } as never
      return true
    })
    const { container } = render(
      <FindReplaceOverlay view={view as never} onClose={vi.fn()} />,
    )
    const input = container.querySelector(
      'input[data-testid="pm-search-input"]',
    ) as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'bar' } })
    })
    expect(mockFindNextPM).toHaveBeenCalled()
    expect(view._scrollTo).toHaveBeenCalled()
  })

  it('CM: pressing Enter on the find input triggers findNext + scroll', async () => {
    cmMatchesRef.value = [{ from: 10, to: 15 }]
    const view = makeFakeCMView()
    mockFindNextCM.mockImplementation(() => {
      view.state.selection = { main: { from: 10, to: 15 } } as never
      return true
    })
    const { container } = render(
      <CodeMirrorFindBar view={view as never} onClose={vi.fn()} />,
    )
    const input = container.querySelector(
      'input[data-testid="cm-search-input"]',
    ) as HTMLInputElement
    // Set a non-empty query so the auto-jump on change happens first.
    await act(async () => {
      fireEvent.change(input, { target: { value: 'foo' } })
    })
    mockFindNextCM.mockClear()
    view._scrollTo.mockClear()
    // Pressing Enter on the input should drive the same runFindNext path
    // as clicking the next button — including the scroll call.
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(mockFindNextCM).toHaveBeenCalled()
    expect(view._scrollTo).toHaveBeenCalled()
  })

  it('PM: pressing Enter on the find input triggers findNext + scroll', async () => {
    const view = makeFakePMView()
    mockGetMatchHighlights.mockReturnValue({ find: () => [{ from: 10, to: 15 }] })
    mockFindNextPM.mockImplementation(() => {
      view.state.selection = { empty: false, from: 10, to: 15 } as never
      return true
    })
    const { container } = render(
      <FindReplaceOverlay view={view as never} onClose={vi.fn()} />,
    )
    const input = container.querySelector(
      'input[data-testid="pm-search-input"]',
    ) as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'foo' } })
    })
    mockFindNextPM.mockClear()
    view._scrollTo.mockClear()
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(mockFindNextPM).toHaveBeenCalled()
    expect(view._scrollTo).toHaveBeenCalled()
  })
})

// ===========================================================================
// Replace-row toggle (Cmd+F consolidation)
// ===========================================================================

describe('find-bar — replace row toggle', () => {
  beforeEach(() => {
    // Ensure the persisted preference doesn't leak between tests.
    window.localStorage.clear()
  })

  it('PM: replace row is collapsed by default', () => {
    const view = makeFakePMView()
    mockGetMatchHighlights.mockReturnValue({ find: () => [] })
    const { container } = render(
      <FindReplaceOverlay view={view as never} onClose={vi.fn()} />,
    )
    expect(container.querySelector('[data-testid="pm-replace-input"]')).toBeNull()
    expect(container.querySelector('[data-testid="pm-replace-toggle"]')).not.toBeNull()
  })

  it('PM: clicking the toggle expands the replace row', async () => {
    const view = makeFakePMView()
    mockGetMatchHighlights.mockReturnValue({ find: () => [] })
    const { container } = render(
      <FindReplaceOverlay view={view as never} onClose={vi.fn()} />,
    )
    const toggle = container.querySelector(
      '[data-testid="pm-replace-toggle"]',
    ) as HTMLElement
    await act(async () => {
      fireEvent.click(toggle)
    })
    expect(container.querySelector('[data-testid="pm-replace-input"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="pm-replace-next"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="pm-replace-all"]')).not.toBeNull()
  })

  it('PM: initialReplaceExpanded=true mounts with the replace row open', () => {
    const view = makeFakePMView()
    mockGetMatchHighlights.mockReturnValue({ find: () => [] })
    const { container } = render(
      <FindReplaceOverlay
        view={view as never}
        onClose={vi.fn()}
        initialReplaceExpanded
      />,
    )
    expect(container.querySelector('[data-testid="pm-replace-input"]')).not.toBeNull()
  })

  it('PM: toggle persists the choice via localStorage', async () => {
    const view = makeFakePMView()
    mockGetMatchHighlights.mockReturnValue({ find: () => [] })
    const { container } = render(
      <FindReplaceOverlay view={view as never} onClose={vi.fn()} />,
    )
    const toggle = container.querySelector(
      '[data-testid="pm-replace-toggle"]',
    ) as HTMLElement
    await act(async () => {
      fireEvent.click(toggle)
    })
    expect(window.localStorage.getItem('marvin:find-bar:replace-expanded')).toBe('1')
  })

  it('CM: replace row is collapsed by default', () => {
    const view = makeFakeCMView()
    const { container } = render(
      <CodeMirrorFindBar view={view as never} onClose={vi.fn()} />,
    )
    expect(container.querySelector('[data-testid="cm-replace-input"]')).toBeNull()
    expect(container.querySelector('[data-testid="cm-replace-toggle"]')).not.toBeNull()
  })

  it('CM: clicking the toggle expands the replace row', async () => {
    const view = makeFakeCMView()
    const { container } = render(
      <CodeMirrorFindBar view={view as never} onClose={vi.fn()} />,
    )
    const toggle = container.querySelector(
      '[data-testid="cm-replace-toggle"]',
    ) as HTMLElement
    await act(async () => {
      fireEvent.click(toggle)
    })
    expect(container.querySelector('[data-testid="cm-replace-input"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="cm-replace-next"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="cm-replace-all"]')).not.toBeNull()
  })

  it('CM: reading "1" from localStorage opens replace row on mount', () => {
    window.localStorage.setItem('marvin:find-bar:replace-expanded', '1')
    const view = makeFakeCMView()
    const { container } = render(
      <CodeMirrorFindBar view={view as never} onClose={vi.fn()} />,
    )
    expect(container.querySelector('[data-testid="cm-replace-input"]')).not.toBeNull()
  })
})

// ===========================================================================
// Notion-style polish: toggle highlight + secondary row affordances
// ===========================================================================

describe('find-bar — replace toggle visual state', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('PM: toggle gains md-find-toggle--active class when expanded', async () => {
    const view = makeFakePMView()
    mockGetMatchHighlights.mockReturnValue({ find: () => [] })
    const { container } = render(
      <FindReplaceOverlay view={view as never} onClose={vi.fn()} />,
    )
    const toggle = container.querySelector(
      '[data-testid="pm-replace-toggle"]',
    ) as HTMLElement
    expect(toggle.className).not.toContain('md-find-toggle--active')
    await act(async () => {
      fireEvent.click(toggle)
    })
    expect(toggle.className).toContain('md-find-toggle--active')
  })

  it('CM: toggle gains md-find-toggle--active class when expanded', async () => {
    const view = makeFakeCMView()
    const { container } = render(
      <CodeMirrorFindBar view={view as never} onClose={vi.fn()} />,
    )
    const toggle = container.querySelector(
      '[data-testid="cm-replace-toggle"]',
    ) as HTMLElement
    expect(toggle.className).not.toContain('md-find-toggle--active')
    await act(async () => {
      fireEvent.click(toggle)
    })
    expect(toggle.className).toContain('md-find-toggle--active')
  })

  it('PM: replace row carries the divider modifier class when expanded', () => {
    const view = makeFakePMView()
    mockGetMatchHighlights.mockReturnValue({ find: () => [] })
    const { container } = render(
      <FindReplaceOverlay view={view as never} onClose={vi.fn()} initialReplaceExpanded />,
    )
    const replaceRow = container.querySelector('.md-find-row--replace')
    expect(replaceRow).not.toBeNull()
    // Replace All is a ghost button and Replace is the primary action.
    expect(
      container
        .querySelector('[data-testid="pm-replace-all"]')!
        .className.split(/\s+/),
    ).toContain('icon-btn')
    expect(
      container
        .querySelector('[data-testid="pm-replace-next"]')!
        .className.split(/\s+/),
    ).toContain('icon-btn')
  })

  it('CM: replace row carries the divider modifier class when expanded', () => {
    const view = makeFakeCMView()
    const { container } = render(
      <CodeMirrorFindBar view={view as never} onClose={vi.fn()} initialReplaceExpanded />,
    )
    expect(container.querySelector('.md-find-row--replace')).not.toBeNull()
    expect(
      container
        .querySelector('[data-testid="cm-replace-all"]')!
        .className.split(/\s+/),
    ).toContain('icon-btn')
    expect(
      container
        .querySelector('[data-testid="cm-replace-next"]')!
        .className.split(/\s+/),
    ).toContain('icon-btn')
  })
})
