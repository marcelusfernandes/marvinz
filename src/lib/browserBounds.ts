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
