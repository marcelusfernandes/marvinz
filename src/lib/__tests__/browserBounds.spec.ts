import { describe, it, expect } from 'vitest'
import { computeViewBounds } from '../browserBounds'

function elWithRect(rect: Partial<DOMRect>): HTMLElement {
  return {
    getBoundingClientRect: () =>
      ({ left: 0, top: 0, width: 0, height: 0, ...rect }) as DOMRect,
  } as unknown as HTMLElement
}

describe('computeViewBounds', () => {
  it('returns null for a null element', () => {
    expect(computeViewBounds(null)).toBeNull()
  })

  it('returns the rect rounded, with no scale factor applied', () => {
    const el = elWithRect({ left: 100, top: 50, width: 800, height: 600 })
    expect(computeViewBounds(el)).toEqual({ x: 100, y: 50, width: 800, height: 600 })
  })

  it('returns raw rect values — no outer/inner scaling (regression #250)', () => {
    // The regression multiplied the rect by window.outerWidth/innerWidth. The
    // fix reads ONLY getBoundingClientRect and applies no factor, so the output
    // equals the rect regardless of any window zoom/chrome ratio. (This file
    // also runs under the node test project, where `window` is undefined —
    // proving computeViewBounds does not touch window at all.)
    const el = elWithRect({ left: 100, top: 0, width: 400, height: 300 })
    // Old buggy code with outer/inner=1200/800 would have produced x=150, w=600.
    expect(computeViewBounds(el)).toEqual({ x: 100, y: 0, width: 400, height: 300 })
  })

  it('rounds fractional rect values', () => {
    const el = elWithRect({ left: 100.4, top: 49.6, width: 799.5, height: 600.49 })
    expect(computeViewBounds(el)).toEqual({ x: 100, y: 50, width: 800, height: 600 })
  })

  it('clamps negative width/height to 0', () => {
    const el = elWithRect({ left: 10, top: 10, width: -5, height: -20 })
    const b = computeViewBounds(el)
    expect(b?.width).toBe(0)
    expect(b?.height).toBe(0)
  })
})
