// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { clampToViewport } from '../chipViewportClamp'

// jsdom defaults: window.innerWidth=1024, window.innerHeight=768.
// Constants in chipViewportClamp.ts: CHIP_MAX_WIDTH=110, CHIP_HEIGHT=22, MARGIN=8.
// maxRight = 1024 - 110 - 8 = 906; maxBottom = 768 - 22 - 8 = 738.

describe('clampToViewport', () => {
  it('passes through coords that fit inside the viewport', () => {
    const result = clampToViewport({ left: 100, right: 200, top: 50, bottom: 70 })
    expect(result).toEqual({ left: 100, right: 200, top: 50, bottom: 70 })
  })

  it('clamps right edge when coords would push the chip past the right margin', () => {
    const result = clampToViewport({ left: 800, right: 1000, top: 50, bottom: 70 })
    expect(result.right).toBe(906)
    expect(result.left).toBe(800)
    expect(result.top).toBe(50)
    expect(result.bottom).toBe(70)
  })

  it('clamps bottom edge when coords would push the chip past the bottom margin', () => {
    const result = clampToViewport({ left: 100, right: 200, top: 700, bottom: 760 })
    expect(result.bottom).toBe(738)
    expect(result.left).toBe(100)
    expect(result.right).toBe(200)
    expect(result.top).toBe(700)
  })

  it('clamps both right and bottom when both edges overflow', () => {
    const result = clampToViewport({ left: 900, right: 1100, top: 700, bottom: 800 })
    expect(result.right).toBe(906)
    expect(result.bottom).toBe(738)
  })

  it('leaves coords exactly at the boundary unchanged', () => {
    const result = clampToViewport({ left: 500, right: 906, top: 400, bottom: 738 })
    expect(result).toEqual({ left: 500, right: 906, top: 400, bottom: 738 })
  })
})
