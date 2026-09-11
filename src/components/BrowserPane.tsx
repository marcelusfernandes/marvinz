import { useCallback, useEffect, useRef } from 'react'
import { Icon } from './Icon'
import { computeViewBounds, computeViewInsets } from '../lib/browserBounds'
import { marvin } from '../lib/marvinApi'

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
  const computeBounds = () => computeViewBounds(hostRef.current)

  // Push the absolute bounds (drives panel drags + the create path) and the
  // geometry descriptor (lets main recompute during OS window resize, #259) in
  // one shot, on every trigger that can move the placeholder.
  const pushGeometry = useCallback(() => {
    const bounds = computeViewBounds(hostRef.current)
    if (bounds) void marvin.browser.setBounds(tab.id, bounds)
    const insets = computeViewInsets(hostRef.current, window.innerWidth, window.innerHeight)
    if (insets) void marvin.browser.setGeometry(tab.id, insets)
  }, [tab.id])

  // Lazy-create the WebContentsView on first mount + push subsequent bounds
  // changes via ResizeObserver and window-resize.
  useEffect(() => {
    let cancelled = false

    const create = async () => {
      const bounds = computeBounds()
      if (!bounds) return
      try {
        await marvin.browser.create({
          id: tab.id,
          url: tab.url,
          bounds,
        })
        if (!cancelled) {
          // Register the geometry descriptor right after create so main can
          // recompute bounds on the very first OS window resize.
          const insets = computeViewInsets(hostRef.current, window.innerWidth, window.innerHeight)
          if (insets) void marvin.browser.setGeometry(tab.id, insets)
          onReady(tab.id)
        }
      } catch (err) {
        console.error('[BrowserPane] create failed', err)
      }
    }
    void create()
    createdRef.current = true

    const sync = () => pushGeometry()
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
    pushGeometry()
  }, [isActive, pushGeometry])

  // Re-sync after the React tree shifts position without resizing
  // (e.g. layout swap that reorders grid columns). ResizeObserver doesn't
  // fire for pure position changes — wait one frame for CSS to apply, then
  // push fresh bounds. Runs for ALL mounted browser tabs so an inactive
  // tab's bounds are correct the next time it becomes active.
  useEffect(() => {
    const id = requestAnimationFrame(() => pushGeometry())
    return () => cancelAnimationFrame(id)
  }, [geometryKey, pushGeometry])

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
          onClick={() => void marvin.browser.back(tab.id)}
          title="Back"
          aria-label="Back"
        >
          <Icon name="chevron-left" />
        </button>
        <button
          type="button"
          className="nav-btn"
          disabled={!tab.canForward}
          onClick={() => void marvin.browser.forward(tab.id)}
          title="Forward"
          aria-label="Forward"
        >
          <Icon name="chevron-right" />
        </button>
        <button
          type="button"
          className="nav-btn"
          onClick={() =>
            tab.loading ? void marvin.browser.stop(tab.id) : void marvin.browser.reload(tab.id)
          }
          title={tab.loading ? 'Stop' : 'Reload'}
          aria-label={tab.loading ? 'Stop' : 'Reload'}
        >
          <Icon name={tab.loading ? 'close' : 'refresh'} />
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
