import { useEffect, type RefObject } from 'react'

/**
 * Converts vertical mouse wheel into horizontal scroll on the target element,
 * matching VS Code's tab bar behavior. Only consumes the wheel event when the
 * element is actually horizontally scrollable, so page scroll still works when
 * the bar fits all its content.
 *
 * Attaches via native addEventListener with passive: false because React's
 * onWheel is passive by default and cannot preventDefault.
 */
export function useHorizontalWheelScroll(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ref])
}
