import { describe, it, expect, vi } from 'vitest'
import {
  advanceBlockScan,
  renderBlocks,
  splitMarkdownBlocks,
  stepLine,
  EMPTY_BLOCK_SCAN_STATE,
  type LineScanState,
} from '../markdown'

// ---------------------------------------------------------------------------
// advanceBlockScan/renderBlocks — equivalence with the from-scratch scan (#592)
// ---------------------------------------------------------------------------

// Adversarial corpora exercising every construct that can span a block
// boundary: a loose list, a blockquote continuation, a fenced block with an
// internal blank line, and a fence that's still open when the replay stops.
const CORPORA = [
  [
    'Intro paragraph explaining the plan for this response.',
    '',
    '- item one in a loose list',
    '',
    '- item two, still part of the same list',
    '',
    'Middle paragraph that follows the list once it truly ends.',
    '',
    '```js',
    'function example() {',
    '',
    '  return 42',
    '}',
    '```',
    '',
    'Final trailing paragraph that keeps growing one word at a time.',
  ].join('\n'),
  '> quoted line one\n\n> quoted line two\n\nafter the quote',
  '```\n**bold inside fence**\n\nstill in fence\n```\nafter the fence',
  'text [link](https://example.com) and more\n\n**bold**\n\nend',
]

/** Replays `doc` one character at a time, asserting the incremental scan
 * matches the from-scratch reference at every single prefix — not just at
 * a few sampled checkpoints, since a boundary bug could easily hide between
 * word-sized steps. */
function assertMatchesReferenceAtEveryPrefix(doc: string) {
  let state = EMPTY_BLOCK_SCAN_STATE
  for (let end = 1; end <= doc.length; end++) {
    const prefix = doc.slice(0, end)
    state = advanceBlockScan(state, prefix)
    const { completed, trailing } = renderBlocks(state)

    const reference = splitMarkdownBlocks(prefix)
    const referenceCompleted = reference.slice(0, -1)
    const referenceTrailing = reference.length > 0 ? reference[reference.length - 1] : ''

    expect(completed, `completed blocks mismatch at prefix length ${end}`).toEqual(
      referenceCompleted
    )
    expect(trailing, `trailing block mismatch at prefix length ${end}`).toBe(referenceTrailing)
  }
}

describe('advanceBlockScan + renderBlocks — matches splitMarkdownBlocks at every step', () => {
  it.each(CORPORA.map((doc, i) => [i, doc] as const))(
    'corpus %i: incremental scan matches the from-scratch reference character-by-character',
    (_i, doc) => {
      assertMatchesReferenceAtEveryPrefix(doc)
    }
  )

  it('matches the reference across a growing prefix even when deltas land mid-line', () => {
    // Deltas of uneven, multi-character size — not aligned to line or word
    // boundaries — since that's how real token-by-token streaming arrives.
    const doc = CORPORA[0]
    const steps = [3, 7, 1, 15, 2, 40, 5, 22]
    let state = EMPTY_BLOCK_SCAN_STATE
    let end = 0
    let stepIndex = 0
    while (end < doc.length) {
      end = Math.min(end + steps[stepIndex % steps.length], doc.length)
      stepIndex++
      const prefix = doc.slice(0, end)
      state = advanceBlockScan(state, prefix)
      const { completed, trailing } = renderBlocks(state)
      const reference = splitMarkdownBlocks(prefix)
      expect(completed).toEqual(reference.slice(0, -1))
      expect(trailing).toBe(reference[reference.length - 1] ?? '')
    }
  })
})

// ---------------------------------------------------------------------------
// advanceBlockScan — scan cost tracks the delta, not the total length (#592)
// ---------------------------------------------------------------------------

describe('advanceBlockScan — per-flush scan cost depends on the delta, not total length', () => {
  it('steps each line exactly once across a full replay, never re-processing an earlier line', () => {
    const doc = CORPORA[0]
    const countingStep = vi.fn((state: LineScanState, line: string) => stepLine(state, line))

    let state = EMPTY_BLOCK_SCAN_STATE
    const STEP = 9
    for (let end = STEP; end <= doc.length; end += STEP) {
      state = advanceBlockScan(state, doc.slice(0, end), countingStep)
    }
    advanceBlockScan(state, doc, countingStep)

    // `doc` has no trailing newline, so its last line is never terminated —
    // advanceBlockScan withholds exactly that one line from the persisted
    // state forever (it lives in lineBuffer, re-derived per render instead,
    // see renderBlocks). Every other line must be stepped EXACTLY once in
    // total across the whole replay. A scanner that rescanned the whole
    // accumulated text from scratch on each call would call stepLine roughly
    // (number of flushes) times as often instead of exactly this count.
    const totalLines = doc.split('\n').length
    expect(countingStep).toHaveBeenCalledTimes(totalLines - 1)
  })

  it('a single-line delta only steps that one line, regardless of how much text preceded it', () => {
    const longPrefix = Array.from({ length: 200 }, (_, i) => `paragraph number ${i}`).join('\n\n')
    let state = EMPTY_BLOCK_SCAN_STATE
    state = advanceBlockScan(state, longPrefix)

    const countingStep = vi.fn((s: LineScanState, line: string) => stepLine(s, line))
    advanceBlockScan(state, longPrefix + '\none more line\n', countingStep)

    // Only the newly appended line(s) should have been stepped — not the
    // 200+ paragraphs that came before.
    expect(countingStep.mock.calls.length).toBeLessThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// Byte-identity for constructs spanning block boundaries, once done (#592)
// ---------------------------------------------------------------------------

describe('splitMarkdownBlocks — reference behavior for constructs spanning boundaries stays exact', () => {
  it('an open fenced code block at the end of a growing stream stays one block until it closes', () => {
    const openFence = 'before\n\n```js\nfunction f() {\n\n  return 1\n'
    const closedFence = openFence + '}\n```\n\nafter'
    const openResult = splitMarkdownBlocks(openFence)
    const closedResult = splitMarkdownBlocks(closedFence)
    // While open, nothing has been confirmed complete yet — the whole thing,
    // fence included, is still the one (trailing, mutable) block.
    expect(openResult).toEqual([openFence])
    // Once the fence closes and "after" confirms the boundary past it, the
    // fenced block (plus what preceded it, still one block) is completed and
    // its content is exactly the open version's plus the closing lines.
    expect(closedResult).toEqual([openFence + '}\n```', 'after'])
  })

  it('a continuing list across a blank line renders as one block once the message completes', () => {
    const doc = '- one\n\n- two\n\n- three\n\nafter the list'
    const result = splitMarkdownBlocks(doc)
    expect(result).toEqual(['- one\n\n- two\n\n- three', 'after the list'])
  })
})
