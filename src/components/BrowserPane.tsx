import { useEffect, useRef } from 'react'
import { Icon } from './Icon'

type BrowserTabState = {
  type: 'browser'
  id: string
  url: string
  draftUrl: string
  title: string
  canBack: boolean
  canForward: boolean
  loading: boolean
  ready: boolean
}

type Props = {
  tab: BrowserTabState
  isActive: boolean
  onUrlBarChange: (id: string, value: string) => void
  onNavigate: (id: string, url: string) => void
  onReady: (id: string) => void
  /** Increments to request URL bar focus on the currently active tab. */
  urlBarFocusTick: number
  /**
   * Anything that changes when our placeholder may have moved without
   * resizing (e.g. layout-mode swap that reorders grid columns). React
   * to this with a fresh `setBounds` so the embedded view follows.
   */
  geometryKey: string | number
}

export function BrowserPane({
  tab,
  isActive,
  onUrlBarChange,
  onNavigate,
  onReady,
  urlBarFocusTick,
  geometryKey,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)
  const createdRef = useRef(false)

  // Focus the URL bar when Cmd+L is pressed and this tab is active.
  useEffect(() => {
    if (!isActive) return
    urlInputRef.current?.focus()
    urlInputRef.current?.select()
  }, [isActive, urlBarFocusTick])

  // Compute bounds for the embedded WebContentsView from the placeholder.
  // `getBoundingClientRect` is in the renderer's CSS-pixel viewport, but
  // `view.setBounds` in the main process expects DIPs of the window's
  // contentView. The two diverge whenever the renderer's zoomFactor is not
  // 1 (Cmd+/-) or the display uses fractional scaling. The ratio of
  // `outerWidth/innerWidth` is the per-axis scale that maps one to the
  // other; multiplying by it makes bounds correct regardless of zoom.
  const computeBounds = () => {
    const el = hostRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    const sx = window.innerWidth > 0 ? window.outerWidth / window.innerWidth : 1
    const sy = window.innerHeight > 0 ? window.outerHeight / window.innerHeight : 1
    return {
      x: Math.round(r.left * sx),
      y: Math.round(r.top * sy),
      width: Math.max(0, Math.round(r.width * sx)),
      height: Math.max(0, Math.round(r.height * sy)),
    }
  }

  // Lazy-create the WebContentsView on first mount + push subsequent bounds
  // changes via ResizeObserver and window-resize.
  useEffect(() => {
    let cancelled = false

    const create = async () => {
      const bounds = computeBounds()
      if (!bounds) return
      try {
        await window.marvin.browser.create({
          id: tab.id,
          url: tab.url,
          bounds,
        })
        if (!cancelled) onReady(tab.id)
      } catch (err) {
        console.error('[BrowserPane] create failed', err)
      }
    }
    void create()
    createdRef.current = true

    const sync = () => {
      const next = computeBounds()
      if (!next) return
      void window.marvin.browser.setBounds(tab.id, next)
    }
    const ro = new ResizeObserver(sync)
    if (hostRef.current) ro.observe(hostRef.current)
    window.addEventListener('resize', sync)
    // Recompute on scroll of any ancestor — the editor pane scrolls.
    window.addEventListener('scroll', sync, true)

    return () => {
      cancelled = true
      ro.disconnect()
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  // Push bounds whenever the active state flips (React may have hidden
  // ancestors, etc.).
  useEffect(() => {
    if (!isActive) return
    const r = computeBounds()
    if (r) void window.marvin.browser.setBounds(tab.id, r)
  }, [isActive, tab.id])

  // Re-sync after the React tree shifts position without resizing
  // (e.g. layout swap that reorders grid columns). ResizeObserver doesn't
  // fire for pure position changes — wait one frame for CSS to apply, then
  // push fresh bounds. Runs for ALL mounted browser tabs so an inactive
  // tab's bounds are correct the next time it becomes active.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const r = computeBounds()
      if (r) void window.marvin.browser.setBounds(tab.id, r)
    })
    return () => cancelAnimationFrame(id)
  }, [geometryKey, tab.id])

  const submitUrl = () => {
    onNavigate(tab.id, tab.draftUrl)
  }

  return (
    <div className={`browser-pane${isActive ? ' active' : ''}`}>
      <div className="browser-toolbar">
        <button
          type="button"
          className="nav-btn"
          disabled={!tab.canBack}
          onClick={() => void window.marvin.browser.back(tab.id)}
          title="Back"
          aria-label="Back"
        >
          <Icon name="chevron-left"/>
        </button>
        <button
          type="button"
          className="nav-btn"
          disabled={!tab.canForward}
          onClick={() => void window.marvin.browser.forward(tab.id)}
          title="Forward"
          aria-label="Forward"
        >
          <Icon name="chevron-right"/>
        </button>
        <button
          type="button"
          className="nav-btn"
          onClick={() =>
            tab.loading
              ? void window.marvin.browser.stop(tab.id)
              : void window.marvin.browser.reload(tab.id)
          }
          title={tab.loading ? 'Stop' : 'Reload'}
          aria-label={tab.loading ? 'Stop' : 'Reload'}
        >
          <Icon name={tab.loading ? 'close' : 'refresh'}/>
        </button>
        <input
          ref={urlInputRef}
          className="browser-url"
          value={tab.draftUrl}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onUrlBarChange(tab.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submitUrl()
            }
          }}
          onFocus={(e) => e.currentTarget.select()}
        />
      </div>
      <div ref={hostRef} className="browser-host" />
    </div>
  )
}
