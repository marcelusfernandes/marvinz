import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  closeOpenMarkdown,
  advanceBlockScan,
  renderBlocks,
  EMPTY_BLOCK_SCAN_STATE,
  type BlockScanState,
} from '../../lib/chat/markdown'

type Props = {
  text: string
  /** When true, append a blinking cursor sentinel inline with the rendered text. */
  streaming?: boolean
}

const remarkPlugins = [remarkGfm]

type BlockProps = { text: string }

// Memoized so a completed block (never the trailing one) is never re-parsed
// by ReactMarkdown once a later block exists after it — see advanceBlockScan.
function MarkdownBlockImpl({ text }: BlockProps) {
  return <ReactMarkdown remarkPlugins={remarkPlugins}>{text}</ReactMarkdown>
}
const MarkdownBlock = memo(MarkdownBlockImpl)

type ScanSnapshot = { text: string; state: BlockScanState }

/**
 * Resumes a block scan across renders instead of rescanning `text` from
 * scratch each time (#592) — cost per render is proportional to the new
 * suffix since the last render, not to the total accumulated text. Uses
 * React's documented "adjust state during render" escape hatch (calling
 * setState while rendering, not a ref mutation) so this stays compatible
 * with the React Compiler. The state is naturally scoped to one streaming
 * message: AssistantMessageCard mounts a fresh StreamingMarkdown (and hence
 * fresh state) per text block.
 */
function useBlockScan(text: string, active: boolean): BlockScanState | null {
  const [snapshot, setSnapshot] = useState<ScanSnapshot | null>(null)

  if (!active) {
    if (snapshot !== null) setSnapshot(null)
    return null
  }
  if (snapshot === null || text.length < snapshot.text.length) {
    const next = { text, state: advanceBlockScan(EMPTY_BLOCK_SCAN_STATE, text) }
    setSnapshot(next)
    return next.state
  }
  if (text !== snapshot.text) {
    const next = { text, state: advanceBlockScan(snapshot.state, text) }
    setSnapshot(next)
    return next.state
  }
  return snapshot.state
}

function StreamingMarkdownImpl({ text, streaming = false }: Props) {
  // While streaming, resume the block scan so completed blocks (everything
  // confirmed before the still-open tail) can be memoized instead of
  // re-parsed on every delta. Once done, render the raw text in one shot —
  // identical to the pre-#591 behavior, so the final rendered output for a
  // completed message never depends on how the split happened to land
  // mid-stream.
  const scan = useBlockScan(text, streaming)

  if (!streaming || !scan) {
    return (
      <span className="chat-md">
        <ReactMarkdown remarkPlugins={remarkPlugins}>{text}</ReactMarkdown>
      </span>
    )
  }

  // completed/trailing are derived per render (cheap — bounded by the still-
  // growing last line, see renderBlocks) so a not-yet-newline-terminated tail
  // can still confirm an earlier boundary, matching #591's exact behavior.
  const { completed, trailing } = renderBlocks(scan)

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
