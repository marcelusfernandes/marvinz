import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { FileNode, ImportExternalResult } from '../types'
import type { FlatTreeItem } from '../lib/flattenVisibleTree'
import { flattenVisibleTree } from '../lib/flattenVisibleTree'
import { Icon } from './Icon'
import { MaterialIcon } from './MaterialIcon'
import { fileIconFor } from '../lib/fileIcons'
import { useSetting } from '../lib/settingsStore'
import { toMarvinUrl } from '../lib/marvinUrl'

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico|heic|heif)$/i

// Build a compact drag ghost so the preview shown while dragging isn't the
// full file-tree row. Images get a small thumbnail (relies on the marvin://
// URL being cached if previously rendered); everything else gets a small
// chip with just the file name. Wrapped in a spacer so the visible content
// sits slightly below the pointer instead of crowding it.
function buildDragGhost(name: string, absolutePath: string): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'file-tree-drag-ghost'
  let body: HTMLElement
  if (IMAGE_EXT_RE.test(name)) {
    const img = document.createElement('img')
    img.src = toMarvinUrl(absolutePath)
    img.className = 'file-tree-drag-thumb'
    body = img
  } else {
    const chip = document.createElement('div')
    chip.className = 'file-tree-drag-chip'
    chip.textContent = name
    body = chip
  }
  wrapper.appendChild(body)
  return wrapper
}

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
const ROW_HEIGHT = 28
const OVERSCAN = 10
const EDGE_ZONE = 50
const SCROLL_SPEED = 12

// Discriminated row used by the virtualizer: a real tree node OR the inline
// create input. The create row is injected into the flat list so the virtualizer
// owns positioning and we keep <ul role="tree"> as the sole scroll container.
type VirtualRow =
  | { kind: 'node'; item: FlatTreeItem }
  | { kind: 'create'; depth: number; createKind: 'file' | 'folder'; parentDir: string }

function isMarkdown(name: string): boolean {
  return name.endsWith('.md') || name.endsWith('.markdown')
}

// True when destDir would be inside src (so dropping src into destDir creates a cycle).
function isDescendantOf(destDir: string, src: string): boolean {
  return destDir === src || destDir.startsWith(`${src}/`)
}

