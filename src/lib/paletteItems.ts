import type { FileNode } from '../types'
import type { PaletteItem } from './paletteRanker'

function isMarkdownPath(p: string): boolean {
  return /\.(md|markdown)$/i.test(p)
}

function isClaudeMeta(rel: string): boolean {
  return rel.startsWith('.claude/') || rel.includes('/.claude/')
}

export function flattenTree(
  nodes: FileNode[],
  vaultPath: string,
  opts?: { includeClaudeDir?: boolean }
): PaletteItem[] {
  const includeClaudeDir = opts?.includeClaudeDir ?? false
  const out: PaletteItem[] = []
  const walk = (n: FileNode) => {
    if (n.isDir) {
      n.children?.forEach(walk)
      return
    }
    const rel = n.path.startsWith(vaultPath + '/') ? n.path.slice(vaultPath.length + 1) : n.path
    if (!includeClaudeDir && isClaudeMeta(rel)) return
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
