import { describe, it, expect } from 'vitest'
import { categorizeItem } from '../paletteCategory'
import type { PaletteItem } from '../paletteRanker'

function item(rel: string, isMarkdown: boolean): PaletteItem {
  return { path: `/vault/${rel}`, rel, name: rel.split('/').pop()!, isMarkdown }
}

// ===========================================================================
// categorizeItem — all six categories
// ===========================================================================

describe('categorizeItem', () => {
  it('returns "agent" for .claude/agents/ path', () => {
    expect(categorizeItem(item('.claude/agents/react.md', true))).toBe('agent')
  })

  it('returns "command" for .claude/commands/ path (flat)', () => {
    expect(categorizeItem(item('.claude/commands/import.md', true))).toBe('command')
  })

  it('returns "command" for nested .claude/commands/ path', () => {
    expect(categorizeItem(item('.claude/commands/issues/create.md', true))).toBe('command')
  })

  it('returns "rule" for .claude/rules/ path', () => {
    expect(categorizeItem(item('.claude/rules/git-workflow.md', true))).toBe('rule')
  })

  it('returns "hook" for .claude/hooks/ path', () => {
    expect(categorizeItem(item('.claude/hooks/pre-commit.sh', false))).toBe('hook')
  })

  it('returns "note" for .md at vault root (not .claude/)', () => {
    expect(categorizeItem(item('my-note.md', true))).toBe('note')
  })

  it('returns "note" for .md in a non-.claude subfolder', () => {
    expect(categorizeItem(item('projects/alpha.md', true))).toBe('note')
  })

  it('returns "other" for a .png at vault root', () => {
    expect(categorizeItem(item('screenshot.png', false))).toBe('other')
  })

  it('returns "other" for a .pdf at vault root', () => {
    expect(categorizeItem(item('report.pdf', false))).toBe('other')
  })
})
