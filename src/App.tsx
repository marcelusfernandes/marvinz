import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileNode } from './types'
import { FileTree } from './components/FileTree'
import { Editor } from './components/Editor'
import { ClaudeTerminal } from './components/ClaudeTerminal'
import { InputDialog } from './components/InputDialog'
import { ContextMenu, type MenuItem } from './components/ContextMenu'
import { SidebarMenu } from './components/SidebarMenu'
import './App.css'

type LoadedFile = { path: string; content: string; version: number }

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

export default function App() {
  const [vaultPath, setVaultPath] = useState<string | null>(null)
  const [tree, setTree] = useState<FileNode[]>([])
  const [active, setActive] = useState<LoadedFile | null>(null)
  const [claudePath, setClaudePath] = useState<string | null>(null)
  const [bootstrapped, setBootstrapped] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [ctx, setCtx] = useState<ContextState>(null)
  const [error, setError] = useState<string | null>(null)

  const knownDiskContentRef = useRef<{ path: string; content: string } | null>(null)

  const loadTree = useCallback(async (vp: string) => {
    const t = await window.obsclone.vault.tree(vp)
    setTree(t)
  }, [])

  useEffect(() => {
    ;(async () => {
      const settings = await window.obsclone.settings.get()
      const detected = await window.obsclone.claude.detect()
      setClaudePath(detected)
      if (settings.vaultPath) {
        setVaultPath(settings.vaultPath)
        await loadTree(settings.vaultPath)
        await window.obsclone.vault.watch(settings.vaultPath)
      }
      setBootstrapped(true)
    })()
  }, [loadTree])

  useEffect(() => {
    if (!vaultPath) return
    const off = window.obsclone.vault.onChanged(() => {
      loadTree(vaultPath)
      setActive((curr) => {
        if (!curr) return null
        // active file may have been deleted/renamed externally; if so, drop it
        // (we'll just check on next render via existsSync server-side if needed)
        return curr
      })
    })
    return off
  }, [vaultPath, loadTree])

  useEffect(() => {
    const off = window.obsclone.file.onChanged(async (filePath) => {
      const known = knownDiskContentRef.current
      if (!known || known.path !== filePath) return
      const fresh = await window.obsclone.file.read(filePath)
      if (fresh === known.content) return
      knownDiskContentRef.current = { path: filePath, content: fresh }
      setActive((curr) =>
        curr && curr.path === filePath
          ? { path: filePath, content: fresh, version: curr.version + 1 }
          : curr,
      )
    })
    return off
  }, [])

  const handlePickVault = async () => {
    const picked = await window.obsclone.vault.pick()
    if (!picked) return
    setVaultPath(picked)
    setActive(null)
    knownDiskContentRef.current = null
    await loadTree(picked)
    await window.obsclone.vault.watch(picked)
  }

  const openNote = useCallback(async (notePath: string) => {
    const content = await window.obsclone.file.read(notePath)
    knownDiskContentRef.current = { path: notePath, content }
    setActive({ path: notePath, content, version: 0 })
  }, [])

  const handleSelectFile = async (node: FileNode) => {
    if (node.isDir) return
    if (!/\.(md|markdown)$/i.test(node.name)) return
    await openNote(node.path)
  }

  const handleSave = useCallback(
    async (content: string) => {
      if (!active) return
      await window.obsclone.file.write(active.path, content)
      knownDiskContentRef.current = { path: active.path, content }
    },
    [active],
  )

  const reportError = (err: unknown) => {
    setError(err instanceof Error ? err.message : String(err))
  }

  const handleCreate = async (name: string) => {
    if (!dialog || !vaultPath) return
    const d = dialog
    setDialog(null)
    try {
      if (d.kind === 'newNote') {
        const newPath = await window.obsclone.file.create(d.parentDir, name)
        await loadTree(vaultPath)
        await openNote(newPath)
      } else if (d.kind === 'newFolder') {
        await window.obsclone.folder.create(d.parentDir, name)
        await loadTree(vaultPath)
      } else if (d.kind === 'rename') {
        const dir = d.target.replace(/\/[^/]+$/, '')
        const newPath = `${dir}/${name}`
        await window.obsclone.path.rename(d.target, newPath)
        await loadTree(vaultPath)
        if (active && active.path === d.target) {
          await openNote(newPath)
        } else if (active && active.path.startsWith(`${d.target}/`)) {
          // active was inside a renamed folder
          const next = newPath + active.path.slice(d.target.length)
          await openNote(next)
        }
      }
    } catch (err) {
      reportError(err)
    }
  }

  const handleTrash = async (target: string) => {
    if (!vaultPath) return
    try {
      await window.obsclone.path.trash(target)
      await loadTree(vaultPath)
      if (active && (active.path === target || active.path.startsWith(`${target}/`))) {
        setActive(null)
        knownDiskContentRef.current = null
      }
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
        onClick: () => void window.obsclone.shell.reveal(node.path),
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
        <h1>obsclone</h1>
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
          selectedPath={active?.path ?? null}
          onSelect={handleSelectFile}
          onContextMenu={handleNodeContextMenu}
        />
        <div className="sidebar-footer">
          <button type="button" className="text-btn" onClick={handlePickVault}>
            Switch vault
          </button>
        </div>
      </aside>

      <main className="editor-pane">
        {active ? (
          <Editor
            key={`${active.path}#${active.version}`}
            filePath={active.path}
            vaultPath={vaultPath}
            initialContent={active.content}
            onSave={handleSave}
            onOpenNote={openNote}
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
    </div>
  )
}
