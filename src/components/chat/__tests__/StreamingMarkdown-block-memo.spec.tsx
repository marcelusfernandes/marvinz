// @vitest-environment jsdom

/**
 * Parse-count regression test for #591's block memoization.
 *
 * Mocks react-markdown so every "parse" (i.e. every invocation of the
 * component that would otherwise tokenize markdown) is observable. Kept in
 * its own file — mocking react-markdown here would break StreamingMarkdown.spec.tsx's
 * real-rendering assertions (bold/italic/code/etc. actually appearing in the DOM).
 *
 * tsc/eslint/the rest of the suite passing does not prove completed blocks
 * are never re-parsed — nothing else in the suite counts invocations. This
 * is the test that would catch a splitter that silently re-litigates an
 * earlier boundary once more text arrives.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { splitMarkdownBlocks } from '../../../lib/chat/markdown'

const { parseSpy } = vi.hoisted(() => ({ parseSpy: vi.fn() }))

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => {
    parseSpy(children)
    return null
  },
}))

import { StreamingMarkdown } from '../StreamingMarkdown'

// Hazard corpus: a loose list (blank line inside it must not force a
// premature split) followed by a paragraph, then a fenced block with an
// internal blank line, then a trailing paragraph that keeps growing.
const FULL_DOC = [
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
].join('\n')

beforeEach(() => {
  parseSpy.mockClear()
})

describe('StreamingMarkdown — completed blocks are memoized, never re-parsed (#591)', () => {
  it('parses each completed block exactly once across many delta flushes', () => {
    const STEP = 12
    const { rerender } = render(<StreamingMarkdown text={FULL_DOC.slice(0, STEP)} streaming />)

    for (let end = STEP * 2; end <= FULL_DOC.length; end += STEP) {
      rerender(<StreamingMarkdown text={FULL_DOC.slice(0, end)} streaming />)
    }
    rerender(<StreamingMarkdown text={FULL_DOC} streaming />)

    const finalBlocks = splitMarkdownBlocks(FULL_DOC)
    const completedBlocks = finalBlocks.slice(0, -1)
    // Sanity check the corpus actually exercises multiple boundaries —
    // otherwise this test would trivially pass with zero coverage.
    expect(completedBlocks.length).toBeGreaterThan(1)

    const calls = parseSpy.mock.calls.map((c) => c[0] as string)
    for (const block of completedBlocks) {
      expect(calls.filter((c) => c === block)).toHaveLength(1)
    }
  })

  it('never parses a completed block once streaming ends and the message renders as one block', () => {
    // Sanity guard for the escape-hatch path: once streaming=false, the whole
    // text renders through the raw (unmocked in real usage) ReactMarkdown
    // call — here it just means one additional parseSpy call for the full text.
    const { rerender } = render(<StreamingMarkdown text={FULL_DOC} streaming />)
    parseSpy.mockClear()
    rerender(<StreamingMarkdown text={FULL_DOC} streaming={false} />)
    expect(parseSpy).toHaveBeenCalledTimes(1)
    expect(parseSpy).toHaveBeenCalledWith(FULL_DOC)
  })
})
