import type { FileNode } from '../../types'

// ---------------------------------------------------------------------------
// smallTree — 2 folders × children + 1 root file
// ---------------------------------------------------------------------------

export const smallTree: FileNode[] = [
  {
    path: '/vault/docs',
    name: 'docs',
    isDir: true,
    children: [
      { path: '/vault/docs/intro.md', name: 'intro.md', isDir: false, children: [] },
      { path: '/vault/docs/guide.md', name: 'guide.md', isDir: false, children: [] },
    ],
  },
  {
    path: '/vault/assets',
    name: 'assets',
    isDir: true,
    children: [{ path: '/vault/assets/logo.png', name: 'logo.png', isDir: false, children: [] }],
  },
  { path: '/vault/readme.md', name: 'readme.md', isDir: false, children: [] },
]

// ---------------------------------------------------------------------------
// generateLargeTree — deterministic large tree for perf-adjacent tests
// ---------------------------------------------------------------------------

export function generateLargeTree(
  folderCount: number,
  depth: number,
  filesPerFolder: number
): FileNode[] {
  function buildFolder(basePath: string, name: string, currentDepth: number): FileNode {
    const folderPath = `${basePath}/${name}`
    const files: FileNode[] = Array.from({ length: filesPerFolder }, (_, fi) => ({
      path: `${folderPath}/file-${fi}.md`,
      name: `file-${fi}.md`,
      isDir: false,
      children: [],
    }))
    const subfolders: FileNode[] =
      currentDepth < depth
        ? Array.from({ length: 2 }, (_, si) =>
            buildFolder(folderPath, `sub-${si}`, currentDepth + 1)
          )
        : []
    return {
      path: folderPath,
      name,
      isDir: true,
      children: [...subfolders, ...files],
    }
  }

  return Array.from({ length: folderCount }, (_, i) => buildFolder('/vault', `folder-${i}`, 1))
}
