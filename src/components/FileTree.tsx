import { useEffect, useRef, useState } from 'react'
import type { FileNode, ImportExternalResult } from '../types'
import { Icon } from './Icon'
import { MaterialIcon } from './MaterialIcon'
import { fileIconFor } from '../lib/fileIcons'
import { useSetting } from '../lib/settingsStore'

export type ImportOutcome =
  | { ok: true; result: ImportExternalResult; destDir: string }
  | { ok: false; error: string }

export type CreatingIn = { parentDir: string; kind: 'file' | 'folder' }

type Props = {
  nodes: FileNode[]
  vaultPath: string
  selectedPath: string | null
  selectedFolderPath?: string | null
  openPaths: Set<string>
  creatingIn?: CreatingIn | null
  onToggleOpen: (path: string) => void
  onSelect: (node: FileNode) => void
  onSelectFolder?: (path: string | null) => void
  onCreatingInChange?: (value: CreatingIn | null) => void
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void
  onMove: (srcPath: string, destDir: string) => void
  onImportResult?: (outcome: ImportOutcome) => void
}

const noopSelectFolder: (path: string | null) => void = () => {}
const noopCreatingInChange: (value: CreatingIn | null) => void = () => {}

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
  selectedFolderPath = null,
  openPaths,
  creatingIn = null,
  onToggleOpen,
  onSelect,
  onSelectFolder = noopSelectFolder,
  onCreatingInChange = noopCreatingInChange,
  onContextMenu,
  onMove,
  onImportResult,
}: Props) {
  const [rootHover, setRootHover] = useState(false)

  // Auto-expand the parent folder when an inline create starts in a closed one.
  useEffect(() => {
    if (!creatingIn) return
    if (creatingIn.parentDir === vaultPath) return
    if (openPaths.has(creatingIn.parentDir)) return
    onToggleOpen(creatingIn.parentDir)
  }, [creatingIn, openPaths, vaultPath, onToggleOpen])

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
      role="tree"
      aria-label="File tree"
      onClick={(e) => {
        if (e.target === e.currentTarget) onSelectFolder(null)
      }}
      onDragOver={handleRootDragOver}
      onDragLeave={() => setRootHover(false)}
      onDrop={handleRootDrop}
    >
      {creatingIn && creatingIn.parentDir === vaultPath && (
        <InlineCreateRow
          depth={0}
          kind={creatingIn.kind}
          parentDir={creatingIn.parentDir}
          onCreatingInChange={onCreatingInChange}
        />
      )}
      {nodes.map((node, index) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={0}
          posinset={index + 1}
          setsize={nodes.length}
          selectedPath={selectedPath}
          selectedFolderPath={selectedFolderPath}
          openPaths={openPaths}
          creatingIn={creatingIn}
          onToggleOpen={onToggleOpen}
          onSelect={onSelect}
          onSelectFolder={onSelectFolder}
          onCreatingInChange={onCreatingInChange}
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
  posinset,
  setsize,
  selectedPath,
  selectedFolderPath,
  openPaths,
  creatingIn,
  onToggleOpen,
  onSelect,
  onSelectFolder,
  onCreatingInChange,
  onContextMenu,
  onMove,
  onImportResult,
}: {
  node: FileNode
  depth: number
  posinset: number
  setsize: number
  selectedPath: string | null
  selectedFolderPath: string | null
  openPaths: Set<string>
  creatingIn: CreatingIn | null
  onToggleOpen: (path: string) => void
  onSelect: (node: FileNode) => void
  onSelectFolder: (path: string | null) => void
  onCreatingInChange: (value: CreatingIn | null) => void
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void
  onMove: (srcPath: string, destDir: string) => void
  onImportResult?: (outcome: ImportOutcome) => void
}) {
  const open = openPaths.has(node.path)
  const [hovered, setHovered] = useState(false)
  const iconTheme = useSetting('iconTheme') ?? 'codicon'
  const isSelected = selectedPath === node.path
  const isFolderSelected = node.isDir && selectedFolderPath === node.path
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

    const showInlineHere = creatingIn?.parentDir === node.path
    const hasVisibleChildren = (node.children && node.children.length > 0) || showInlineHere

    return (
      <li
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={open}
        aria-selected={isSelected}
        aria-posinset={posinset}
        aria-setsize={setsize}
      >
        <button
          type="button"
          className={`file-tree-row dir${hovered ? ' drop-target' : ''}${isFolderSelected ? ' folder-selected' : ''}`}
          style={{ paddingLeft: padding }}
          draggable
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={() => setHovered(false)}
          onDrop={handleDrop}
          onClick={() => {
            onSelectFolder(node.path)
            onToggleOpen(node.path)
          }}
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
        {open && hasVisibleChildren && (
          <ul role="group">
            {showInlineHere && (
              <InlineCreateRow
                depth={depth + 1}
                kind={creatingIn!.kind}
                parentDir={node.path}
                onCreatingInChange={onCreatingInChange}
              />
            )}
            {node.children?.map((child, childIndex) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                posinset={childIndex + 1}
                setsize={node.children!.length}
                selectedPath={selectedPath}
                selectedFolderPath={selectedFolderPath}
                openPaths={openPaths}
                creatingIn={creatingIn}
                onToggleOpen={onToggleOpen}
                onSelect={onSelect}
                onSelectFolder={onSelectFolder}
                onCreatingInChange={onCreatingInChange}
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
    <li
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={isSelected}
      aria-posinset={posinset}
      aria-setsize={setsize}
    >
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

function InlineCreateRow({
  depth,
  kind,
  parentDir,
  onCreatingInChange,
}: {
  depth: number
  kind: 'file' | 'folder'
  parentDir: string
  onCreatingInChange: (value: CreatingIn | null) => void
}) {
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)
  const submittingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const padding = 8 + depth * 14 + (kind === 'file' ? 20 : 0)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = async () => {
    const trimmed = value.trim()
    if (!trimmed) return
    const finalName =
      kind === 'file' && !/\.[^/]+$/.test(trimmed) ? `${trimmed}.md` : trimmed
    submittingRef.current = true
    try {
      if (kind === 'file') {
        await window.marvin.file.create(parentDir, finalName)
      } else {
        await window.marvin.folder.create(parentDir, finalName)
      }
      onCreatingInChange(null)
    } catch {
      setError(true)
      submittingRef.current = false
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void submit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCreatingInChange(null)
    }
  }

  const handleBlur = () => {
    if (submittingRef.current) return
    onCreatingInChange(null)
  }

  return (
    <li
      className={`file-tree-row inline-edit ${kind}`}
      style={{ paddingLeft: padding }}
    >
      {kind === 'folder' ? (
        <>
          <span className="chev" />
          <Icon name="folder" className="folder-icon" />
        </>
      ) : (
        <Icon name="new-file" className="file-icon" />
      )}
      <input
        ref={inputRef}
        type="text"
        className={error ? 'input-error' : undefined}
        aria-label={`New ${kind} name`}
        aria-invalid={error || undefined}
        value={value}
        autoFocus
        onChange={(e) => {
          setValue(e.target.value)
          if (error) setError(false)
        }}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
    </li>
  )
}
