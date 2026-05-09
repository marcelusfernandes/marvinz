import { useEffect, useRef, useState } from 'react'

type Props = {
  title: string
  placeholder?: string
  initialValue?: string
  submitLabel?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}

export function InputDialog({
  title,
  placeholder,
  initialValue = '',
  submitLabel = 'Create',
  onSubmit,
  onCancel,
}: Props) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (trimmed) onSubmit(trimmed)
  }

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal"
        onSubmit={handleSubmit}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="modal-title">{title}</h3>
        <input
          ref={inputRef}
          className="modal-input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="modal-actions">
          <button type="button" className="modal-btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className="modal-btn primary"
            disabled={!value.trim()}
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
