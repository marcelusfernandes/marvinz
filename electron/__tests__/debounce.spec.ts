import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { debounce } from '../debounce.js'

describe('debounce — trailing-edge coalescing (#571)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not call the underlying fn before the wait elapses', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 200)

    debounced()
    vi.advanceTimersByTime(199)

    expect(fn).not.toHaveBeenCalled()
  })

  it('calls the underlying fn once the wait elapses', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 200)

    debounced()
    vi.advanceTimersByTime(200)

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('collapses a burst of calls within the window into a single call', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 200)

    // Simulate a burst of 100 structural fs events spread across the window,
    // each one resetting the trailing-edge timer (e.g. a `git checkout`).
    for (let i = 0; i < 100; i++) {
      debounced()
      vi.advanceTimersByTime(10) // 10ms apart, well under the 200ms window
    }
    expect(fn).not.toHaveBeenCalled()

    // Burst settles — the last reset timer now has room to fire.
    vi.advanceTimersByTime(200)

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('fires with the arguments of the last call in the burst (last-event-wins)', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 200)

    debounced('first')
    vi.advanceTimersByTime(50)
    debounced('second')
    vi.advanceTimersByTime(50)
    debounced('third')
    vi.advanceTimersByTime(200)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('third')
  })

  it('a single isolated call still fires within the debounce window', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 200)

    debounced()
    vi.advanceTimersByTime(200)

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('can fire again on a later, separate burst after settling', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 200)

    debounced()
    vi.advanceTimersByTime(200)
    expect(fn).toHaveBeenCalledTimes(1)

    debounced()
    vi.advanceTimersByTime(200)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('cancel() prevents a pending call from firing', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 200)

    debounced()
    vi.advanceTimersByTime(100)
    debounced.cancel()
    vi.advanceTimersByTime(200)

    expect(fn).not.toHaveBeenCalled()
  })

  it('cancel() is a no-op when nothing is pending', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 200)

    expect(() => debounced.cancel()).not.toThrow()
    expect(fn).not.toHaveBeenCalled()
  })
})
