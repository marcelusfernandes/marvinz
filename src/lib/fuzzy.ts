export type FuzzyMatch = {
  score: number
  /** Indices in the haystack that matched. Sorted ascending. */
  matches: number[]
}

/**
 * Subsequence-based fuzzy match. Returns null if every char in `needle` doesn't
 * appear in `haystack` in order. Score rewards consecutive matches and matches
 * at word boundaries.
 */
export function fuzzyMatch(haystack: string, needle: string): FuzzyMatch | null {
  if (!needle) return { score: 0, matches: [] }
  const hLower = haystack.toLowerCase()
  const nLower = needle.toLowerCase()
  const matches: number[] = []
  let qi = 0
  let lastIdx = -2
  let consecutive = 0
  let score = 0

  for (let i = 0; i < hLower.length && qi < nLower.length; i++) {
    if (hLower[i] !== nLower[qi]) continue

    matches.push(i)

    if (i === lastIdx + 1) {
      consecutive += 1
      score += 5 + consecutive * 2
    } else {
      consecutive = 0
      score += 1
    }

    // Word/segment boundary
    if (i === 0) {
      score += 6
    } else {
      const prev = haystack[i - 1]
      if (prev === '/' || prev === '\\') score += 5
      else if (prev === ' ' || prev === '_' || prev === '-' || prev === '.') score += 3
    }

    // Exact-case match bonus
    if (haystack[i] === needle[qi]) score += 1

    lastIdx = i
    qi += 1
  }

  if (qi < nLower.length) return null
  return { score, matches }
}
