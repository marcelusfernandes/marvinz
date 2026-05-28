import { describe, it, expect } from 'vitest'
import { formatSelectionForAgent } from '../agent-selection-format'

describe('formatSelectionForAgent — empty / whitespace', () => {
  it('empty string → empty string', () => {
    expect(formatSelectionForAgent('', 'codex')).toBe('')
    expect(formatSelectionForAgent('', 'claude-code')).toBe('')
  })

  it('whitespace-only → empty string', () => {
    expect(formatSelectionForAgent('   \n  \t  ', 'codex')).toBe('')
  })
})

describe('formatSelectionForAgent — single-line', () => {
  it('returns text as-is without a fence', () => {
    expect(formatSelectionForAgent('hello world', 'codex')).toBe('hello world')
    expect(formatSelectionForAgent('hello world', 'claude-code')).toBe('hello world')
  })

  it('preserves leading whitespace (indentation is signal)', () => {
    expect(formatSelectionForAgent('    indented', 'codex')).toBe('    indented')
  })

  it('strips trailing whitespace', () => {
    expect(formatSelectionForAgent('hello   ', 'codex')).toBe('hello')
  })
})

describe('formatSelectionForAgent — multi-line', () => {
  it('wraps multi-line text in a triple-backtick fence', () => {
    expect(formatSelectionForAgent('line one\nline two', 'codex')).toBe(
      '```\nline one\nline two\n```',
    )
  })

  it('strips only trailing whitespace, keeps internal newlines', () => {
    expect(formatSelectionForAgent('a\nb\n\n', 'codex')).toBe('```\na\nb\n```')
  })

  it('preserves leading whitespace on inner lines', () => {
    expect(formatSelectionForAgent('def x():\n    return 1', 'codex')).toBe(
      '```\ndef x():\n    return 1\n```',
    )
  })
})

describe('formatSelectionForAgent — backtick escaping', () => {
  it('text containing triple-backtick uses a 4-tick fence', () => {
    const text = 'before\n```js\nx\n```\nafter'
    expect(formatSelectionForAgent(text, 'codex')).toBe(
      '````\nbefore\n```js\nx\n```\nafter\n````',
    )
  })

  it('text containing quad-backtick uses a 5-tick fence', () => {
    const text = 'a\n````\nb\n````\nc'
    expect(formatSelectionForAgent(text, 'codex')).toBe(
      '`````\na\n````\nb\n````\nc\n`````',
    )
  })

  it('single backticks inside multi-line do NOT escalate the fence', () => {
    const text = 'use the `value`\nlike this'
    expect(formatSelectionForAgent(text, 'codex')).toBe(
      '```\nuse the `value`\nlike this\n```',
    )
  })

  it('double backticks inside multi-line do NOT escalate the fence', () => {
    const text = '``a``\nb'
    expect(formatSelectionForAgent(text, 'codex')).toBe('```\n``a``\nb\n```')
  })
})

describe('formatSelectionForAgent — agent-kind parity', () => {
  it('codex and claude-code return the same formatting (text blocks have no prefix convention)', () => {
    const single = 'one liner'
    const multi = 'foo\nbar'
    expect(formatSelectionForAgent(single, 'codex')).toBe(
      formatSelectionForAgent(single, 'claude-code'),
    )
    expect(formatSelectionForAgent(multi, 'codex')).toBe(
      formatSelectionForAgent(multi, 'claude-code'),
    )
  })
})
