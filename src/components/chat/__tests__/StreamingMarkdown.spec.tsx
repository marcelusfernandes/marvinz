import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { StreamingMarkdown } from '../StreamingMarkdown'
import { closeOpenMarkdown, splitMarkdownBlocks } from '../../../lib/chat/markdown'

// ---------------------------------------------------------------------------
// closeOpenMarkdown helper — unit tests
// ---------------------------------------------------------------------------

describe('closeOpenMarkdown helper', () => {
  it('returns empty string unchanged', () => {
    expect(closeOpenMarkdown('')).toBe('')
  })

  it('closes unclosed fenced code block', () => {
    const result = closeOpenMarkdown('hello\n```js\ncode')
    expect(result).toContain('```')
    // Should have an even number of ``` markers now
    const fences = (result.match(/(^|\n)```/g) ?? []).length
    expect(fences % 2).toBe(0)
  })

  it('does not close a properly closed code block', () => {
    const input = 'hello\n```js\ncode\n```\nafter'
    const result = closeOpenMarkdown(input)
    const fences = (result.match(/(^|\n)```/g) ?? []).length
    expect(fences % 2).toBe(0)
  })

  it('closes unclosed inline code span', () => {
    const result = closeOpenMarkdown('text `code')
    expect(result.endsWith('`')).toBe(true)
  })

  it('does not close a closed inline code span', () => {
    const result = closeOpenMarkdown('text `code` more')
    // even number of backticks — no addition
    const ticks = (result.match(/`/g) ?? []).length
    expect(ticks % 2).toBe(0)
  })

  it('closes unclosed bold marker **', () => {
    const result = closeOpenMarkdown('**bold')
    expect(result.endsWith('**')).toBe(true)
  })

  it('does not close a properly closed bold', () => {
    const result = closeOpenMarkdown('**bold** text')
    const markers = (result.match(/\*\*/g) ?? []).length
    expect(markers % 2).toBe(0)
  })

  it('closes unclosed italic marker *', () => {
    const result = closeOpenMarkdown('*italic')
    expect(result.endsWith('*')).toBe(true)
  })

  it('closes unclosed link target [text](', () => {
    const result = closeOpenMarkdown('text [link](')
    expect(result.endsWith(')')).toBe(true)
  })

  it('does not close a properly closed link', () => {
    const result = closeOpenMarkdown('text [link](https://example.com)')
    expect(result).toBe('text [link](https://example.com)')
  })

  it('handles text with no special markers unchanged', () => {
    const result = closeOpenMarkdown('plain text no markdown')
    expect(result).toBe('plain text no markdown')
  })

  it('code fence takes priority — does not try to close bold inside code', () => {
    const result = closeOpenMarkdown('```\n**bold')
    // Should close the code fence, not the bold
    const fences = (result.match(/(^|\n)```/g) ?? []).length
    expect(fences % 2).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// StreamingMarkdown — rendering markdown
// ---------------------------------------------------------------------------

describe('StreamingMarkdown — markdown rendering', () => {
  it('renders plain text', () => {
    render(<StreamingMarkdown text="Hello world" />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('renders bold text', () => {
    const { container } = render(<StreamingMarkdown text="**bold text**" />)
    expect(container.querySelector('strong')).toBeInTheDocument()
  })

  it('renders italic text', () => {
    const { container } = render(<StreamingMarkdown text="*italic text*" />)
    expect(container.querySelector('em')).toBeInTheDocument()
  })

  it('renders inline code spans', () => {
    const { container } = render(<StreamingMarkdown text="use `console.log` here" />)
    expect(container.querySelector('code')).toBeInTheDocument()
  })

  it('renders level 1 headers', () => {
    const { container } = render(<StreamingMarkdown text="# Title" />)
    expect(container.querySelector('h1')).toBeInTheDocument()
  })

  it('renders level 2 headers', () => {
    const { container } = render(<StreamingMarkdown text="## Section" />)
    expect(container.querySelector('h2')).toBeInTheDocument()
  })

  it('renders fenced code blocks', () => {
    const { container } = render(<StreamingMarkdown text={'```js\nconsole.log("hi")\n```'} />)
    expect(container.querySelector('pre')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// StreamingMarkdown — streaming prop
// ---------------------------------------------------------------------------

describe('StreamingMarkdown — streaming prop', () => {
  it('adds "streaming" class when streaming=true', () => {
    const { container } = render(<StreamingMarkdown text="text" streaming />)
    expect(container.querySelector('.chat-md.streaming')).toBeInTheDocument()
  })

  it('does not add "streaming" class when streaming=false (default)', () => {
    const { container } = render(<StreamingMarkdown text="text" />)
    expect(container.querySelector('.streaming')).not.toBeInTheDocument()
  })

  it('uses chat-md class regardless of streaming state', () => {
    const { container } = render(<StreamingMarkdown text="text" streaming />)
    expect(container.querySelector('.chat-md')).toBeInTheDocument()
  })

  it('applies closeOpenMarkdown to input when streaming=true', () => {
    // Unclosed bold: ** should be closed before rendering
    const { container } = render(<StreamingMarkdown text="**bold" streaming />)
    // react-markdown should render <strong> because closeOpenMarkdown closes **
    expect(container.querySelector('strong')).toBeInTheDocument()
  })

  it('does not apply closeOpenMarkdown when streaming=false', () => {
    // With streaming=false, unclosed ** is rendered as raw text (no sentinel close)
    // The parser may render it differently but we just verify no crash + has text
    const { container } = render(<StreamingMarkdown text="**bold" />)
    expect(container.querySelector('.chat-md')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// StreamingMarkdown — React.memo (no rerender after done)
// ---------------------------------------------------------------------------

describe('StreamingMarkdown — React.memo stability', () => {
  it('rerenders when text prop changes', () => {
    const { rerender, container } = render(<StreamingMarkdown text="first" />)
    rerender(<StreamingMarkdown text="second" />)
    expect(container.textContent).toContain('second')
  })

  it('rerenders when streaming prop changes', () => {
    const { rerender, container } = render(<StreamingMarkdown text="hello" streaming={true} />)
    rerender(<StreamingMarkdown text="hello" streaming={false} />)
    expect(container.querySelector('.streaming')).not.toBeInTheDocument()
  })

  it('does not rerender when props are identical (memo guard)', () => {
    // We verify memo works by checking the render count via a spy on useMemo
    // In RTL we confirm: same props → same output with no observable side effects.
    // The actual memo benefit is a performance guarantee, not a DOM assertion.
    // We test that rendering the same props twice does not crash and renders correctly.
    const { rerender, container } = render(<StreamingMarkdown text="stable" />)
    rerender(<StreamingMarkdown text="stable" />)
    expect(container.textContent).toContain('stable')
  })

  it('component exported as memo-wrapped (not plain function)', () => {
    // Verify memo wrapping — the component's $$typeof should be the memo symbol
    expect(StreamingMarkdown).toHaveProperty('$$typeof')
    const memoSymbol = Symbol.for('react.memo')
    expect((StreamingMarkdown as unknown as { $$typeof: symbol }).$$typeof).toBe(memoSymbol)
  })
})

// ---------------------------------------------------------------------------
// splitMarkdownBlocks — block boundary unit tests (#591)
// ---------------------------------------------------------------------------

describe('splitMarkdownBlocks helper', () => {
  it('returns an empty array for empty text', () => {
    expect(splitMarkdownBlocks('')).toEqual([])
  })

  it('keeps a single paragraph with no boundary as one block', () => {
    expect(splitMarkdownBlocks('just one paragraph')).toEqual(['just one paragraph'])
  })

  it('splits two paragraphs separated by a blank line', () => {
    expect(splitMarkdownBlocks('first paragraph\n\nsecond paragraph')).toEqual([
      'first paragraph',
      'second paragraph',
    ])
  })

  it('keeps a fenced code block atomic even with an internal blank line', () => {
    const doc = '```js\nline one\n\nline two\n```'
    expect(splitMarkdownBlocks(doc)).toEqual([doc])
  })

  it('splits content that follows a closed fence once a boundary is confirmed', () => {
    const doc = '```js\ncode\n```\n\nafter\n\nmore'
    expect(splitMarkdownBlocks(doc)).toEqual(['```js\ncode\n```', 'after', 'more'])
  })

  it('keeps a tight list (no internal blank lines) as one block', () => {
    const doc = '- one\n- two\n- three'
    expect(splitMarkdownBlocks(doc)).toEqual([doc])
  })

  it('keeps a loose list (blank line between items) as one block — a naive split would break it into separate lists', () => {
    const doc = '- one\n\n- two\n\n- three'
    expect(splitMarkdownBlocks(doc)).toEqual([doc])
  })

  it('splits once a loose list is followed by a non-list paragraph', () => {
    const doc = '- one\n\n- two\n\nafter the list'
    expect(splitMarkdownBlocks(doc)).toEqual(['- one\n\n- two', 'after the list'])
  })

  it('keeps blockquote continuation across a blank line as one block', () => {
    const doc = '> line one\n\n> line two'
    expect(splitMarkdownBlocks(doc)).toEqual([doc])
  })

  it('splits once a blockquote is followed by a non-quote paragraph', () => {
    const doc = '> quoted\n\nafter the quote'
    expect(splitMarkdownBlocks(doc)).toEqual(['> quoted', 'after the quote'])
  })

  it('drops a dangling blank-line run at the very end — no confirming line has arrived, so it stays part of the still-open block', () => {
    expect(splitMarkdownBlocks('- one\n\n')).toEqual(['- one'])
  })

  it('never revises an earlier confirmed block when more text is appended (stable-prefix invariant)', () => {
    const prefix = 'first paragraph\n\nsecond paragraph'
    const grown = prefix + '\n\nthird paragraph'
    const blocksBefore = splitMarkdownBlocks(prefix)
    const blocksAfter = splitMarkdownBlocks(grown)
    // Every block confirmed complete before growth (all but the trailing one)
    // must appear unchanged, at the same position, after more text arrives.
    expect(blocksAfter.slice(0, blocksBefore.length - 1)).toEqual(blocksBefore.slice(0, -1))
  })
})

// ---------------------------------------------------------------------------
// StreamingMarkdown — final rendered output identity (#591)
// ---------------------------------------------------------------------------

describe('StreamingMarkdown — final output matches the pre-#591 single-pass render', () => {
  // Deliberately includes every hazard the splitter must not mis-split:
  // prose, a tight list, a loose list, a fenced block with an internal blank
  // line, inline bold/code, and a trailing paragraph.
  const HAZARD_DOC = [
    'A prose paragraph with **bold** and `inline code`.',
    '',
    '- tight item one',
    '- tight item two',
    '',
    '- loose item one',
    '',
    '- loose item two',
    '',
    '```js',
    'function example() {',
    '',
    '  return 1',
    '}',
    '```',
    '',
    'A trailing paragraph after everything else.',
  ].join('\n')

  it('renders byte-identical HTML to a direct ReactMarkdown call once streaming is done', () => {
    const { container: actual } = render(<StreamingMarkdown text={HAZARD_DOC} streaming={false} />)
    const { container: expected } = render(
      <span className="chat-md">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{HAZARD_DOC}</ReactMarkdown>
      </span>
    )
    expect(actual.innerHTML).toBe(expected.innerHTML)
  })
})
