import { useEffect, useRef } from 'react'
import { computeViewBounds } from '../lib/browserBounds'

type Props = {
  filePath: string
  version: number
  /** Bumps when the React tree shifts the host without resizing
   * (layout-mode swap, sidebar resize). ResizeObserver doesn't fire for
   * pure position changes — re-anchor via RAF + setBounds. */
  geometryKey: string | number
}

function marvinFileUrl(absPath: string, version: number): string {
  const encoded = absPath.split('/').map(encodeURIComponent).join('/')
  return `marvin://localhost${encoded}?v=${version}`
}


export function HtmlPreview({ filePath, version, geometryKey }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const id = `html-preview-${filePath}`

  // Create the WebContentsView on mount; close on unmount. Re-creates when
  // `filePath` changes because `id` is derived from it.
  useEffect(() => {
    let cancelled = false

    const create = async () => {
      const bounds = computeViewBounds(hostRef.current)
      if (!bounds) return
      try {
        await window.marvin.browser.create({
          id,
          url: marvinFileUrl(filePath, version),
          bounds,
        })
        if (cancelled) return
      } catch (err) {
        console.error('[HtmlPreview] create failed', err)
      }
    }
    void create()

    const sync = () => {
      const next = computeViewBounds(hostRef.current)
      if (!next) return
      void window.marvin.browser.setBounds(id, next)
    }
    const ro = new ResizeObserver(sync)
    if (hostRef.current) ro.observe(hostRef.current)
    window.addEventListener('resize', sync)
    window.addEventListener('scroll', sync, true)

    return () => {
      cancelled = true
      ro.disconnect()
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
      void window.marvin.browser.close(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Bumps to `version` reload the same view with a fresh cache-buster URL.
  // The first render's URL already encodes `version`, so skip the initial
  // run with a ref guard.
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    void window.marvin.browser.navigate(id, marvinFileUrl(filePath, version))
  }, [id, filePath, version])

  // Pure-position shifts (layout-mode swap, sidebar resize) don't trigger
  // ResizeObserver. Wait one frame for CSS to settle, then push fresh bounds.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const r = computeViewBounds(hostRef.current)
      if (r) void window.marvin.browser.setBounds(id, r)
    })
    return () => cancelAnimationFrame(raf)
  }, [geometryKey, id])

  return <div ref={hostRef} className="html-preview-host" />
}
