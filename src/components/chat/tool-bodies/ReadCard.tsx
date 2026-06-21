import { memo } from 'react'
import type { ToolBodyProps } from './types'
import { basename, readPath } from './types'

/**
 * Read tool card. Compact one-liner — just the filename pill since reads are
 * passive and the user rarely needs to see the bytes returned inline.
 */
function ReadCardImpl({ tool, input, status }: ToolBodyProps) {
  const path = readPath(input)
  return (
    <div className="chat-tool-card chat-tool-card-read" data-tool={tool}>
      <span className="chat-tool-pill" title={path ?? undefined}>
        {path ? basename(path) : '(no path)'}
      </span>
      {status === 'error' && <span className="chat-tool-error-label">read failed</span>}
    </div>
  )
}

export const ReadCard = memo(ReadCardImpl)
