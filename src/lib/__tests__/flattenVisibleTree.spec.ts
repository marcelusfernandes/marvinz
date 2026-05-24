import { describe, it, expect } from 'vitest'
import type { FileNode } from '../../types'
import { flattenVisibleTree } from '../flattenVisibleTree'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function file(path: string): FileNode {
  const name = path.split('/').pop()!
  return { name, path, isDir: false }
}

function dir(path: string, children?: FileNode[]): FileNode {
  const name = path.split('/').pop()!
  return { name, path, isDir: true, children }
}

// ---------------------------------------------------------------------------
// Empty tree
// ---------------------------------------------------------------------------

describe('flattenVisibleTree — empty tree', () => {
  it('returns [] for an empty node list', () => {
    expect(flattenVisibleTree([], new Set())).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Single file
// ---------------------------------------------------------------------------

describe('flattenVisibleTree — single file', () => {
  it('returns 1 item with depth=0, posinset=1, setsize=1', () => {
    const nodes = [file('/vault/note.md')]
    expect(flattenVisibleTree(nodes, new Set())).toEqual([
      { node: nodes[0], depth: 0, posinset: 1, setsize: 1 },
    ])
  })
})

// ---------------------------------------------------------------------------
// Closed folder
// ---------------------------------------------------------------------------

describe('flattenVisibleTree — closed folder', () => {
  it('emits only the folder; children are NOT included', () => {
    const child = file('/vault/docs/readme.md')
    const folder = dir('/vault/docs', [child])
    const result = flattenVisibleTree([folder], new Set())
    expect(result).toEqual([
      { node: folder, depth: 0, posinset: 1, setsize: 1 },
    ])
    expect(result).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Open folder with 2 files
// ---------------------------------------------------------------------------

describe('flattenVisibleTree — open folder with 2 files', () => {
  it('emits 3 items: folder + 2 files with correct depth/posinset/setsize', () => {
    const a = file('/vault/docs/a.md')
    const b = file('/vault/docs/b.md')
    const folder = dir('/vault/docs', [a, b])
    const openPaths = new Set(['/vault/docs'])

    expect(flattenVisibleTree([folder], openPaths)).toEqual([
      { node: folder, depth: 0, posinset: 1, setsize: 1 },
      { node: a, depth: 1, posinset: 1, setsize: 2 },
      { node: b, depth: 1, posinset: 2, setsize: 2 },
    ])
  })
})

// ---------------------------------------------------------------------------
// Nested 3 levels deep — mixed files + folders
// ---------------------------------------------------------------------------

describe('flattenVisibleTree — nested 3 levels deep', () => {
  it('emits all visible items with correct posinset/setsize per level', () => {
    //
    // Structure (all folders open):
    //   /vault/          (root, not a node itself)
    //   ├── docs/        depth=0, posinset=1, setsize=2
    //   │   ├── intro.md depth=1, posinset=1, setsize=2
    //   │   └── api/     depth=1, posinset=2, setsize=2
    //   │       └── ref.md depth=2, posinset=1, setsize=1
    //   └── images/      depth=0, posinset=2, setsize=2
    //       (closed — no children emitted)
    //
    const ref = file('/vault/docs/api/ref.md')
    const api = dir('/vault/docs/api', [ref])
    const intro = file('/vault/docs/intro.md')
    const docs = dir('/vault/docs', [intro, api])
    const images = dir('/vault/images', [file('/vault/images/photo.png')])

    const openPaths = new Set(['/vault/docs', '/vault/docs/api'])

    expect(flattenVisibleTree([docs, images], openPaths)).toEqual([
      { node: docs, depth: 0, posinset: 1, setsize: 2 },
      { node: intro, depth: 1, posinset: 1, setsize: 2 },
      { node: api, depth: 1, posinset: 2, setsize: 2 },
      { node: ref, depth: 2, posinset: 1, setsize: 1 },
      { node: images, depth: 0, posinset: 2, setsize: 2 },
    ])
  })
})

// ---------------------------------------------------------------------------
// Deterministic
// ---------------------------------------------------------------------------

describe('flattenVisibleTree — deterministic', () => {
  it('produces the same output for two identical calls', () => {
    const child = file('/vault/docs/a.md')
    const folder = dir('/vault/docs', [child])
    const openPaths = new Set(['/vault/docs'])

    const first = flattenVisibleTree([folder], openPaths)
    const second = flattenVisibleTree([folder], openPaths)
    expect(first).toEqual(second)
  })
})

// ---------------------------------------------------------------------------
// Edge case: open folder with no children (undefined or [])
// ---------------------------------------------------------------------------

describe('flattenVisibleTree — open folder with no children', () => {
  it('emits only the folder when children is undefined', () => {
    const folder = dir('/vault/empty')
    const result = flattenVisibleTree([folder], new Set(['/vault/empty']))
    expect(result).toEqual([
      { node: folder, depth: 0, posinset: 1, setsize: 1 },
    ])
  })

  it('emits only the folder when children is []', () => {
    const folder = dir('/vault/empty', [])
    const result = flattenVisibleTree([folder], new Set(['/vault/empty']))
    expect(result).toEqual([
      { node: folder, depth: 0, posinset: 1, setsize: 1 },
    ])
  })
})

// ---------------------------------------------------------------------------
// Edge case: openPaths contains a path not present in the tree
// ---------------------------------------------------------------------------

describe('flattenVisibleTree — openPaths with non-existent path', () => {
  it('ignores paths in openPaths that do not exist in the tree', () => {
    const node = file('/vault/note.md')
    const openPaths = new Set(['/vault/ghost-folder'])

    expect(flattenVisibleTree([node], openPaths)).toEqual([
      { node, depth: 0, posinset: 1, setsize: 1 },
    ])
  })
})
