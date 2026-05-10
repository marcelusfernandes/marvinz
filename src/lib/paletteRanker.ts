import { fuzzyMatch } from './fuzzy'

export type PaletteItem = {
  /** Absolute path on disk */
  path: string
  /** Vault-relative path, used for display + matching */
  rel: string
  /** Just the filename */
  name: string
  /** Whether this is a markdown note (opens in tab) or other (reveal in Finder) */
  isMarkdown: boolean
}

export type ScoredPaletteItem = {
  item: PaletteItem
  score: number
  nameMatches: number[]
  relMatches: number[]
}

export const PALETTE_MAX_RESULTS = 60

export function rankPaletteItems(
  items: PaletteItem[],
  query: string,
  limit: number = PALETTE_MAX_RESULTS,
): ScoredPaletteItem[] {
  if (!query.trim()) {
    return items.slice(0, limit).map((item) => ({
      item,
      score: 0,
      nameMatches: [],
      relMatches: [],
    }))
  }
  const out: ScoredPaletteItem[] = []
  for (const item of items) {
    const nameHit = fuzzyMatch(item.name, query)
    const relHit = fuzzyMatch(item.rel, query)
    if (!nameHit && !relHit) continue
    const nameScore = nameHit ? nameHit.score * 2 : 0
    const relScore = relHit ? relHit.score : 0
    out.push({
      item,
      score: nameScore + relScore,
      nameMatches: nameHit?.matches ?? [],
      relMatches: relHit?.matches ?? [],
    })
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, limit)
}

export function stripBasename(rel: string, name: string): string {
  if (rel === name) return ''
  const cut = rel.length - name.length
  return rel.slice(0, Math.max(0, cut - 1))
}
