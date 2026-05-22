import { LayoutToggle, type LayoutMode } from './LayoutToggle'
import { Icon } from './Icon'

type Props = {
  onOpenPalette: () => void
  layoutMode: LayoutMode
  onLayoutChange: (mode: LayoutMode) => void
}

export function TopBar({ onOpenPalette, layoutMode, onLayoutChange }: Props) {
  return (
    <div className="topbar">
      <div className="topbar-left" />
      <button
        type="button"
        className="topbar-search"
        onClick={onOpenPalette}
        title="Search files (⌘P)"
      >
        <span className="topbar-search-icon" aria-hidden>
          <Icon name="search" />
        </span>
        <span className="topbar-search-text">Search files…</span>
        <span className="topbar-search-shortcut">
          <kbd>⌘</kbd>
          <kbd>P</kbd>
        </span>
      </button>
      <div className="topbar-right">
        <LayoutToggle mode={layoutMode} onChange={onLayoutChange} />
      </div>
    </div>
  )
}
