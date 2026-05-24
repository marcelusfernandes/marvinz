import type { PaletteItem } from './paletteRanker'

export type PaletteCategory = 'note' | 'agent' | 'command' | 'rule' | 'hook' | 'other'

export function categorizeItem(item: PaletteItem): PaletteCategory {
  if (item.rel.startsWith('.claude/agents/')) return 'agent'
  if (item.rel.startsWith('.claude/commands/')) return 'command'
  if (item.rel.startsWith('.claude/rules/')) return 'rule'
  if (item.rel.startsWith('.claude/hooks/')) return 'hook'
  if (item.isMarkdown) return 'note'
  return 'other'
}
