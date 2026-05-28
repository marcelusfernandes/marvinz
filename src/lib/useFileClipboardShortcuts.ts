import { useEffect } from 'react'
import type { FileNode } from '../types'
import { useClipboardStore } from './clipboardStore'

type Options = {
  vaultPath: string | null
  selectedPaths: Set<string>
  tree: FileNode[]
  onClearSelection: () => void
  onPaste: (target: string) => void | Promise<void>
}

type PasteTarget = { target: string } | { ambiguous: true }

function dirOf(p: string): string {
  const idx = p.lastIndexOf('/')
  return idx >= 0 ? p.slice(0, idx) : p
}

function findNodeByPath(nodes: FileNode[], path: string): FileNode | null {
  for (const n of nodes) {
    if (n.path === path) return n
    if (n.isDir && n.children) {
      const hit = findNodeByPath(n.children, path)
      if (hit) return hit
    }
  }
  return null
}

export function resolvePasteTarget(
  selectedPaths: Set<string>,
  tree: FileNode[],
  vaultPath: string,
): PasteTarget {
  if (selectedPaths.size === 0) return { target: vaultPath }
  if (selectedPaths.size > 1) return { ambiguous: true }
  const [only] = selectedPaths
  const node = findNodeByPath(tree, only)
  if (node?.isDir) return { target: node.path }
  return { target: dirOf(only) }
}

function isEditableTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  return (el as HTMLElement).isContentEditable === true
}

export function useFileClipboardShortcuts(opts: Options): void {
  const { vaultPath, selectedPaths, tree, onClearSelection, onPaste } = opts

  useEffect(() => {
    if (!vaultPath) return
    const onKey = (e: KeyboardEvent) => {
      const isCmd = e.metaKey || e.ctrlKey
      if (isEditableTarget(document.activeElement)) return

      if (e.key === 'Escape') {
        const store = useClipboardStore.getState()
        if (store.mode === null && selectedPaths.size === 0) return
        e.preventDefault()
        store.clear()
        onClearSelection()
        return
      }

      if (!isCmd || e.shiftKey || e.altKey) return
      const key = e.key.toLowerCase()

      if (key === 'c') {
        if (selectedPaths.size === 0) return
        e.preventDefault()
        useClipboardStore.getState().set('copy', Array.from(selectedPaths))
        return
      }

      if (key === 'x') {
        if (selectedPaths.size === 0) return
        e.preventDefault()
        useClipboardStore.getState().set('cut', Array.from(selectedPaths))
        return
      }

      if (key === 'v') {
        const clip = useClipboardStore.getState()
        if (clip.mode === null || clip.paths.size === 0) return
        const resolved = resolvePasteTarget(selectedPaths, tree, vaultPath)
        if ('ambiguous' in resolved) return
        e.preventDefault()
        void onPaste(resolved.target)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [vaultPath, selectedPaths, tree, onClearSelection, onPaste])
}
