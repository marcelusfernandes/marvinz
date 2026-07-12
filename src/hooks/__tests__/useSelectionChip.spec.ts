// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSelectionChip, buildSelectionPrefix, findSelectionLineRange } from '../useSelectionChip'

// ---------------------------------------------------------------------------
// Shared tail — the prefix builder is the single spot where a naive
// unification could silently diverge, so both range-present and range-null
// cases are pinned across both agent kinds.
// ---------------------------------------------------------------------------

describe('buildSelectionPrefix (#587)', () => {
  it('codex + range → @path:range', () => {
    expect(buildSelectionPrefix('/v/n.md', '3-5', 'codex')).toBe('@/v/n.md:3-5')
  })
  it('non-codex + range → path:range (no @)', () => {
    expect(buildSelectionPrefix('/v/n.md', '3-5', 'claude-code')).toBe('/v/n.md:3-5')
  })
  it('codex + null range → @path (no colon)', () => {
    expect(buildSelectionPrefix('/v/n.md', null, 'codex')).toBe('@/v/n.md')
  })
  it('non-codex + null range → path (no @, no colon)', () => {
    expect(buildSelectionPrefix('/v/n.md', null, 'claude-code')).toBe('/v/n.md')
  })
})

describe('findSelectionLineRange (#587)', () => {
  it('unambiguous single-line match → "N"', () => {
    expect(findSelectionLineRange('hello', 'foo\nhello\nbar')).toBe('2')
  })
  it('unambiguous multi-line match → "N-M"', () => {
    expect(findSelectionLineRange('a\nb', 'x\na\nb\ny')).toBe('2-3')
  })
  it('ambiguous (repeated) match → null', () => {
    expect(findSelectionLineRange('dup', 'dup\ndup')).toBeNull()
  })
  it('no match → null', () => {
    expect(findSelectionLineRange('zzz', 'abc')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// CodeMirror position source
// ---------------------------------------------------------------------------

function makeCmView(opts: { text?: string; fromLine?: number; toLine?: number } = {}) {
  const { text = 'selected', fromLine = 3, toLine = 3 } = opts
  let call = 0
  return {
    coordsAtPos: vi.fn(() => ({ left: 10, right: 20, top: 30, bottom: 40 })),
    scrollDOM: document.createElement('div'),
    state: {
      sliceDoc: vi.fn(() => text),
      doc: {
        lineAt: vi.fn(() => ({ number: call++ === 0 ? fromLine : toLine })),
      },
    },
  } as never
}

describe('useSelectionChip — codemirror source', () => {
  it('onCmSelectionChange derives chip coords + offsets from a non-empty selection', () => {
    const viewRef = { current: null }
    const { result } = renderHook(() =>
      useSelectionChip({
        source: { kind: 'codemirror', viewRef, isActive: true },
        filePath: '/v/n.md',
        agentKind: 'codex',
        onSendSelection: vi.fn(),
      })
    )
    act(() =>
      result.current.onCmSelectionChange({
        selectionSet: true,
        view: makeCmView(),
        state: { selection: { main: { from: 2, to: 8, empty: false } } },
      })
    )
    expect(result.current.chip).toMatchObject({ from: 2, to: 8 })
    expect(result.current.chip?.coords).toMatchObject({ left: 10, right: 20 })
  })

  it('an empty selection clears the chip', () => {
    const viewRef = { current: null }
    const { result } = renderHook(() =>
      useSelectionChip({
        source: { kind: 'codemirror', viewRef, isActive: true },
        filePath: '/v/n.md',
        onSendSelection: vi.fn(),
      })
    )
    act(() =>
      result.current.onCmSelectionChange({
        selectionSet: true,
        view: makeCmView(),
        state: { selection: { main: { from: 5, to: 5, empty: true } } },
      })
    )
    expect(result.current.chip).toBeNull()
  })

  it('handleChipClick sends the @path:line prefix (single line) with the sliced text', () => {
    const onSend = vi.fn()
    const viewRef = { current: null }
    const { result } = renderHook(() =>
      useSelectionChip({
        source: { kind: 'codemirror', viewRef, isActive: true },
        filePath: '/v/n.md',
        agentKind: 'codex',
        onSendSelection: onSend,
      })
    )
    act(() =>
      result.current.onCmSelectionChange({
        selectionSet: true,
        view: makeCmView({ fromLine: 3, toLine: 3 }),
        state: { selection: { main: { from: 2, to: 8, empty: false } } },
      })
    )
    act(() => result.current.handleChipClick())
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend.mock.calls[0][0]).toMatch(/^@\/v\/n\.md:3\n\n/)
  })

  it('handleChipClick emits an N-M range when the selection spans lines', () => {
    const onSend = vi.fn()
    const viewRef = { current: null }
    const { result } = renderHook(() =>
      useSelectionChip({
        source: { kind: 'codemirror', viewRef, isActive: true },
        filePath: '/v/n.md',
        agentKind: 'codex',
        onSendSelection: onSend,
      })
    )
    act(() =>
      result.current.onCmSelectionChange({
        selectionSet: true,
        view: makeCmView({ fromLine: 3, toLine: 5 }),
        state: { selection: { main: { from: 2, to: 40, empty: false } } },
      })
    )
    act(() => result.current.handleChipClick())
    expect(onSend.mock.calls[0][0]).toMatch(/^@\/v\/n\.md:3-5\n\n/)
  })
})

// ---------------------------------------------------------------------------
// DOM position source
// ---------------------------------------------------------------------------

function mockDomSelection(text: string, anchorNode: Node) {
  const fakeRange = {
    getClientRects: () => [
      { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 } as DOMRect,
      { left: 5, right: 15, top: 25, bottom: 35, width: 10, height: 10 } as DOMRect,
    ],
    getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 50 }) as DOMRect,
  }
  vi.spyOn(window, 'getSelection').mockReturnValue({
    rangeCount: 1,
    toString: () => text,
    anchorNode,
    getRangeAt: () => fakeRange,
  } as never)
}

describe('useSelectionChip — dom source', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('selectionchange picks the last non-empty client rect after the 50ms debounce', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const textNode = document.createTextNode('hello world')
    container.appendChild(textNode)
    mockDomSelection('hello', textNode)

    const { result } = renderHook(() =>
      useSelectionChip({
        source: { kind: 'dom', containerRef: { current: container }, body: 'hello world' },
        filePath: '/v/n.md',
        agentKind: 'codex',
        onSendSelection: vi.fn(),
      })
    )

    act(() => {
      document.dispatchEvent(new Event('selectionchange'))
      vi.advanceTimersByTime(50)
    })
    // The zero-width caret rect is skipped; the trailing non-empty rect wins.
    expect(result.current.chip?.coords).toMatchObject({ left: 5, right: 15 })
  })

  it('handleChipClick with a matchable selection sends @path:range (best-effort range)', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const textNode = document.createTextNode('foo hello bar')
    container.appendChild(textNode)
    const onSend = vi.fn()
    mockDomSelection('hello', textNode)

    const { result } = renderHook(() =>
      useSelectionChip({
        source: { kind: 'dom', containerRef: { current: container }, body: 'x\nhello\ny' },
        filePath: '/v/n.md',
        agentKind: 'codex',
        onSendSelection: onSend,
      })
    )
    act(() => result.current.handleChipClick())
    expect(onSend.mock.calls[0][0]).toMatch(/^@\/v\/n\.md:2\n\n/)
  })

  it('handleChipClick with an unmatchable selection sends @path with no range', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const textNode = document.createTextNode('anything')
    container.appendChild(textNode)
    const onSend = vi.fn()
    // Ambiguous match → findSelectionLineRange returns null → prefix drops the range.
    mockDomSelection('dup', textNode)

    const { result } = renderHook(() =>
      useSelectionChip({
        source: { kind: 'dom', containerRef: { current: container }, body: 'dup\ndup' },
        filePath: '/v/n.md',
        agentKind: 'codex',
        onSendSelection: onSend,
      })
    )
    act(() => result.current.handleChipClick())
    expect(onSend.mock.calls[0][0]).toMatch(/^@\/v\/n\.md\n\n/)
    expect(onSend.mock.calls[0][0]).not.toContain(':')
  })
})
