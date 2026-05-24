import { useState } from 'react'
import type { FileNode, ImportExternalResult } from '../types'
import { Icon } from './Icon'
import { MaterialIcon } from './MaterialIcon'
import { fileIconFor } from '../lib/fileIcons'
import { useSetting } from '../lib/settingsStore'

export type ImportOutcome =
  | { ok: true; result: ImportExternalResult; destDir: string }
  | { ok: false; error: string }

type Props = {
  nodes: FileNode[]
  vaultPath: string
  selectedPath: string | null
  openPaths: Set<string>
  onToggleOpen: (path: string) => void
  onSelect: (node: FileNode) => void
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void
  onMove: (srcPath: string, destDir: string) => void
  onImportResult?: (outcome: ImportOutcome) => void
}

const DRAG_MIME = 'application/x-marvin-path'

function isMarkdown(name: string): boolean {
  return name.endsWith('.md') || name.endsWith('.markdown')
}

// True when destDir would be inside src (so dropping src into destDir creates a cycle).
function isDescendantOf(destDir: string, src: string): boolean {
  return destDir === src || destDir.startsWith(`${src}/`)
}

export function FileTree({
  nodes,
  vaultPath,
  selectedPath,
  openPaths,
  onToggleOpen,
  onSelect,
  onContextMenu,
  onMove,
  onImportResult,
}: Props) {
  const [rootHover, setRootHover] = useState(false)

  const handleRootDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types
    const isInternal = types.includes(DRAG_MIME)
    const isExternal = !isInternal && types.includes('Files')
    if (!isInternal && !isExternal) return
    // Skip if we're already over a folder/file row (they handle their own drop).
    if ((e.target as HTMLElement).closest('.file-tree-row')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = isExternal ? 'copy' : 'move'
    setRootHover(true)
  }

  const handleRootDrop = (e: React.DragEvent) => {
    // Always suppress Electron's default page-replace before any early return.
    e.preventDefault()
    setRootHover(false)
    if ((e.target as HTMLElement).closest('.file-tree-row')) return
    const src = e.dataTransfer.getData(DRAG_MIME)
    if (src) {
      onMove(src, vaultPath)
      return
    }
    if (e.dataTransfer.files.length === 0) return
    const paths: string[] = []
    for (const file of Array.from(e.dataTransfer.files)) {
      const p = window.marvin.fs.getPathForFile(file)
      if (p) paths.push(p)
    }
    if (paths.length === 0) return
    void window.marvin.fs
      .importExternal(paths, vaultPath)
      .then((result) => {
        onImportResult?.({ ok: true, result, destDir: vaultPath })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        onImportResult?.({ ok: false, error: message })
      })
  }

  return (
    <ul
      className={`file-tree${rootHover ? ' drop-root' : ''}`}
      onDragOver={handleRootDragOver}
      onDragLeave={() => setRootHover(false)}
      onDrop={handleRootDrop}
    >
      {nodes.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          openPaths={openPaths}
          onToggleOpen={onToggleOpen}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
          onMove={onMove}
          onImportResult={onImportResult}
        />
      ))}
    </ul>
  )
}

function FileTreeNode({
  node,
  depth,
  selectedPath,
  openPaths,
  onToggleOpen,
  onSelect,
  onContextMenu,
  onMove,
  onImportResult,
}: {
  node: FileNode
  depth: number
  selectedPath: string | null
  openPaths: Set<string>
  onToggleOpen: (path: string) => void
  onSelect: (node: FileNode) => void
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void
  onMove: (srcPath: string, destDir: string) => void
  onImportResult?: (outcome: ImportOutcome) => void
}) {
  const open = openPaths.has(node.path)
  const [hovered, setHovered] = useState(false)
  const iconTheme = useSetting('iconTheme') ?? 'codicon'
  const isSelected = selectedPath === node.path
  const padding = 8 + depth * 14

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(DRAG_MIME, node.path)
    e.dataTransfer.setData('text/plain', node.path) // fallback
    e.dataTransfer.effectAllowed = 'move'
  }

  if (node.isDir) {
    const handleDragOver = (e: React.DragEvent) => {
      const types = e.dataTransfer.types
      const isInternal = types.includes(DRAG_MIME)
      const isExternal = !isInternal && types.includes('Files')
      if (!isInternal && !isExternal) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = isExternal ? 'copy' : 'move'
      setHovered(true)
    }
    const handleDrop = (e: React.DragEvent) => {
      // Always suppress Electron's default and stop bubbling before any early return.
      e.preventDefault()
      e.stopPropagation()
      setHovered(false)
      const src = e.dataTransfer.getData(DRAG_MIME)
      if (src) {
        if (isDescendantOf(node.path, src)) return
        onMove(src, node.path)
        return
      }
      if (e.dataTransfer.files.length === 0) return
      const paths: string[] = []
      for (const file of Array.from(e.dataTransfer.files)) {
        const p = window.marvin.fs.getPathForFile(file)
        if (p) paths.push(p)
      }
      if (paths.length === 0) return
      void window.marvin.fs
        .importExternal(paths, node.path)
        .then((result) => {
          onImportResult?.({ ok: true, result, destDir: node.path })
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)
          onImportResult?.({ ok: false, error: message })
        })
    }

    return (
      <li>
        <button
          type="button"
          className={`file-tree-row dir${hovered ? ' drop-target' : ''}`}
          style={{ paddingLeft: padding }}
          draggable
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={() => setHovered(false)}
          onDrop={handleDrop}
          onClick={() => onToggleOpen(node.path)}
          onContextMenu={(e) => onContextMenu(e, node)}
        >
          <span className="chev">
            <Icon name={open ? 'chevron-down' : 'chevron-right'} />
          </span>
          {iconTheme === 'material' ? (
            <MaterialIcon
              name={node.name}
              isDir
              open={open}
              className="material-file-icon"
            />
          ) : (
            <Icon
              name={open ? 'folder-opened' : 'folder'}
              className="folder-icon"
            />
          )}
          <span className="name">{node.name}</span>
        </button>
        {open && node.children && node.children.length > 0 && (
          <ul>
            {node.children.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                openPaths={openPaths}
                onToggleOpen={onToggleOpen}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                onMove={onMove}
                onImportResult={onImportResult}
              />
            ))}
          </ul>
        )}
      </li>
    )
  }

  const md = isMarkdown(node.name)
  const displayName = md ? node.name.replace(/\.(md|markdown)$/, '') : node.name

  return (
    <li>
      <button
        type="button"
        className={`file-tree-row file${isSelected ? ' selected' : ''}${md ? '' : ' non-md'}`}
        style={{ paddingLeft: padding + 20 }}
        draggable
        onDragStart={handleDragStart}
        onClick={() => onSelect(node)}
        onContextMenu={(e) => onContextMenu(e, node)}
      >
        {iconTheme === 'material' ? (
          <MaterialIcon name={node.name} isDir={false} className="material-file-icon" />
        ) : (
          <Icon name={fileIconFor(node.name)} className="file-icon" />
        )}
        <span className="name">{displayName}</span>
      </button>
    </li>
  )
}
