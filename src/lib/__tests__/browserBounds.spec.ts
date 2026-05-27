import { describe, it, expect } from 'vitest'
import { computeViewBounds, computeViewInsets } from '../browserBounds'

function elWithRect(rect: Partial<DOMRect>): HTMLElement {
  const { left = 0, top = 0, width = 0, height = 0 } = rect
  return {
    getBoundingClientRect: () =>
      ({
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        ...rect,
      }) as DOMRect,
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

describe('computeViewInsets', () => {
  it('returns null for a null element', () => {
    expect(computeViewInsets(null, 1200, 800)).toBeNull()
  })

  it('computes insets from each window edge', () => {
    // Pane occupies x:[100,900], y:[50,650] in a 1200x800 viewport.
    const el = elWithRect({ left: 100, top: 50, width: 800, height: 600 })
    expect(computeViewInsets(el, 1200, 800)).toEqual({
      leftInset: 100,
      topInset: 50,
      rightInset: 1200 - 900, // 300
      bottomInset: 800 - 650, // 150
    })
  })

  it('round-trips: insets reconstruct the original bounds against the same window', () => {
    const winW = 1200
    const winH = 800
    const el = elWithRect({ left: 100, top: 50, width: 800, height: 600 })
    const insets = computeViewInsets(el, winW, winH)!
    // Main rebuilds bounds by pinning left/top and tracking right/bottom.
    expect({
      x: insets.leftInset,
      y: insets.topInset,
      width: winW - insets.leftInset - insets.rightInset,
      height: winH - insets.topInset - insets.bottomInset,
    }).toEqual({ x: 100, y: 50, width: 800, height: 600 })
  })

  it('keeps left/top pinned and grows width/height when the window grows', () => {
    const el = elWithRect({ left: 100, top: 50, width: 800, height: 600 })
    const insets = computeViewInsets(el, 1200, 800)!
    // Window grows to 1400x900: left/top insets stay, right/bottom edges move,
    // so the reconstructed view fills the extra space.
    const grownW = 1400
    const grownH = 900
    expect({
      width: grownW - insets.leftInset - insets.rightInset,
      height: grownH - insets.topInset - insets.bottomInset,
    }).toEqual({ width: 1000, height: 700 })
  })

  it('rounds fractional rect and window values', () => {
    const el = elWithRect({ left: 100.4, top: 49.6, width: 799.5, height: 600.49 })
    // right = 100.4 + 799.5 = 899.9 ; bottom = 49.6 + 600.49 = 650.09
    expect(computeViewInsets(el, 1200.5, 800.2)).toEqual({
      leftInset: 100, // round(100.4)
      topInset: 50, // round(49.6)
      rightInset: 301, // round(1200.5 - 899.9) = round(300.6)
      bottomInset: 150, // round(800.2 - 650.09) = round(150.11)
    })
  })

  it('produces correct insets regardless of where the pane sits (visual-style swap)', () => {
    // modern vs legacy layouts swap grid column order, but insets are measured
    // from the actual rendered rect, so the descriptor is correct either way.
    // Pane on the right half:
    const right = elWithRect({ left: 600, top: 0, width: 600, height: 800 })
    expect(computeViewInsets(right, 1200, 800)).toEqual({
      leftInset: 600,
      topInset: 0,
      rightInset: 0,
      bottomInset: 0,
    })
    // Pane on the left half:
    const left = elWithRect({ left: 0, top: 0, width: 600, height: 800 })
    expect(computeViewInsets(left, 1200, 800)).toEqual({
      leftInset: 0,
      topInset: 0,
      rightInset: 600,
      bottomInset: 0,
    })
  })
})
