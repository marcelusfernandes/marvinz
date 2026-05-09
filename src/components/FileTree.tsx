import { useState } from 'react'
import type { FileNode } from '../types'

type Props = {
  nodes: FileNode[]
  selectedPath: string | null
  onSelect: (node: FileNode) => void
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void
}

export function FileTree({ nodes, selectedPath, onSelect, onContextMenu }: Props) {
  return (
    <ul className="file-tree">
      {nodes.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
        />
      ))}
    </ul>
  )
}

function isMarkdown(name: string): boolean {
  return name.endsWith('.md') || name.endsWith('.markdown')
}

function FileTreeNode({
  node,
  depth,
  selectedPath,
  onSelect,
  onContextMenu,
}: {
  node: FileNode
  depth: number
  selectedPath: string | null
  onSelect: (node: FileNode) => void
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void
}) {
  const [open, setOpen] = useState(true)
  const isSelected = selectedPath === node.path
  const padding = 8 + depth * 14

  if (node.isDir) {
    return (
      <li>
        <button
          type="button"
          className="file-tree-row dir"
          style={{ paddingLeft: padding }}
          onClick={() => setOpen((o) => !o)}
          onContextMenu={(e) => onContextMenu(e, node)}
        >
          <span className="chev">{open ? '▾' : '▸'}</span>
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
        style={{ paddingLeft: padding + 14 }}
        onClick={() => onSelect(node)}
        onContextMenu={(e) => onContextMenu(e, node)}
      >
        <span className="name">{displayName}</span>
      </button>
    </li>
  )
}
