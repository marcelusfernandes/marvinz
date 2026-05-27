import { describe, it, expect } from 'vitest'
import type { FileNode } from '../../types'
import { flattenTree } from '../paletteItems'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VAULT = '/vault'

function file(path: string): FileNode {
  return { name: path.split('/').pop()!, path, isDir: false }
}

function dir(path: string, children: FileNode[]): FileNode {
  return { name: path.split('/').pop()!, path, isDir: true, children }
}

// ---------------------------------------------------------------------------
// flattenTree — .claude/ filter
// ---------------------------------------------------------------------------

describe('flattenTree', () => {
  it('returns vault files and skips .claude/ files', () => {
    const nodes: FileNode[] = [
      file(`${VAULT}/note.md`),
      dir(`${VAULT}/.claude`, [
        file(`${VAULT}/.claude/agents/bot.md`),
      ]),
    ]
    const result = flattenTree(nodes, VAULT)
    expect(result.map((i) => i.rel)).toEqual(['note.md'])
  })

  it('skips nested .claude/ subdirs entirely', () => {
    const nodes: FileNode[] = [
      dir(`${VAULT}/.claude`, [
        dir(`${VAULT}/.claude/agents`, [
          file(`${VAULT}/.claude/agents/react.md`),
          file(`${VAULT}/.claude/agents/electron-pro.md`),
        ]),
        dir(`${VAULT}/.claude/commands`, [
          file(`${VAULT}/.claude/commands/import.md`),
        ]),
      ]),
      file(`${VAULT}/my-note.md`),
    ]
    const result = flattenTree(nodes, VAULT)
    expect(result).toHaveLength(1)
    expect(result[0].rel).toBe('my-note.md')
  })

  it('includes non-.claude dirs normally', () => {
    const nodes: FileNode[] = [
      dir(`${VAULT}/projects`, [
        file(`${VAULT}/projects/alpha.md`),
        file(`${VAULT}/projects/beta.md`),
      ]),
    ]
    const result = flattenTree(nodes, VAULT)
    expect(result.map((i) => i.rel)).toEqual(['projects/alpha.md', 'projects/beta.md'])
  })

  it('sets rel as vault-relative path with correct name and abs path', () => {
    const nodes: FileNode[] = [file(`${VAULT}/docs/readme.md`)]
    const result = flattenTree(nodes, VAULT)
    expect(result[0].rel).toBe('docs/readme.md')
    expect(result[0].path).toBe(`${VAULT}/docs/readme.md`)
    expect(result[0].name).toBe('readme.md')
  })

  it('marks .md files as isMarkdown, other extensions as false', () => {
    const nodes: FileNode[] = [
      file(`${VAULT}/note.md`),
      file(`${VAULT}/image.png`),
    ]
    const result = flattenTree(nodes, VAULT)
    expect(result.find((i) => i.name === 'note.md')?.isMarkdown).toBe(true)
    expect(result.find((i) => i.name === 'image.png')?.isMarkdown).toBe(false)
  })

  it('returns empty array when all files are under .claude/', () => {
    const nodes: FileNode[] = [
      dir(`${VAULT}/.claude`, [
        file(`${VAULT}/.claude/rules/git-workflow.md`),
      ]),
    ]
    const result = flattenTree(nodes, VAULT)
    expect(result).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// flattenTree — includeClaudeDir: true
// ---------------------------------------------------------------------------

describe('flattenTree — includeClaudeDir: true', () => {
  it('includes .claude/ files when opted in', () => {
    const nodes: FileNode[] = [
      file(`${VAULT}/note.md`),
      dir(`${VAULT}/.claude`, [
        file(`${VAULT}/.claude/agents/bot.md`),
      ]),
    ]
    const result = flattenTree(nodes, VAULT, { includeClaudeDir: true })
    const rels = result.map((i) => i.rel)
    expect(rels).toContain('note.md')
    expect(rels).toContain('.claude/agents/bot.md')
  })

  it('returns all files including nested .claude/ subdirs', () => {
    const nodes: FileNode[] = [
      dir(`${VAULT}/.claude`, [
        dir(`${VAULT}/.claude/agents`, [
          file(`${VAULT}/.claude/agents/react.md`),
        ]),
        dir(`${VAULT}/.claude/commands`, [
          file(`${VAULT}/.claude/commands/import.md`),
        ]),
      ]),
      file(`${VAULT}/journal.md`),
    ]
    const result = flattenTree(nodes, VAULT, { includeClaudeDir: true })
    expect(result).toHaveLength(3)
  })
})
