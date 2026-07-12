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

// ---------------------------------------------------------------------------
// splitMarkdownBlocks — stable block boundaries for streaming (#591)
// ---------------------------------------------------------------------------

const FENCE_RE = /^```/
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])(?:\s|$)/
const BLOCKQUOTE_RE = /^\s*>/
const INDENTED_RE = /^[ \t]+\S/

type LineKind = 'list' | 'blockquote' | 'other'

function classifyLine(line: string, prevKind: LineKind | null): LineKind {
  if (BLOCKQUOTE_RE.test(line)) return 'blockquote'
  if (LIST_ITEM_RE.test(line)) return 'list'
  if (prevKind === 'list' && INDENTED_RE.test(line)) return 'list'
  return 'other'
}

function continuesBlock(kind: LineKind, line: string): boolean {
  if (kind === 'blockquote') return BLOCKQUOTE_RE.test(line)
  if (kind === 'list') return LIST_ITEM_RE.test(line) || INDENTED_RE.test(line)
  return false
}

/**
 * Split accumulated streamed markdown into an ordered list of block strings,
 * preserving fenced code blocks as atomic units. Used by StreamingMarkdown to
 * memoize markdown that's already finished forming instead of re-parsing the
 * whole message on every delta.
 *
 * The scan is strictly forward — a boundary is only confirmed once a line
 * that already arrived disambiguates it (e.g. a blank line after a list item
 * is only a hard split once a later, non-continuing line has been seen).
 * This is what makes completed blocks a stable, append-only prefix: since a
 * decision never depends on text that hasn't arrived yet, appending more text
 * can only ever affect the still-open trailing block, never revise an
 * earlier one. The last element of the returned array is always that
 * trailing, still-mutable block (or the sole block, early in a stream).
 *
 * Loose lists and blockquotes (blank line, then a line that continues the
 * same list/blockquote) are kept as one block — a naive blank-line split
 * would render them as separate lists/quotes instead of one. Lazy blockquote
 * continuation (no blank line, no `>` prefix) is out of scope: CommonMark
 * only lets inline emphasis span within a block, never across a real
 * blank-line boundary, so per-block parsing for other constructs stays exact.
 */
export function splitMarkdownBlocks(text: string): string[] {
  if (!text) return []

  const lines = text.split('\n')
  const blocks: string[] = []
  let current: string[] = []
  let pendingBlank: string[] = []
  let inFence = false
  let lastKind: LineKind | null = null

  for (const line of lines) {
    if (inFence) {
      current.push(line)
      if (FENCE_RE.test(line)) inFence = false
      continue
    }
    if (FENCE_RE.test(line)) {
      current.push(...pendingBlank, line)
      pendingBlank = []
      inFence = true
      lastKind = 'other'
      continue
    }
    if (line.trim() === '') {
      pendingBlank.push(line)
      continue
    }
    if (pendingBlank.length > 0) {
      if (current.length > 0 && lastKind !== null && continuesBlock(lastKind, line)) {
        current.push(...pendingBlank, line)
      } else {
        if (current.length > 0) blocks.push(current.join('\n'))
        current = [line]
      }
      pendingBlank = []
    } else {
      current.push(line)
    }
    lastKind = classifyLine(line, lastKind)
  }

  if (current.length > 0) blocks.push(current.join('\n'))
  return blocks
}
