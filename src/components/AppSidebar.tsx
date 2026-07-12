import type React from 'react'
import type { FileNode } from '../types'
import type { VisualStyle } from '../lib/visualStyle'
import { FileTree, type CreatingIn } from './FileTree'
import { FileTreeToolbar } from './FileTreeToolbar'
import { Icon } from './Icon'

type FileTreeProps = React.ComponentProps<typeof FileTree>

type Props = {
  visualStyle: VisualStyle
  vaultPath: string
  tree: FileNode[]
  selectedPaths: Set<string>
  activeFilePath: string | null
  openPaths: Set<string>
  creatingIn: CreatingIn | null
  isAnyOpen: boolean
  onNewFile: () => void
  onNewFolder: () => void
  onToggleAll: () => void
  onSidebarContextMenu: React.MouseEventHandler<HTMLElement>
  onSidebarPaste: React.ClipboardEventHandler<HTMLElement>
  onToggleOpen: FileTreeProps['onToggleOpen']
  onSelect: FileTreeProps['onSelect']
  onClearSelection: FileTreeProps['onClearSelection']
  onCreatingInChange: FileTreeProps['onCreatingInChange']
  onNodeContextMenu: FileTreeProps['onContextMenu']
  onMove: FileTreeProps['onMove']
  onImportResult: FileTreeProps['onImportResult']
  onPickVault: () => void
  onOpenSettings: () => void
}

export function AppSidebar({
  visualStyle,
  vaultPath,
  tree,
  selectedPaths,
  activeFilePath,
  openPaths,
  creatingIn,
  isAnyOpen,
  onNewFile,
  onNewFolder,
  onToggleAll,
  onSidebarContextMenu,
  onSidebarPaste,
  onToggleOpen,
  onSelect,
  onClearSelection,
  onCreatingInChange,
  onNodeContextMenu,
  onMove,
  onImportResult,
  onPickVault,
  onOpenSettings,
}: Props) {
  return (
    <aside className="sidebar" onContextMenu={onSidebarContextMenu} onPaste={onSidebarPaste}>
      <div className="sidebar-header">
        {visualStyle === 'legacy' ? (
          <span className="vault-name">{vaultPath.split('/').pop()}</span>
        ) : (
          <div className="sidebar-project-info">
            <div className="sidebar-project-text">
              <span className="sidebar-project-name">{vaultPath.split('/').pop()}</span>
            </div>
          </div>
        )}
        <FileTreeToolbar
          isAnyOpen={isAnyOpen}
          onNewFile={onNewFile}
          onNewFolder={onNewFolder}
          onToggleAll={onToggleAll}
        />
      </div>
      <FileTree
        nodes={tree}
        vaultPath={vaultPath}
        selectedPaths={selectedPaths}
        activeFilePath={activeFilePath}
        openPaths={openPaths}
        creatingIn={creatingIn}
        onToggleOpen={onToggleOpen}
        onSelect={onSelect}
        onClearSelection={onClearSelection}
        onCreatingInChange={onCreatingInChange}
        onContextMenu={onNodeContextMenu}
        onMove={onMove}
        onImportResult={onImportResult}
      />
      <div className="sidebar-footer">
        {visualStyle === 'legacy' ? (
          <button type="button" className="text-btn" onClick={onPickVault}>
            Switch folder
          </button>
        ) : (
          <>
            <button type="button" className="sidebar-footer-btn" onClick={onPickVault}>
              <Icon name="folder" size={16} />
              <span>Switch Folder</span>
            </button>
            <button type="button" className="sidebar-footer-btn" onClick={onOpenSettings}>
              <Icon name="gear" size={16} />
              <span>Settings</span>
            </button>
          </>
        )}
      </div>
    </aside>
  )
}