// Build the virtual rows list: flat items + injected create sentinel at the
// correct position. When parent === vaultPath the sentinel goes at index 0;
// otherwise it goes immediately after the parent's flat item (parent must be
// open for it to be visible — auto-expand effect below handles that).
function buildVirtualRows(
  items: FlatTreeItem[],
  vaultPath: string,
  creatingIn: CreatingIn | null,
): VirtualRow[] {
  const rows: VirtualRow[] = items.map((item) => ({ kind: 'node', item }))
  if (!creatingIn) return rows
  if (creatingIn.parentDir === vaultPath) {
    return [
      { kind: 'create', depth: 0, createKind: creatingIn.kind, parentDir: creatingIn.parentDir },
      ...rows,
    ]
  }
  const parentIdx = items.findIndex((it) => it.node.path === creatingIn.parentDir)
  if (parentIdx === -1) return rows
  const parentDepth = items[parentIdx].depth
  const next = rows.slice()
  next.splice(parentIdx + 1, 0, {
    kind: 'create',
    depth: parentDepth + 1,
    createKind: creatingIn.kind,
    parentDir: creatingIn.parentDir,
  })
  return next
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
  const [hoveredPath, setHoveredPath] = useState<string | null>(null)
  const iconTheme = useSetting('iconTheme') ?? 'codicon'

  // Auto-expand the parent folder when an inline create starts in a closed one.
  useEffect(() => {
    if (!creatingIn) return
    if (creatingIn.parentDir === vaultPath) return
    if (openPaths.has(creatingIn.parentDir)) return
    onToggleOpen(creatingIn.parentDir)
  }, [creatingIn, openPaths, vaultPath, onToggleOpen])

  const items = useMemo(() => flattenVisibleTree(nodes, openPaths), [nodes, openPaths])
  const rows = useMemo(
    () => buildVirtualRows(items, vaultPath, creatingIn ?? null),
    [items, vaultPath, creatingIn],
  )

  const scrollRef = useRef<HTMLUListElement | null>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  })

  // Auto-scroll on drag-near-edge state. rafIdRef holds the pending frame id
  // (null when no frame is scheduled). scrollDeltaRef is the per-frame pixel
  // delta (negative=up, positive=down, 0=cursor outside edge zones).
  const rafIdRef = useRef<number | null>(null)
  const scrollDeltaRef = useRef(0)

  const cancelAutoScroll = () => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    scrollDeltaRef.current = 0
  }

  const tickAutoScroll = () => {
    rafIdRef.current = null
    const el = scrollRef.current
    const delta = scrollDeltaRef.current
    if (!el || delta === 0) return
    el.scrollTop += delta
  }

  const maybeAutoScroll = (clientY: number) => {
    const el = scrollRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const distFromTop = clientY - rect.top
    const distFromBottom = rect.bottom - clientY
    let delta = 0
    if (distFromTop >= 0 && distFromTop < EDGE_ZONE) {
      delta = -SCROLL_SPEED
    } else if (distFromBottom >= 0 && distFromBottom < EDGE_ZONE) {
      delta = SCROLL_SPEED
    }
    scrollDeltaRef.current = delta
    if (delta !== 0 && rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(tickAutoScroll)
    }
  }

  // Capture-phase listener so we still see dragover events even when child
  // rows call stopPropagation in their bubble-phase onDragOver handlers.
  const handleRootDragOverCapture = (e: React.DragEvent) => {
    const types = e.dataTransfer.types
    if (!types.includes(DRAG_MIME) && !types.includes('Files')) return
    maybeAutoScroll(e.clientY)
  }

  // Cancel auto-scroll on any drag termination signal. dragend on the source
  // element doesn't necessarily bubble here, so we also listen on window.
  useEffect(() => {
    const onDragEnd = () => cancelAutoScroll()
    window.addEventListener('dragend', onDragEnd)
    window.addEventListener('drop', onDragEnd)
    return () => {
      window.removeEventListener('dragend', onDragEnd)
      window.removeEventListener('drop', onDragEnd)
      cancelAutoScroll()
    }
  }, [])

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
    cancelAutoScroll()
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

  const virtualItems = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  return (
    <ul
      ref={scrollRef}
      className={`file-tree${rootHover ? ' drop-root' : ''}`}
      role="tree"
      aria-label="File tree"
      onClick={(e) => {
        if (e.target === e.currentTarget) onSelectFolder(null)
      }}
      onDragOverCapture={handleRootDragOverCapture}
      onDragOver={handleRootDragOver}
      onDragLeave={(e) => {
        setRootHover(false)
        // Only cancel auto-scroll when the cursor actually leaves the tree
        // container (relatedTarget is null or outside scrollRef).
        const related = e.relatedTarget as Node | null
        if (!related || !scrollRef.current?.contains(related)) {
          cancelAutoScroll()
        }
      }}
      onDrop={handleRootDrop}
    >
      <div
        style={{
          height: totalSize,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((v) => {
          const row = rows[v.index]
          const style: React.CSSProperties = {
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${v.start}px)`,
          }
          if (row.kind === 'create') {
            return (
              <InlineCreateRow
                key={`__create__${row.parentDir}`}
                depth={row.depth}
                kind={row.createKind}
                parentDir={row.parentDir}
                onCreatingInChange={onCreatingInChange}
                style={style}
              />
            )
          }
          const { item } = row
          return (
            <FileTreeNode
              key={item.node.path}
              item={item}
              style={style}
              selectedPath={selectedPath}
              selectedFolderPath={selectedFolderPath}
              openPaths={openPaths}
              creatingIn={creatingIn ?? null}
              hoveredPath={hoveredPath}
              iconTheme={iconTheme}
              onToggleOpen={onToggleOpen}
              onSelect={onSelect}
              onSelectFolder={onSelectFolder}
              onCreatingInChange={onCreatingInChange}
              onContextMenu={onContextMenu}
              onMove={onMove}
              onHoverChange={setHoveredPath}
              onImportResult={onImportResult}
            />
          )
        })}
      </div>
    </ul>
  )
}

type FileTreeNodeProps = {
  item: FlatTreeItem
  style: React.CSSProperties
  selectedPath: string | null
  selectedFolderPath: string | null
  openPaths: Set<string>
  creatingIn: CreatingIn | null
  hoveredPath: string | null
  iconTheme: string
  onToggleOpen: (path: string) => void
  onSelect: (node: FileNode) => void
  onSelectFolder: (path: string | null) => void
  onCreatingInChange: (value: CreatingIn | null) => void
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void
  onMove: (srcPath: string, destDir: string) => void
  onHoverChange: (path: string | null) => void
  onImportResult?: (outcome: ImportOutcome) => void
}

// Custom equality for FileTreeNode. Compares DERIVED booleans for openPaths,
// selectedPath, selectedFolderPath, hoveredPath, and creatingIn against this
// node's own path — not the raw values. Raw comparison would invalidate every
// node on any hover/toggle/select, cascading O(n) re-renders on every interaction
// (the exact trap documented in issue #266; perf goal in issue #255).
function areEqual(prev: FileTreeNodeProps, next: FileTreeNodeProps): boolean {
  if (prev.item.node !== next.item.node) return false
  if (prev.item.depth !== next.item.depth) return false
  if (prev.item.posinset !== next.item.posinset) return false
  if (prev.item.setsize !== next.item.setsize) return false
  if (prev.iconTheme !== next.iconTheme) return false

  // Virtualizer reassigns translateY whenever this row scrolls; the transform
  // is part of the inline style so identity is unstable. Compare the resolved
  // transform string instead of the style object.
  if (prev.style.transform !== next.style.transform) return false

  const prevPath = prev.item.node.path
  const nextPath = next.item.node.path

  // Derived: isOpen
  if (prev.openPaths.has(prevPath) !== next.openPaths.has(nextPath)) return false
  // Derived: isSelected
  if ((prev.selectedPath === prevPath) !== (next.selectedPath === nextPath)) return false
  // Derived: isFolderSelected
  const prevFolderSel = prev.item.node.isDir && prev.selectedFolderPath === prevPath
  const nextFolderSel = next.item.node.isDir && next.selectedFolderPath === nextPath
  if (prevFolderSel !== nextFolderSel) return false
  // Derived: isHovered
  if ((prev.hoveredPath === prevPath) !== (next.hoveredPath === nextPath)) return false
  // Derived: hosts the inline-create row (must also compare kind when host)
  const prevHostsCreate = prev.creatingIn?.parentDir === prevPath
  const nextHostsCreate = next.creatingIn?.parentDir === nextPath
  if (prevHostsCreate !== nextHostsCreate) return false
  if (prevHostsCreate && prev.creatingIn?.kind !== next.creatingIn?.kind) return false

  // Handlers — all wrapped in useCallback at root (issue #251) or are stable
  // setState/setLocalState refs. Identity compare is sufficient.
  if (prev.onToggleOpen !== next.onToggleOpen) return false
  if (prev.onSelect !== next.onSelect) return false
  if (prev.onSelectFolder !== next.onSelectFolder) return false
  if (prev.onCreatingInChange !== next.onCreatingInChange) return false
  if (prev.onContextMenu !== next.onContextMenu) return false
  if (prev.onMove !== next.onMove) return false
  if (prev.onHoverChange !== next.onHoverChange) return false
  if (prev.onImportResult !== next.onImportResult) return false

  return true
}

const FileTreeNode = memo(FileTreeNodeImpl, areEqual)

function FileTreeNodeImpl({
  item,
  style,
  selectedPath,
  selectedFolderPath,
  openPaths,
  hoveredPath,
  iconTheme,
  onToggleOpen,
  onSelect,
  onSelectFolder,
  onContextMenu,
  onMove,
  onHoverChange,
  onImportResult,
}: FileTreeNodeProps) {
  const { node, depth, posinset, setsize } = item
  const open = openPaths.has(node.path)
  const hovered = hoveredPath === node.path
  const isSelected = selectedPath === node.path
  const isFolderSelected = node.isDir && selectedFolderPath === node.path
  const padding = 8 + depth * 14

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(DRAG_MIME, node.path)
    e.dataTransfer.setData('text/plain', node.path) // fallback
    // 'copyMove' lets the editor accept this drag as a copy (insert link) while
    // the tree's own drop handlers still default to move (rearrange).
    e.dataTransfer.effectAllowed = 'copyMove'
    // Some test environments stub dataTransfer without setDragImage; guard
    // so the production path can use it without breaking unit tests.
    if (typeof e.dataTransfer.setDragImage === 'function') {
      const ghost = buildDragGhost(node.name, node.path)
      document.body.appendChild(ghost)
      // anchor: x ≈ 16px in from the left edge; y = 0 so the wrapper's top
      // sits at the pointer. The wrapper's top padding pushes the visible
      // content below the pointer.
      e.dataTransfer.setDragImage(ghost, 16, 0)
      requestAnimationFrame(() => ghost.remove())
    }
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
      onHoverChange(node.path)
    }
    const handleDrop = (e: React.DragEvent) => {
      // Always suppress Electron's default and stop bubbling before any early return.
      e.preventDefault()
      e.stopPropagation()
      onHoverChange(null)
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
      <li
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={open}
        aria-selected={isSelected}
        aria-posinset={posinset}
        aria-setsize={setsize}
        style={style}
      >
        <button
          type="button"
          className={`file-tree-row dir${hovered ? ' drop-target' : ''}${isFolderSelected ? ' folder-selected' : ''}`}
          style={{ paddingLeft: padding }}
          draggable
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={() => onHoverChange(null)}
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
      style={style}
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
  style,
}: {
  depth: number
  kind: 'file' | 'folder'
  parentDir: string
  onCreatingInChange: (value: CreatingIn | null) => void
  style?: React.CSSProperties
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
      style={{ paddingLeft: padding, ...style }}
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
