import type { BrowserViewInsets } from '../types'

export type ViewBounds = { x: number; y: number; width: number; height: number }

// Compute absolute bounds for an embedded WebContentsView from its placeholder
// element's rect.
//
// getBoundingClientRect() returns CSS pixels (DIPs) in the renderer viewport;
// WebContentsView.setBounds expects DIPs in the window's contentView. They map
// 1:1 on every platform — Chromium handles device-pixel scaling internally, so
// no scale factor is applied here.
//
// A prior implementation multiplied by window.outerWidth/innerWidth as a zoom
// proxy; that ratio is not a valid coordinate scale (it is 1 on the frameless
// window in steady state and diverges during resize / under zoom), which made
// the embedded view drift off its pane. See issue #250. If genuine renderer
// zoom support is ever needed, multiply by the real webFrame.getZoomFactor(),
// never outer/inner.
export function computeViewBounds(el: HTMLElement | null): ViewBounds | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return {
    x: Math.round(r.left),
    y: Math.round(r.top),
    width: Math.max(0, Math.round(r.width)),
    height: Math.max(0, Math.round(r.height)),
  }
}

// A geometry descriptor: the placeholder's distance from each window edge, in
// DIPs. Unlike absolute bounds, insets stay valid as the window resizes — main
// can reconstruct bounds against the *new* window size by pinning the left/top
// edges to their insets and letting right/bottom track the moving edges. This
// is what lets the embedded view follow a macOS maximize/restore animation
// instead of waiting for an IPC round-trip per frame (issue #259).
//
// `winW`/`winH` are passed explicitly (the caller supplies
// window.innerWidth/innerHeight) so this stays pure and testable in the node
// test project where `window` is undefined.
export function computeViewInsets(
  el: HTMLElement | null,
  winW: number,
  winH: number,
): BrowserViewInsets | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return {
    leftInset: Math.round(r.left),
    topInset: Math.round(r.top),
    rightInset: Math.round(winW - r.right),
    bottomInset: Math.round(winH - r.bottom),
  }
}
