// Sentinel-close helper for streaming markdown — see design doc §8.6.
// Parsers (CommonMark, GFM) reject partial input mid-token. To render
// mid-stream we speculatively close common unterminated markers before
// handing the text to react-markdown.

/**
 * Append synthetic close markers to a streaming markdown fragment so a
 * parser can render it without choking on partial input.
 *
 * Handles, in order of priority:
 *   1. Unterminated fenced code blocks (```)
 *   2. Unterminated inline code (`)
 *   3. Unterminated bold (**)
 *   4. Unterminated italic (*)
 *   5. Unterminated link target (`](`)
 */
export function closeOpenMarkdown(text: string): string {
  if (!text) return text
  let out = text

  // 1. Fenced code blocks — count triple backticks at start-of-line.
  const fenceMatches = out.match(/(^|\n)```/g)
  if (fenceMatches && fenceMatches.length % 2 === 1) {
    out += out.endsWith('\n') ? '```\n' : '\n```\n'
    return out
  }

  // 2. Inline code spans — count single backticks (only after fences removed).
  const inlineTicks = (out.match(/`/g) ?? []).length
  if (inlineTicks % 2 === 1) {
    out += '`'
  }

  // 3. Unterminated link target `[text](`.
  const openParen = out.lastIndexOf('](')
  if (openParen !== -1) {
    const closeParen = out.indexOf(')', openParen + 2)
    if (closeParen === -1) {
      out += ')'
    }
  }

  // 4. Bold (**). Naive but effective: count occurrences.
  const boldMarkers = (out.match(/\*\*/g) ?? []).length
  if (boldMarkers % 2 === 1) {
    out += '**'
  }

  // 5. Italic (single *) — count loose stars, excluding the ** we just closed.
  const loneStars = (out.match(/(?<!\*)\*(?!\*)/g) ?? []).length
  if (loneStars % 2 === 1) {
    out += '*'
  }

  return out
}
