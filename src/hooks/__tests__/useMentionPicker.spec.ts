// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Capture the callbacks the hook hands to the (mocked) mentionTrigger so tests
// can drive the open/update/close lifecycle without a real CodeMirror surface.
let captured: {
  onOpen: (from: number, anchor: { x: number; y: number }) => void
  onUpdate: (query: string, anchor: { x: number; y: number }) => void
  onClose: () => void
} | null = null

vi.mock('../../lib/cmMentionTrigger', () => ({
  mentionTrigger: (cbs: typeof captured) => {
    captured = cbs
    return { __ext: 'mention' }
  },
}))
vi.mock('../../lib/mentionInsert', () => ({
  mentionInsertText: () => '[[Note]]',
}))

import { useMentionPicker } from '../useMentionPicker'
import type { PaletteItem } from '../../lib/paletteRanker'

function makeView() {
  return {
    state: { selection: { main: { head: 10 } } },
    dispatch: vi.fn(),
    focus: vi.fn(),
  } as never
}

describe('useMentionPicker (#590)', () => {
  it('mentionTrigger callbacks drive the mention state through its lifecycle', () => {
    const { result } = renderHook(() =>
      useMentionPicker({ filePath: '/v/n.md', viewRef: { current: null } })
    )
    expect(result.current.mention).toBeNull()

    act(() => captured!.onOpen(3, { x: 1, y: 2 }))
    expect(result.current.mention).toEqual({ from: 3, query: '', anchor: { x: 1, y: 2 } })

    act(() => captured!.onUpdate('foo', { x: 5, y: 6 }))
    expect(result.current.mention).toMatchObject({ from: 3, query: 'foo', anchor: { x: 5, y: 6 } })

    act(() => captured!.onClose())
    expect(result.current.mention).toBeNull()
  })

  it('handleMentionSelect dispatches the insert over the @-span and clears the mention', () => {
    const view = makeView()
    const { result } = renderHook(() =>
      useMentionPicker({ filePath: '/v/n.md', viewRef: { current: view } })
    )

    act(() => captured!.onOpen(3, { x: 0, y: 0 }))
    act(() => result.current.handleMentionSelect({} as PaletteItem))

    expect(
      (view as unknown as { dispatch: ReturnType<typeof vi.fn> }).dispatch
    ).toHaveBeenCalledWith(
      expect.objectContaining({ changes: { from: 3, to: 10, insert: '[[Note]]' } })
    )
    expect((view as unknown as { focus: ReturnType<typeof vi.fn> }).focus).toHaveBeenCalled()
    expect(result.current.mention).toBeNull()
  })

  it('handleMentionSelect is a no-op (just clears) when there is no live view', () => {
    const { result } = renderHook(() =>
      useMentionPicker({ filePath: '/v/n.md', viewRef: { current: null } })
    )
    act(() => captured!.onOpen(3, { x: 0, y: 0 }))
    act(() => result.current.handleMentionSelect({} as PaletteItem))
    expect(result.current.mention).toBeNull()
  })

  it('mentionExt is stable across rerenders so the CodeMirror state is never torn down', () => {
    const viewRef = { current: null }
    const { result, rerender } = renderHook((props) => useMentionPicker(props), {
      initialProps: { filePath: '/v/n.md', viewRef },
    })
    const first = result.current.mentionExt
    rerender({ filePath: '/v/other.md', viewRef })
    expect(result.current.mentionExt).toBe(first)
  })
})
