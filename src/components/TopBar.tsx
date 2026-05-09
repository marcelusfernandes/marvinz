type Props = {
  onOpenPalette: () => void
}

export function TopBar({ onOpenPalette }: Props) {
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
          ⌕
        </span>
        <span className="topbar-search-text">Search files…</span>
        <span className="topbar-search-shortcut">
          <kbd>⌘</kbd>
          <kbd>P</kbd>
        </span>
      </button>
      <div className="topbar-right" />
    </div>
  )
}
