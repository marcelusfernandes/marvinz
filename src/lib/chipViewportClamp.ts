// Strategy A (simple clamp): chip never leaks past viewport edges.
// Magic numbers trace to App.css `.selection-chip` geometry — keep in sync if CSS changes.
const CHIP_MAX_WIDTH = 110
const CHIP_HEIGHT = 22
const MARGIN = 8

export type ChipCoords = {
  left: number
  right: number
  top: number
  bottom: number
}

export function clampToViewport(c: ChipCoords): ChipCoords {
  const maxRight = window.innerWidth - CHIP_MAX_WIDTH - MARGIN
  const maxBottom = window.innerHeight - CHIP_HEIGHT - MARGIN
  return {
    left: c.left,
    right: Math.min(c.right, maxRight),
    top: c.top,
    bottom: Math.min(c.bottom, maxBottom),
  }
}
