import { Icon } from './Icon'

type Props = {
  onNewFile: () => void
  onNewFolder: () => void
  onRefresh: () => void
  onCollapseAll: () => void
}

export function FileTreeToolbar({ onNewFile, onNewFolder, onRefresh, onCollapseAll }: Props) {
  return (
    <div className="file-tree-toolbar">
      <button
        type="button"
        className="icon-btn"
        title="New file"
        aria-label="New file"
        onClick={onNewFile}
      >
        <Icon name="new-file" size={20} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="New folder"
        aria-label="New folder"
        onClick={onNewFolder}
      >
        <Icon name="new-folder" size={20} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="Refresh"
        aria-label="Refresh"
        onClick={onRefresh}
      >
        <Icon name="refresh" size={20} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="Collapse all"
        aria-label="Collapse all"
        onClick={onCollapseAll}
      >
        <Icon name="collapse-all" size={20} />
      </button>
    </div>
  )
}
