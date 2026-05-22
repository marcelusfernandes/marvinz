import { Icon } from './Icon'

type Props = {
  isAnyOpen: boolean
  onNewFile: () => void
  onNewFolder: () => void
  onRefresh: () => void
  onToggleAll: () => void
}

export function FileTreeToolbar({
  isAnyOpen,
  onNewFile,
  onNewFolder,
  onRefresh,
  onToggleAll,
}: Props) {
  return (
    <div className="file-tree-toolbar">
      <button
        type="button"
        className="icon-btn"
        title="New file"
        aria-label="New file"
        onClick={onNewFile}
      >
        <Icon name="new-file" size={16} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="New folder"
        aria-label="New folder"
        onClick={onNewFolder}
      >
        <Icon name="new-folder" size={16} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="Refresh"
        aria-label="Refresh"
        onClick={onRefresh}
      >
        <Icon name="refresh" size={16} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title={isAnyOpen ? 'Collapse all' : 'Expand all'}
        aria-label={isAnyOpen ? 'Collapse all' : 'Expand all'}
        onClick={onToggleAll}
      >
        <Icon name={isAnyOpen ? 'collapse-all' : 'expand-all'} size={16} />
      </button>
    </div>
  )
}
