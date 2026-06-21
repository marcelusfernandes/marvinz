import { createPortal } from 'react-dom'
import { Icon } from './Icon'

// position: fixed (not absolute) because coords from coordsAtPos are already viewport-relative.

type Props = {
  coords: { left: number; right: number; top: number; bottom: number }
  onClick: () => void
}

export function EditorSelectionChip({ coords, onClick }: Props) {
  const style = {
    left: coords.right,
    top: coords.bottom,
  }
  return createPortal(
    <button
      type="button"
      className="selection-chip"
      style={style}
      onClick={onClick}
      aria-label="Send selection to agent"
      data-testid="editor-selection-chip"
    >
      <Icon name="send" size={12} />
      <span className="selection-chip__label" aria-hidden="true">
        Send to agent
      </span>
    </button>,
    document.body
  )
}
