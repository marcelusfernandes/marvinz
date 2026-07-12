// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFindReplaceState } from '../useFindReplaceState'

describe('useFindReplaceState (#587)', () => {
  it('openFind/closeFind toggle findOpen and forceReplace', () => {
    const { result } = renderHook(() => useFindReplaceState({ isActive: true }))

    expect(result.current.findOpen).toBe(false)
    expect(result.current.forceReplace).toBe(false)

    act(() => result.current.openFind('find'))
    expect(result.current.findOpen).toBe(true)
    expect(result.current.forceReplace).toBe(false)

    act(() => result.current.openFind('replace'))
    expect(result.current.findOpen).toBe(true)
    expect(result.current.forceReplace).toBe(true)

    act(() => result.current.closeFind())
    expect(result.current.findOpen).toBe(false)
    expect(result.current.forceReplace).toBe(false)
  })

  it('openFindTick opens the find bar when active', () => {
    const { result, rerender } = renderHook(
      ({ tick }) => useFindReplaceState({ openFindTick: tick, isActive: true }),
      { initialProps: { tick: 0 } }
    )
    expect(result.current.findOpen).toBe(false)

    rerender({ tick: 1 })
    expect(result.current.findOpen).toBe(true)
    expect(result.current.forceReplace).toBe(false)
  })

  it('openReplaceTick opens the bar with the Replace row forced', () => {
    const { result, rerender } = renderHook(
      ({ tick }) => useFindReplaceState({ openReplaceTick: tick, isActive: true }),
      { initialProps: { tick: 0 } }
    )

    rerender({ tick: 1 })
    expect(result.current.findOpen).toBe(true)
    expect(result.current.forceReplace).toBe(true)
  })

  it('an inactive editor consumes the tick without opening, and does not replay it on reactivation', () => {
    const { result, rerender } = renderHook(
      ({ tick, isActive }) => useFindReplaceState({ openFindTick: tick, isActive }),
      { initialProps: { tick: 0, isActive: false } }
    )

    // Tick fires while hidden — consumed (ref advances), bar stays closed.
    rerender({ tick: 1, isActive: false })
    expect(result.current.findOpen).toBe(false)

    // Reactivating with the SAME tick value must not replay the open.
    rerender({ tick: 1, isActive: true })
    expect(result.current.findOpen).toBe(false)

    // A genuinely new tick while active still opens.
    rerender({ tick: 2, isActive: true })
    expect(result.current.findOpen).toBe(true)
  })

  it('setPmView / setCmView expose the view references', () => {
    const { result } = renderHook(() => useFindReplaceState({ isActive: true }))
    expect(result.current.pmView).toBeNull()
    expect(result.current.cmView).toBeNull()

    const fakePm = { id: 'pm' } as never
    const fakeCm = { id: 'cm' } as never
    act(() => {
      result.current.setPmView(fakePm)
      result.current.setCmView(fakeCm)
    })
    expect(result.current.pmView).toBe(fakePm)
    expect(result.current.cmView).toBe(fakeCm)
  })

  describe('replace toast lifecycle', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('handleReplaced drives enter → leave (2s) → null (200ms)', () => {
      const { result } = renderHook(() => useFindReplaceState({ isActive: true }))

      act(() => result.current.handleReplaced(3))
      expect(result.current.replaceToast).toMatchObject({ count: 3, phase: 'enter' })

      act(() => vi.advanceTimersByTime(2000))
      expect(result.current.replaceToast).toMatchObject({ count: 3, phase: 'leave' })

      act(() => vi.advanceTimersByTime(200))
      expect(result.current.replaceToast).toBeNull()
    })

    it('a fresh replacement during the leave phase restarts the enter animation with a new nonce', () => {
      const { result } = renderHook(() => useFindReplaceState({ isActive: true }))

      act(() => result.current.handleReplaced(1))
      const firstNonce = result.current.replaceToast?.nonce
      act(() => vi.advanceTimersByTime(2000))
      expect(result.current.replaceToast?.phase).toBe('leave')

      act(() => result.current.handleReplaced(2))
      expect(result.current.replaceToast).toMatchObject({ count: 2, phase: 'enter' })
      expect(result.current.replaceToast?.nonce).not.toBe(firstNonce)
    })
  })
})
