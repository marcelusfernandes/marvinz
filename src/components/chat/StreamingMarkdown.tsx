import { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { closeOpenMarkdown } from '../../lib/chat/markdown'

type Props = {
  text: string
  /** When true, append a blinking cursor sentinel inline with the rendered text. */
  streaming?: boolean
}

const remarkPlugins = [remarkGfm]

function StreamingMarkdownImpl({ text, streaming = false }: Props) {
  // While streaming, speculatively close open markers so the parser doesn't
  // bail on partial input. When done, render the raw text — react-markdown
  // memoizes well and skips full reparses if the text is stable.
  const source = useMemo(
    () => (streaming ? closeOpenMarkdown(text) : text),
    [text, streaming],
  )
  return (
    <span className={`chat-md${streaming ? ' streaming' : ''}`}>
      <ReactMarkdown remarkPlugins={remarkPlugins}>{source}</ReactMarkdown>
    </span>
  )
}

export const StreamingMarkdown = memo(StreamingMarkdownImpl)
