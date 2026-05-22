import { useState } from 'react'
import type { FileNode } from '../types'
import { Icon } from './Icon'
import { fileIconFor } from '../lib/fileIcons'

type Props = {
  nodes: FileNode[]
  vaultPath: string
  selectedPath: string | null
  onSelect: (node: FileNode) => void
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void
  onMove: (srcPath: string, destDir: string) => void
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
  onSelect,
  onContextMenu,
  onMove,
}: Props) {
  const [rootHover, setRootHover] = useState(false)

  const handleRootDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return
    // Skip if we're already over a folder/file row (they handle their own drop).
    if ((e.target as HTMLElement).closest('.file-tree-row')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setRootHover(true)
  }

  const handleRootDrop = (e: React.DragEvent) => {
    setRootHover(false)
    if ((e.target as HTMLElement).closest('.file-tree-row')) return
    const src = e.dataTransfer.getData(DRAG_MIME)
    if (!src) return
    e.preventDefault()
    onMove(src, vaultPath)
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
          onSelect={onSelect}
          onContextMenu={onContextMenu}
          onMove={onMove}
        />
      ))}
    </ul>
  )
}

function FileTreeNode({
  node,
  depth,
  selectedPath,
  onSelect,
  onContextMenu,
  onMove,
}: {
  node: FileNode
  depth: number
  selectedPath: string | null
  onSelect: (node: FileNode) => void
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void
  onMove: (srcPath: string, destDir: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const isSelected = selectedPath === node.path
  const padding = 8 + depth * 14

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(DRAG_MIME, node.path)
    e.dataTransfer.setData('text/plain', node.path) // fallback
    e.dataTransfer.effectAllowed = 'move'
  }

  if (node.isDir) {
    const handleDragOver = (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_MIME)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      setHovered(true)
    }
    const handleDrop = (e: React.DragEvent) => {
      setHovered(false)
      const src = e.dataTransfer.getData(DRAG_MIME)
      if (!src) return
      e.preventDefault()
      e.stopPropagation()
      if (isDescendantOf(node.path, src)) return
      onMove(src, node.path)
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
          onClick={() => setOpen((o) => !o)}
          onContextMenu={(e) => onContextMenu(e, node)}
        >
          <span className="chev">
            <Icon name={open ? 'chevron-down' : 'chevron-right'} />
          </span>
          <Icon
            name={open ? 'folder-opened' : 'folder'}
            className="folder-icon"
          />
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
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                onMove={onMove}
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
        <Icon name={fileIconFor(node.name)} className="file-icon" />
        <span className="name">{displayName}</span>
      </button>
    </li>
  )
}
