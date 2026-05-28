import { createPortal } from 'react-dom'
import { Icon } from './Icon'

/*
 * EditorSelectionChip — floating "Send to agent" affordance pinned to the
 * caret-end of a CodeMirror selection. See lipe-ui's visual spec on
 * `.selection-chip` rules in App.css. Click → host's `onSendSelection`.
 *
 * Uses `position: fixed` (vs the spec's `absolute`) because the chip is
 * portalled to `document.body` and the coords from `view.coordsAtPos` are
 * already viewport-relative — `fixed` lets it follow scroll without a
 * positioning ancestor. Hover/focus expands the icon-only pill to reveal
 * the label.
 */

type Props = {
  /** Viewport coords of the selection's caret end. Chip pins below
   * `bottom` and at `right`; CSS handles the small visual offset. */
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
      <Icon name="send" size={14} />
      <span className="selection-chip__label" aria-hidden="true">
        Send to agent
      </span>
    </button>,
    document.body,
  )
}
