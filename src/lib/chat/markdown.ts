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

export type LineScanState = {
  blocks: string[]
  current: string[]
  pendingBlank: string[]
  inFence: boolean
  lastKind: LineKind | null
}

const EMPTY_LINE_SCAN_STATE: LineScanState = {
  blocks: [],
  current: [],
  pendingBlank: [],
  inFence: false,
  lastKind: null,
}

/**
 * Fold one more line into a block-scan state. Pure — returns a new state,
 * never mutates `state`'s arrays. Shared by both splitMarkdownBlocks (which
 * restarts this from scratch on every call) and advanceBlockScan (which
 * resumes it across calls) so there is exactly one place that decides where
 * a boundary falls; the two only differ in how much of the text they feed
 * through it.
 */
export function stepLine(state: LineScanState, line: string): LineScanState {
  const { blocks, current, pendingBlank, inFence, lastKind } = state

  if (inFence) {
    return {
      blocks,
      current: [...current, line],
      pendingBlank,
      inFence: !FENCE_RE.test(line),
      lastKind,
    }
  }
  if (FENCE_RE.test(line)) {
    return {
      blocks,
      current: [...current, ...pendingBlank, line],
      pendingBlank: [],
      inFence: true,
      lastKind: 'other',
    }
  }
  if (line.trim() === '') {
    return { blocks, current, pendingBlank: [...pendingBlank, line], inFence, lastKind }
  }
  if (pendingBlank.length > 0) {
    if (current.length > 0 && lastKind !== null && continuesBlock(lastKind, line)) {
      return {
        blocks,
        current: [...current, ...pendingBlank, line],
        pendingBlank: [],
        inFence,
        lastKind: classifyLine(line, lastKind),
      }
    }
    return {
      blocks: current.length > 0 ? [...blocks, current.join('\n')] : blocks,
      current: [line],
      pendingBlank: [],
      inFence,
      lastKind: classifyLine(line, lastKind),
    }
  }
  return {
    blocks,
    current: [...current, line],
    pendingBlank,
    inFence,
    lastKind: classifyLine(line, lastKind),
  }
}

/**
 * Split accumulated streamed markdown into an ordered list of block strings,
 * preserving fenced code blocks as atomic units. Kept as the from-scratch
 * reference implementation: still directly unit-tested for boundary
 * decisions, and used as the ground-truth oracle that advanceBlockScan's
 * incremental result must match (#592). StreamingMarkdown itself now uses
 * advanceBlockScan so the scan cost tracks the delta, not the whole message.
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
 *
 * Accepted limitation (#592): reference-style links/footnotes whose
 * definition (`[ref]: url`) lands in a different block than their usage
 * (`[text][ref]`) won't resolve while streaming — each block is its own
 * independent ReactMarkdown/remark parse, and remark only resolves
 * references within a single parse call. Fixing this would mean scanning
 * every block (including already-memoized ones) for reference definitions
 * and re-injecting them into every other block's source on each flush,
 * which both re-parses "completed" blocks (defeating #591's memoization)
 * and changes an already-memoized block's identity retroactively whenever a
 * new definition streams in later — the exact instability #591 was built to
 * avoid. Given how rare an assistant reply's own reference-style link is
 * (vs. inline links, which are unaffected), this is scoped out: it
 * self-corrects the moment streaming ends, since the done-state render is
 * the single-pass bypass below, identical to pre-#591 behavior.
 */
export function splitMarkdownBlocks(text: string): string[] {
  if (!text) return []

  let state = EMPTY_LINE_SCAN_STATE
  for (const line of text.split('\n')) {
    state = stepLine(state, line)
  }
  return state.current.length > 0 ? [...state.blocks, state.current.join('\n')] : state.blocks
}

// ---------------------------------------------------------------------------
// advanceBlockScan — incremental tail-only re-scan for streaming (#592)
// ---------------------------------------------------------------------------

export type BlockScanState = LineScanState & {
  /** How much of `text` has been folded in so far — lets the next call slice
   * off just the new suffix instead of re-splitting the whole string. */
  scannedLength: number
  /** The still-growing last line, not yet terminated by a real `\n`. */
  lineBuffer: string
  /** Whether the text scanned so far ends exactly on a `\n`. `text.split('\n')`
   * always yields a trailing empty segment in that case — renderBlocks needs
   * to know this even when lineBuffer is '' (see its own doc comment). */
  endsWithNewline: boolean
}

