import { useEffect, useRef, useState } from 'react'

type Props = {
  onNewNote: () => void
  onNewFolder: () => void
}

export function SidebarMenu({ onNewNote, onNewFolder }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="sidebar-menu" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        title="Create"
        onClick={() => setOpen((o) => !o)}
      >
        +
      </button>
      {open && (
        <div className="sidebar-menu-pop">
          <button
            type="button"
            className="ctx-item"
            onClick={() => {
              setOpen(false)
              onNewNote()
            }}
          >
            New note
          </button>
          <button
            type="button"
            className="ctx-item"
            onClick={() => {
              setOpen(false)
              onNewFolder()
            }}
          >
            New folder
          </button>
        </div>
      )}
    </div>
  )
}
