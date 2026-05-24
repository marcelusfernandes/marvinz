// @vitest-environment jsdom

/**
 * TDD UI tests for CommandPalette content-search mode (issue #230).
 *
 * Tests are RED until the React implementation is done. They document
 * the expected UI behaviour:
 *   - "Content matches" section header appears when content hits arrive
 *   - Each hit renders "filename  L<n>"
 *   - Loading indicator appears while IPC is pending
 *   - Fallback message appears when rg is unavailable
 *   - Filename search is unaffected (no regression)
 *   - Generation counter: stale responses do not update the UI
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { CommandPalette } from '../CommandPalette'
import type { PaletteItem } from '../CommandPalette'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../Icon', () => ({ Icon: () => null }))
vi.mock('../MaterialIcon', () => ({ MaterialIcon: () => null }))
vi.mock('../HighlightedMatch', () => ({
  HighlightedMatch: ({ text }: { text: string }) => <span>{text}</span>,
}))
vi.mock('../../lib/settingsStore', () => ({
  useSetting: () => 'codicon',
}))

// marvin API stub — each test controls search.content resolution
const mockSearchContent = vi.fn()

vi.mock('../../lib/marvinApi', () => ({
  marvin: {
    search: {
      content: (...args: unknown[]) => mockSearchContent(...args),
    },
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
  // shouldAdvanceTime keeps `waitFor`'s real-timer polling alive while still
  // letting `vi.advanceTimersByTime()` drive the 200ms debounce deterministically.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  mockSearchContent.mockReset()
})

afterEach(() => {
  vi.runAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function paletteItem(rel: string, isMarkdown = true): PaletteItem {
  return { path: `/vault/${rel}`, rel, name: rel.split('/').pop()!, isMarkdown }
}

const ITEMS: PaletteItem[] = [
  paletteItem('alpha.md'),
  paletteItem('beta.md'),
  paletteItem('gamma.md'),
]

const noop = () => {}

type ContentHit = {
  path: string; rel: string; name: string; line: number
  lineText: string; matchRanges: Array<{ start: number; end: number }>
}

function makeHit(name: string, line: number, lineText = ''): ContentHit {
  return { path: `/vault/${name}`, rel: name, name, line, lineText, matchRanges: [] }
}

// Advance fake timers past debounce and flush all pending microtasks/promises.
async function advanceDebounce(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250)
  })
}

// ---------------------------------------------------------------------------
// Content matches section — renders when hits arrive
// ---------------------------------------------------------------------------

describe('CommandPalette — content search: "Content matches" section', () => {
  it('renders "Content matches" section header after debounce when IPC returns hits', async () => {
    mockSearchContent.mockResolvedValue([makeHit('meeting-notes.md', 42)])

    const { queryByText } = render(
      <CommandPalette items={ITEMS} onPick={noop} onClose={noop} />,
    )

    const input = document.querySelector('.palette-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'docker' } })

    // Before debounce: no content section yet
    expect(queryByText(/Content matches/)).toBeNull()

    await advanceDebounce()

    expect(queryByText(/Content matches/)).toBeTruthy()
  })

  it('does NOT render "Content matches" section when query is empty', () => {
    const { queryByText } = render(
      <CommandPalette items={ITEMS} onPick={noop} onClose={noop} />,
    )
    expect(queryByText(/Content matches/)).toBeNull()
  })

  it('does NOT render "Content matches" section when query length is 1', async () => {
    const { queryByText } = render(
      <CommandPalette items={ITEMS} onPick={noop} onClose={noop} />,
    )
    const input = document.querySelector('.palette-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'd' } })

    await advanceDebounce()

    expect(queryByText(/Content matches/)).toBeNull()
    expect(mockSearchContent).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Hit rendering — "filename  L<n>"
// ---------------------------------------------------------------------------

describe('CommandPalette — content search: hit item rendering', () => {
  it('renders content hit with filename and line number', async () => {
    mockSearchContent.mockResolvedValue([makeHit('meeting-notes.md', 42)])

    const { queryByText } = render(
      <CommandPalette items={ITEMS} onPick={noop} onClose={noop} />,
    )
    const input = document.querySelector('.palette-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'docker' } })

    await advanceDebounce()

    expect(queryByText('meeting-notes.md')).toBeTruthy()
    expect(queryByText(/L42/)).toBeTruthy()
  })

  it('renders multiple content hits', async () => {
    mockSearchContent.mockResolvedValue([
      makeHit('note-a.md', 3),
      makeHit('note-b.md', 7),
    ])

    const { queryByText } = render(
      <CommandPalette items={ITEMS} onPick={noop} onClose={noop} />,
    )
    const input = document.querySelector('.palette-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'query' } })

    await advanceDebounce()

    expect(queryByText('note-a.md')).toBeTruthy()
    expect(queryByText(/L3/)).toBeTruthy()
    expect(queryByText('note-b.md')).toBeTruthy()
    expect(queryByText(/L7/)).toBeTruthy()
  })

  it('omits "Content matches" section when IPC returns empty array', async () => {
    mockSearchContent.mockResolvedValue([])

    const { queryByText } = render(
      <CommandPalette items={ITEMS} onPick={noop} onClose={noop} />,
    )
    const input = document.querySelector('.palette-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'nomatch' } })

    await advanceDebounce()

    expect(mockSearchContent).toHaveBeenCalled()
    expect(queryByText(/Content matches/)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// lineText — 2-line hit rendering
// ---------------------------------------------------------------------------

describe('CommandPalette — content search: lineText rendering', () => {
  it('renders lineText below the filename in the hit row', async () => {
    mockSearchContent.mockResolvedValue([
      makeHit('meeting-notes.md', 42, 'docker compose up to start services'),
    ])

    const { queryByText } = render(
      <CommandPalette items={ITEMS} onPick={noop} onClose={noop} />,
    )
    const input = document.querySelector('.palette-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'docker' } })

    await advanceDebounce()

    expect(queryByText('docker compose up to start services')).toBeTruthy()
  })

  it('renders lineText in the DOM for each hit independently', async () => {
    mockSearchContent.mockResolvedValue([
      makeHit('note-a.md', 3, 'function foo() { /* hello */ }'),
      makeHit('note-b.md', 7, 'const x = 1'),
    ])

    const { queryByText } = render(
      <CommandPalette items={ITEMS} onPick={noop} onClose={noop} />,
    )
    const input = document.querySelector('.palette-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'hello' } })

    await advanceDebounce()

    expect(queryByText('function foo() { /* hello */ }')).toBeTruthy()
    expect(queryByText('const x = 1')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// matchRanges — <mark> highlight rendering
// ---------------------------------------------------------------------------

describe('CommandPalette — content search: matchRanges passed to snippet renderer', () => {
  it('passes correct indices to HighlightedMatch for a single range', async () => {
    // lineText = "greetings hello world", match at [10, 15] → indices [10,11,12,13,14]
    const ranges = [{ start: 10, end: 15 }]
    mockSearchContent.mockResolvedValue([
      { ...makeHit('single.md', 3, 'greetings hello world'), matchRanges: ranges },
    ])

    const { queryByText, container } = render(
      <CommandPalette items={ITEMS} onPick={noop} onClose={noop} />,
    )
    const input = container.querySelector('.palette-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'hello' } })

    await advanceDebounce()

    expect(queryByText('greetings hello world')).toBeTruthy()
    expect(container.querySelector('.palette-row-line2')).toBeTruthy()
  })

  it('passes indices for multiple ranges to HighlightedMatch', async () => {
    // lineText = "hello world hello again", two ranges → 10 highlighted chars
    const ranges = [{ start: 0, end: 5 }, { start: 12, end: 17 }]
    mockSearchContent.mockResolvedValue([
      {
        ...makeHit('multi.md', 3, 'hello world hello again'),
        matchRanges: ranges,
      },
    ])

    const { queryByText, container } = render(
      <CommandPalette items={ITEMS} onPick={noop} onClose={noop} />,
    )
    const input = container.querySelector('.palette-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'hello' } })

    await advanceDebounce()

    expect(queryByText('hello world hello again')).toBeTruthy()
    expect(container.querySelector('.palette-row-line2')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Loading indicator
// ---------------------------------------------------------------------------

describe('CommandPalette — content search: loading indicator', () => {
  it('shows a loading indicator while IPC is pending after debounce', async () => {
    let resolveSearch!: (v: ContentHit[]) => void
    mockSearchContent.mockReturnValue(
      new Promise<ContentHit[]>((res) => {
        resolveSearch = res
      }),
    )

    const { queryByTestId } = render(
      <CommandPalette items={ITEMS} onPick={noop} onClose={noop} />,
    )
    const input = document.querySelector('.palette-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'docker' } })

    // Advance past debounce — IPC fires but hasn't resolved yet
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })

    // Loading indicator must appear after debounce fires
    expect(queryByTestId('content-search-loading')).toBeTruthy()

    // Resolve search and flush microtasks
    await act(async () => {
      resolveSearch([])
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(queryByTestId('content-search-loading')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Fallback message — rg unavailable
// ---------------------------------------------------------------------------

describe('CommandPalette — content search: rg unavailable fallback', () => {
  it('shows ripgrep install message when IPC returns { unavailable: true }', async () => {
    mockSearchContent.mockResolvedValue({ unavailable: true })

    render(<CommandPalette items={ITEMS} onPick={noop} onClose={noop} />)
    const input = document.querySelector('.palette-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'docker' } })

    await advanceDebounce()

    expect(document.body.textContent).toMatch(/ripgrep/i)
  })
})

// ---------------------------------------------------------------------------
// Filename search unaffected (no regression)
// ---------------------------------------------------------------------------

describe('CommandPalette — content search: filename search regression guard', () => {
  it('filename results still render instantly (before debounce)', () => {
    mockSearchContent.mockResolvedValue([])

    const { queryByText } = render(
      <CommandPalette items={ITEMS} onPick={noop} onClose={noop} />,
    )
    const input = document.querySelector('.palette-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'alpha' } })

    // No timer advance — filename results must be synchronous
    expect(queryByText('alpha.md')).toBeTruthy()
  })

  it('filename section header "Notes" appears before content section', async () => {
    mockSearchContent.mockResolvedValue([makeHit('alpha.md', 1)])

    const { queryByText } = render(
      <CommandPalette items={ITEMS} onPick={noop} onClose={noop} />,
    )
    const input = document.querySelector('.palette-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'alpha' } })

    await advanceDebounce()

    expect(queryByText(/^Notes/)).toBeTruthy()
    expect(queryByText(/Content matches/)).toBeTruthy()

    const allHeaders = document.querySelectorAll('.palette-section-header')
    const headerTexts = Array.from(allHeaders).map((h) => h.textContent ?? '')
    const notesIdx = headerTexts.findIndex((t) => /^Notes/.test(t))
    const contentIdx = headerTexts.findIndex((t) => /Content matches/.test(t))
    expect(notesIdx).toBeGreaterThanOrEqual(0)
    expect(contentIdx).toBeGreaterThan(notesIdx)
  })
})

// ---------------------------------------------------------------------------
// Generation counter — stale IPC response discarded
// ---------------------------------------------------------------------------

describe('CommandPalette — content search: generation counter (stale response discarded)', () => {
  it('does not update UI with result from a previous (stale) query', async () => {
    let resolveFirst!: (v: ContentHit[]) => void
    const firstSearch = new Promise<ContentHit[]>((res) => {
      resolveFirst = res
    })
    mockSearchContent
      .mockReturnValueOnce(firstSearch)
      .mockResolvedValue([makeHit('second-result.md', 1)])

    const { queryByText } = render(
      <CommandPalette items={ITEMS} onPick={noop} onClose={noop} />,
    )
    const input = document.querySelector('.palette-input') as HTMLInputElement

    // First query — triggers search but don't resolve yet
    fireEvent.change(input, { target: { value: 'first' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(250) })

    // Second query — supersedes first; debounce restarts
    fireEvent.change(input, { target: { value: 'second' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(250) })

    // Second resolved — result should be visible
    expect(queryByText('second-result.md')).toBeTruthy()

    // Now resolve the first (stale) search with a conflicting result
    await act(async () => {
      resolveFirst([makeHit('stale-result.md', 99)])
      await vi.advanceTimersByTimeAsync(0)
    })

    // Stale result must NOT appear
    expect(queryByText('stale-result.md')).toBeNull()
  })
})
