import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type MenuItem =
  | { kind: 'item'; label: string; onClick: () => void; danger?: boolean }
  | { kind: 'separator' }

type Props = {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x, y })

  useLayoutEffect(() => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    let nx = x
    let ny = y
    if (nx + rect.width > window.innerWidth - 8) nx = window.innerWidth - rect.width - 8
    if (ny + rect.height > window.innerHeight - 8) ny = window.innerHeight - rect.height - 8
    setPosition({ x: Math.max(8, nx), y: Math.max(8, ny) })
  }, [x, y])

  useEffect(() => {
    const close = () => onClose()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: position.x, top: position.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => {
        if (item.kind === 'separator') return <div key={i} className="ctx-sep" />
        return (
          <button
            type="button"
            key={i}
            className={`ctx-item${item.danger ? ' danger' : ''}`}
            onClick={() => {
              item.onClick()
              onClose()
            }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
