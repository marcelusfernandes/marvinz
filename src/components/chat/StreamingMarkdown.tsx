import { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { closeOpenMarkdown, splitMarkdownBlocks } from '../../lib/chat/markdown'

type Props = {
  text: string
  /** When true, append a blinking cursor sentinel inline with the rendered text. */
  streaming?: boolean
}

const remarkPlugins = [remarkGfm]

type BlockProps = { text: string }

// Memoized so a completed block (never the trailing one) is never re-parsed
// by ReactMarkdown once a later block exists after it — see splitMarkdownBlocks.
function MarkdownBlockImpl({ text }: BlockProps) {
  return <ReactMarkdown remarkPlugins={remarkPlugins}>{text}</ReactMarkdown>
}
const MarkdownBlock = memo(MarkdownBlockImpl)

function StreamingMarkdownImpl({ text, streaming = false }: Props) {
  // While streaming, split into blocks so completed ones (everything but the
  // last) can be memoized instead of re-parsed on every delta. Once done,
  // render the raw text in one shot — identical to the pre-#591 behavior, so
  // the final rendered output for a completed message never depends on how
  // the split happened to land mid-stream.
  const blocks = useMemo(() => (streaming ? splitMarkdownBlocks(text) : null), [text, streaming])

  if (!streaming || !blocks) {
    return (
      <span className="chat-md">
        <ReactMarkdown remarkPlugins={remarkPlugins}>{text}</ReactMarkdown>
      </span>
    )
  }

  const completed = blocks.slice(0, -1)
  // The trailing block is the whole text until a boundary is confirmed after
  // it (see splitMarkdownBlocks) — closeOpenMarkdown only needs to speculate
  // on this still-open piece, not the full accumulated message.
  const trailing = blocks.length > 0 ? blocks[blocks.length - 1] : text

  return (
    <span className="chat-md streaming">
      {completed.map((block, i) => (
        <MarkdownBlock key={i} text={block} />
      ))}
      <ReactMarkdown remarkPlugins={remarkPlugins}>{closeOpenMarkdown(trailing)}</ReactMarkdown>
    </span>
  )
}

export const StreamingMarkdown = memo(StreamingMarkdownImpl)
