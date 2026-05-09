import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileNode } from './types'
import { FileTree } from './components/FileTree'
import { Editor } from './components/Editor'
import { ClaudeTerminal } from './components/ClaudeTerminal'
import { InputDialog } from './components/InputDialog'
import { ContextMenu, type MenuItem } from './components/ContextMenu'
import { SidebarMenu } from './components/SidebarMenu'
import { TabBar } from './components/TabBar'
import { TopBar } from './components/TopBar'
import { CommandPalette, type PaletteItem } from './components/CommandPalette'
import './App.css'

type Tab = {
  id: string
  path: string
  content: string
  version: number
  back: string[]
  forward: string[]
}

type Dialog =
  | { kind: 'newNote'; parentDir: string }
  | { kind: 'newFolder'; parentDir: string }
  | { kind: 'rename'; target: string; isDir: boolean }
  | null

type ContextState = {
  x: number
  y: number
  items: MenuItem[]
} | null

let tabCounter = 0
const newTabId = () => `tab-${++tabCounter}`

function isMarkdownPath(p: string): boolean {
  return /\.(md|markdown)$/i.test(p)
}

function flattenTree(nodes: FileNode[], vaultPath: string): PaletteItem[] {
  const out: PaletteItem[] = []
  const walk = (n: FileNode) => {
    if (n.isDir) {
      n.children?.forEach(walk)
      return
    }
    const rel = n.path.startsWith(vaultPath + '/')
      ? n.path.slice(vaultPath.length + 1)
      : n.path
    out.push({
      path: n.path,
      rel,
      name: n.name,
      isMarkdown: isMarkdownPath(n.name),
    })
  }
  nodes.forEach(walk)
  return out
}

function dirOf(p: string): string {
  const idx = p.lastIndexOf('/')
  return idx >= 0 ? p.slice(0, idx) : p
}

function humanizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const enoent = raw.match(/ENOENT[^']*'([^']+)'/)
  if (enoent) {
    const base = enoent[1].split('/').pop() ?? enoent[1]
    return `File not found: ${base}`
  }
  const eexist = raw.match(/EEXIST[^']*'([^']+)'/)
  if (eexist) {
    const base = eexist[1].split('/').pop() ?? eexist[1]
    return `Already exists: ${base}`
  }
  // Strip the IPC noise prefix
  return raw.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, '')
}

export default function App() {
  const [vaultPath, setVaultPath] = useState<string | null>(null)
  const [tree, setTree] = useState<FileNode[]>([])
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [claudePath, setClaudePath] = useState<string | null>(null)
  const [bootstrapped, setBootstrapped] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [ctx, setCtx] = useState<ContextState>(null)
  const [error, setError] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Tracks last on-disk content per path that we have open. Lets us tell our
  // own saves apart from external writes (claude editing the note).
  const lastDiskContentRef = useRef<Map<string, string>>(new Map())

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  const loadTree = useCallback(async (vp: string) => {
    const t = await window.marvin.vault.tree(vp)
    setTree(t)
  }, [])

  useEffect(() => {
    ;(async () => {
      const settings = await window.marvin.settings.get()
      const detected = await window.marvin.claude.detect()
      setClaudePath(detected)
      if (settings.vaultPath) {
        setVaultPath(settings.vaultPath)
        await loadTree(settings.vaultPath)
        await window.marvin.vault.watch(settings.vaultPath)
      }
      setBootstrapped(true)
    })()
  }, [loadTree])

  useEffect(() => {
    if (!vaultPath) return
    const off = window.marvin.vault.onChanged(() => {
      loadTree(vaultPath)
    })
    return off
  }, [vaultPath, loadTree])

  useEffect(() => {
    const off = window.marvin.file.onChanged(async (filePath) => {
      const last = lastDiskContentRef.current.get(filePath)
      if (last == null) return
      let fresh: string
      try {
        fresh = await window.marvin.file.read(filePath)
      } catch {
        // file may have been deleted concurrently; the unlink handler will close tabs
        return
      }
      if (fresh === last) return
      lastDiskContentRef.current.set(filePath, fresh)
      setTabs((prev) =>
        prev.map((t) =>
          t.path === filePath ? { ...t, content: fresh, version: t.version + 1 } : t,
        ),
      )
    })
    return off
  }, [])

  const readFreshContent = useCallback(async (path: string): Promise<string> => {
    const content = await window.marvin.file.read(path)
    lastDiskContentRef.current.set(path, content)
    return content
  }, [])

  const paletteItems = useMemo<PaletteItem[]>(
    () => (vaultPath ? flattenTree(tree, vaultPath) : []),
    [tree, vaultPath],
  )

  // Global Cmd+P to open the file palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCmd = e.metaKey || e.ctrlKey
      if (isCmd && !e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        if (!vaultPath) return
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [vaultPath])

  const handlePickVault = async () => {
    const picked = await window.marvin.vault.pick()
    if (!picked) return
    setVaultPath(picked)
    setTabs([])
    setActiveTabId(null)
    lastDiskContentRef.current.clear()
    await loadTree(picked)
    await window.marvin.vault.watch(picked)
  }

  // Open a path. If a tab already shows it, focus that tab. Otherwise create a new one.
  const openInTab = useCallback(
    async (path: string) => {
      if (!isMarkdownPath(path)) return
      const existing = tabs.find((t) => t.path === path)
      if (existing) {
        setActiveTabId(existing.id)
        return
      }
      try {
        const content = await readFreshContent(path)
        const id = newTabId()
        setTabs((prev) => [
          ...prev,
          { id, path, content, version: 0, back: [], forward: [] },
        ])
        setActiveTabId(id)
      } catch (err) {
        reportError(err)
      }
    },
    [tabs, readFreshContent],
  )

  // Navigate within the active tab (used by link clicks in markdown preview).
  // Pushes current path onto back stack, clears forward.
  const navigateInActiveTab = useCallback(
    async (path: string) => {
      if (!activeTab) {
        await openInTab(path)
        return
      }
      if (!isMarkdownPath(path)) return
      if (path === activeTab.path) return
      try {
        const content = await readFreshContent(path)
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTab.id
              ? {
                  ...t,
                  path,
                  content,
                  version: 0,
                  back: [...t.back, t.path],
                  forward: [],
                }
              : t,
          ),
        )
      } catch (err) {
        reportError(err)
      }
    },
    [activeTab, openInTab, readFreshContent],
  )

  const goBack = useCallback(async () => {
    if (!activeTab || activeTab.back.length === 0) return
    const target = activeTab.back[activeTab.back.length - 1]
    try {
      const content = await readFreshContent(target)
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTab.id
            ? {
                ...t,
                path: target,
                content,
                version: 0,
                back: t.back.slice(0, -1),
                forward: [...t.forward, t.path],
              }
            : t,
        ),
      )
    } catch (err) {
      reportError(err)
    }
  }, [activeTab, readFreshContent])

  const goForward = useCallback(async () => {
    if (!activeTab || activeTab.forward.length === 0) return
    const target = activeTab.forward[activeTab.forward.length - 1]
    try {
      const content = await readFreshContent(target)
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTab.id
            ? {
                ...t,
                path: target,
                content,
                version: 0,
                back: [...t.back, t.path],
                forward: t.forward.slice(0, -1),
              }
            : t,
        ),
      )
    } catch (err) {
      reportError(err)
    }
  }, [activeTab, readFreshContent])

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id)
        if (idx === -1) return prev
        const next = prev.filter((t) => t.id !== id)
        // pick neighbor as new active if we closed the active one
        if (activeTabId === id) {
          const neighbor = next[idx] ?? next[idx - 1] ?? null
          setActiveTabId(neighbor ? neighbor.id : null)
        }
        return next
      })
    },
    [activeTabId],
  )

  const handleSelectFile = (node: FileNode) => {
    if (node.isDir) return
    void openInTab(node.path)
  }

  const handlePalettePick = useCallback(
    async (item: PaletteItem, replaceCurrent: boolean) => {
      setPaletteOpen(false)
      if (item.isMarkdown) {
        if (replaceCurrent && activeTab) {
          await navigateInActiveTab(item.path)
        } else {
          await openInTab(item.path)
        }
      } else {
        // Non-markdown files don't open inline; surface them in Finder so the
        // user can hand them off to the system default app.
        try {
          await window.marvin.shell.reveal(item.path)
        } catch (err) {
          reportError(err)
        }
      }
    },
    [activeTab, navigateInActiveTab, openInTab],
  )

  const handleSave = useCallback(
    async (content: string) => {
      if (!activeTab) return
      await window.marvin.file.write(activeTab.path, content)
      lastDiskContentRef.current.set(activeTab.path, content)
    },
    [activeTab],
  )

  const reportError = (err: unknown) => {
    setError(humanizeError(err))
  }

  const renameInTabs = (oldPath: string, newPath: string) => {
    setTabs((prev) =>
      prev.map((t) => {
        let path = t.path
        if (path === oldPath) path = newPath
        else if (path.startsWith(`${oldPath}/`)) path = newPath + path.slice(oldPath.length)
        const back = t.back.map((p) =>
          p === oldPath ? newPath : p.startsWith(`${oldPath}/`) ? newPath + p.slice(oldPath.length) : p,
        )
        const forward = t.forward.map((p) =>
          p === oldPath ? newPath : p.startsWith(`${oldPath}/`) ? newPath + p.slice(oldPath.length) : p,
        )
        return path === t.path && back === t.back && forward === t.forward
          ? t
          : { ...t, path, back, forward }
      }),
    )
    // remap tracked content
    const tracked = lastDiskContentRef.current
    for (const [k, v] of Array.from(tracked.entries())) {
      if (k === oldPath) {
        tracked.delete(k)
        tracked.set(newPath, v)
      } else if (k.startsWith(`${oldPath}/`)) {
        tracked.delete(k)
        tracked.set(newPath + k.slice(oldPath.length), v)
      }
    }
  }

  const closeTabsUnder = (root: string) => {
    setTabs((prev) => {
      const remaining = prev.filter(
        (t) => t.path !== root && !t.path.startsWith(`${root}/`),
      )
      if (
        activeTabId &&
        !remaining.find((t) => t.id === activeTabId)
      ) {
        setActiveTabId(remaining[0]?.id ?? null)
      }
      return remaining
    })
    const tracked = lastDiskContentRef.current
    for (const k of Array.from(tracked.keys())) {
      if (k === root || k.startsWith(`${root}/`)) tracked.delete(k)
    }
  }

  const handleCreate = async (name: string) => {
    if (!dialog || !vaultPath) return
    const d = dialog
    setDialog(null)
    try {
      if (d.kind === 'newNote') {
        const newPath = await window.marvin.file.create(d.parentDir, name)
        await loadTree(vaultPath)
        await openInTab(newPath)
      } else if (d.kind === 'newFolder') {
        await window.marvin.folder.create(d.parentDir, name)
        await loadTree(vaultPath)
      } else if (d.kind === 'rename') {
        const newPath = `${dirOf(d.target)}/${name}`
        await window.marvin.path.rename(d.target, newPath)
        renameInTabs(d.target, newPath)
        await loadTree(vaultPath)
      }
    } catch (err) {
      reportError(err)
    }
  }

  const handleTrash = async (target: string) => {
    if (!vaultPath) return
    try {
      await window.marvin.path.trash(target)
      closeTabsUnder(target)
      await loadTree(vaultPath)
    } catch (err) {
      reportError(err)
    }
  }

  // Drag-and-drop: move src into destDir via rename.
  const handleDropMove = async (srcPath: string, destDir: string) => {
    if (!vaultPath) return
    if (srcPath === destDir) return
    if (destDir.startsWith(`${srcPath}/`) || destDir === srcPath) return // dest is descendant of src
    const baseName = srcPath.split('/').pop() ?? srcPath
    const newPath = `${destDir}/${baseName}`
    if (newPath === srcPath) return // same parent
    try {
      await window.marvin.path.rename(srcPath, newPath)
      renameInTabs(srcPath, newPath)
      await loadTree(vaultPath)
    } catch (err) {
      reportError(err)
    }
  }

  const handleNodeContextMenu = (e: React.MouseEvent, node: FileNode) => {
    e.preventDefault()
    e.stopPropagation()
    const items: MenuItem[] = []
    if (node.isDir) {
      items.push(
        {
          kind: 'item',
          label: 'New note here',
          onClick: () => setDialog({ kind: 'newNote', parentDir: node.path }),
        },
        {
          kind: 'item',
          label: 'New folder here',
          onClick: () => setDialog({ kind: 'newFolder', parentDir: node.path }),
        },
        { kind: 'separator' },
      )
    }
    items.push(
      {
        kind: 'item',
        label: 'Rename',
        onClick: () => setDialog({ kind: 'rename', target: node.path, isDir: node.isDir }),
      },
      {
        kind: 'item',
        label: 'Reveal in Finder',
        onClick: () => void window.marvin.shell.reveal(node.path),
      },
      { kind: 'separator' },
      {
        kind: 'item',
        label: node.isDir ? 'Move folder to Trash' : 'Move file to Trash',
        danger: true,
        onClick: () => handleTrash(node.path),
      },
    )
    setCtx({ x: e.clientX, y: e.clientY, items })
  }

  if (!bootstrapped) {
    return <div className="bootstrap">Loading…</div>
  }

  if (!vaultPath) {
    return (
      <div className="welcome">
        <h1>Marvin</h1>
        <p>Markdown notes with Claude Code in your sidebar.</p>
        <button type="button" onClick={handlePickVault}>
          Open vault folder
        </button>
      </div>
    )
  }

  const dialogConfig = (() => {
    if (!dialog) return null
    if (dialog.kind === 'newNote') {
      return { title: 'New note', placeholder: 'note-name', submit: 'Create', initial: '' }
    }
    if (dialog.kind === 'newFolder') {
      return { title: 'New folder', placeholder: 'folder-name', submit: 'Create', initial: '' }
    }
    return {
      title: dialog.isDir ? 'Rename folder' : 'Rename file',
      placeholder: '',
      submit: 'Rename',
      initial: dialog.target.split('/').pop() ?? '',
    }
  })()

  return (
    <div className="shell">
      <TopBar onOpenPalette={() => setPaletteOpen(true)} />
      <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="vault-name">{vaultPath.split('/').pop()}</span>
          <SidebarMenu
            onNewNote={() => setDialog({ kind: 'newNote', parentDir: vaultPath })}
            onNewFolder={() => setDialog({ kind: 'newFolder', parentDir: vaultPath })}
          />
        </div>
        <FileTree
          nodes={tree}
          vaultPath={vaultPath}
          selectedPath={activeTab?.path ?? null}
          onSelect={handleSelectFile}
          onContextMenu={handleNodeContextMenu}
          onMove={handleDropMove}
        />
        <div className="sidebar-footer">
          <button type="button" className="text-btn" onClick={handlePickVault}>
            Switch vault
          </button>
        </div>
      </aside>

      <main className="editor-pane">
        <TabBar
          tabs={tabs}
          activeId={activeTabId}
          onActivate={setActiveTabId}
          onClose={closeTab}
        />
        {activeTab ? (
          <Editor
            key={`${activeTab.id}#${activeTab.path}#${activeTab.version}`}
            filePath={activeTab.path}
            vaultPath={vaultPath}
            initialContent={activeTab.content}
            onSave={handleSave}
            onOpenNote={navigateInActiveTab}
            canBack={activeTab.back.length > 0}
            canForward={activeTab.forward.length > 0}
            onBack={goBack}
            onForward={goForward}
          />
        ) : (
          <div className="empty-editor">Select a note or create a new one.</div>
        )}
      </main>

      <aside className="claude-pane">
        <ClaudeTerminal vaultPath={vaultPath} claudePath={claudePath} />
      </aside>

      {dialog && dialogConfig && (
        <InputDialog
          title={dialogConfig.title}
          placeholder={dialogConfig.placeholder}
          initialValue={dialogConfig.initial}
          submitLabel={dialogConfig.submit}
          onSubmit={handleCreate}
          onCancel={() => setDialog(null)}
        />
      )}

      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          items={ctx.items}
          onClose={() => setCtx(null)}
        />
      )}

      {error && (
        <div className="error-toast" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {paletteOpen && (
        <CommandPalette
          items={paletteItems}
          onPick={handlePalettePick}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      </div>
    </div>
  )
}
