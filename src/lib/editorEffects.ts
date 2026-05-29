/**
 * Whether a document is large enough that editor micro-animations should be
 * skipped to avoid jank. Subsequent effects (e.g. line-reveal in sub-issue 4/7)
 * reuse this threshold so the cutoff stays consistent across the milestone.
 */
export function isLargeDoc(text: string): boolean {
  if (text.length > 50000) return true
  let lines = 1
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lines++
    if (lines > 5000) return true
  }
  return false
}
