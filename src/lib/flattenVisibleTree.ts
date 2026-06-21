import type { FileNode } from '../types'

export type FlatTreeItem = {
  node: FileNode
  depth: number
  posinset: number
  setsize: number
}

/**
 * Depth-first pre-order flatten of the visible subset of a FileNode tree.
 * `depth` is 0-indexed (root level = 0). `posinset` is 1-indexed.
 * `setsize` is the count of siblings at the same level under the same parent.
 * Children of a directory are emitted only when its path is in `openPaths`.
 */
export function flattenVisibleTree(nodes: FileNode[], openPaths: Set<string>): FlatTreeItem[] {
  const out: FlatTreeItem[] = []
  const walk = (siblings: FileNode[], depth: number): void => {
    const setsize = siblings.length
    siblings.forEach((node, index) => {
      out.push({ node, depth, posinset: index + 1, setsize })
      if (node.isDir && openPaths.has(node.path) && node.children && node.children.length > 0) {
        walk(node.children, depth + 1)
      }
    })
  }
  walk(nodes, 0)
  return out
}