export const EMPTY_BLOCK_SCAN_STATE: BlockScanState = {
  ...EMPTY_LINE_SCAN_STATE,
  scannedLength: 0,
  lineBuffer: '',
  endsWithNewline: false,
}

/**
 * Incrementally advance a block scan as more text is appended, resuming from
 * `prev` instead of rescanning `text` from the start. Requires `text` to only
 * ever grow by appending — true for a streamed chat message's text block,
 * which never shrinks or rewrites earlier content mid-turn. If that ever
 * doesn't hold (defensive guard, not expected in normal use), the scan just
 * restarts from scratch rather than producing a wrong result.
 *
 * Cost is proportional to the size of the NEW suffix since the last call
 * (`text.length - prev.scannedLength`), not to the total accumulated length
 * — this is what makes per-flush scan cost independent of how long the
 * message has grown so far, on top of #591's memoization of the actual
 * markdown parse. `stepFn` defaults to the real stepLine and exists only so
 * tests can wrap it to count invocations; production callers never pass it.
 */
export function advanceBlockScan(
  prev: BlockScanState,
  text: string,
  stepFn: (state: LineScanState, line: string) => LineScanState = stepLine
): BlockScanState {
  if (text.length < prev.scannedLength) {
    return advanceBlockScan(EMPTY_BLOCK_SCAN_STATE, text, stepFn)
  }

  const newChunk = text.slice(prev.scannedLength)
  if (newChunk === '') return prev

  let buffer = prev.lineBuffer + newChunk
  let state: LineScanState = {
    blocks: prev.blocks,
    current: prev.current,
    pendingBlank: prev.pendingBlank,
    inFence: prev.inFence,
    lastKind: prev.lastKind,
  }

  let newlineIndex = buffer.indexOf('\n')
  while (newlineIndex !== -1) {
    state = stepFn(state, buffer.slice(0, newlineIndex))
    buffer = buffer.slice(newlineIndex + 1)
    newlineIndex = buffer.indexOf('\n')
  }

  return {
    ...state,
    scannedLength: text.length,
    lineBuffer: buffer,
    endsWithNewline: text.endsWith('\n'),
  }
}

/**
 * Derive what StreamingMarkdown should actually render from a scan state:
 * the confirmed blocks, and the still-open trailing block's raw text.
 *
 * `advanceBlockScan` deliberately withholds the not-yet-newline-terminated
 * `lineBuffer` from ever being folded into `blocks`/`current` in the
 * PERSISTED state, since a persisted decision could never be revised once
 * more characters land in that same growing line. But splitMarkdownBlocks
 * (the from-scratch reference #591 shipped with) has always treated whatever
 * the current text's last segment looks like — complete line or not — as
 * decidable content, because it simply re-splits on `\n` fresh every time.
 * To match that exactly (not just be internally consistent), this runs one
 * extra, NOT-persisted stepFn call over `lineBuffer` purely for rendering —
 * cheap, since it's bounded by the size of the currently-growing last line,
 * not the whole message, and never carried into the next advanceBlockScan.
 */
export function renderBlocks(
  state: BlockScanState,
  stepFn: (state: LineScanState, line: string) => LineScanState = stepLine
): { completed: string[]; trailing: string } {
  // Peek whenever there's a genuine partial line OR the text ends exactly on
  // a `\n` — the latter is the case splitMarkdownBlocks's `text.split('\n')`
  // would also see a trailing empty segment for, and that segment matters:
  // inside an open fence it's real content (a blank line before the fence
  // eventually closes), so skipping the peek just because lineBuffer is ''
  // would silently drop it.
  const shouldPeek = state.lineBuffer !== '' || state.endsWithNewline
  const extended = shouldPeek ? stepFn(state, state.lineBuffer) : state
  // A still-unresolved pendingBlank (blank lines with no confirming line
  // after them yet) is dropped, not joined in — same as splitMarkdownBlocks's
  // own ending, which only ever turns `current` into the final trailing
  // entry. Keeping the two consistent matters here since #591's shipped
  // per-flush behavior already drops a dangling blank-line run this way.
  return {
    completed: extended.blocks,
    trailing: extended.current.join('\n'),
  }
}
