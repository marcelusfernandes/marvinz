import { useEffect, useRef, useState } from 'react'

type Props = {
  /** Called continuously while dragging with the pixel delta since the
   * previous mousemove. The parent decides which width to mutate and how
   * to interpret the sign. */
  onDelta: (dxPixels: number) => void
  /** Optional friendlier label for screen readers. */
  ariaLabel?: string
}

export function Splitter({ onDelta, ariaLabel = 'Resize column' }: Props) {
  const [dragging, setDragging] = useState(false)
  const lastXRef = useRef<number | null>(null)

  // Document-level listeners while dragging. Restored on mouseup so other
  // text remains selectable.
  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      if (lastXRef.current == null) {
        lastXRef.current = e.clientX
        return
      }
      const dx = e.clientX - lastXRef.current
      lastXRef.current = e.clientX
      if (dx !== 0) onDelta(dx)
    }
    const onUp = () => {
      lastXRef.current = null
      setDragging(false)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
    }
  }, [dragging, onDelta])

  return (
    <div
      className={`splitter${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onMouseDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        lastXRef.current = e.clientX
        setDragging(true)
      }}
    />
  )
}
