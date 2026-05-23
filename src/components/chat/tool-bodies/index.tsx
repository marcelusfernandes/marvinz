import type { ComponentType } from 'react'
import { BashCard } from './BashCard'
import { ReadCard } from './ReadCard'
import { WriteCard } from './WriteCard'
import { AgentCard } from './AgentCard'
import { GenericToolCard } from './GenericToolCard'
import type { ToolBodyProps } from './types'

/**
 * Resolve a tool body component from the tool name. Unknown tools fall back
 * to GenericToolCard so the timeline never crashes on a CLI-added tool that
 * the renderer wasn't built against.
 */
export function ToolBody(props: ToolBodyProps) {
  const Component = pickToolBody(props.tool)
  return <Component {...props} />
}

function pickToolBody(tool: string): ComponentType<ToolBodyProps> {
  switch (tool) {
    case 'Bash':
    case 'bash':
      return BashCard
    case 'Read':
    case 'read_file':
      return ReadCard
    case 'Write':
    case 'Edit':
    case 'edit_file':
    case 'create_file':
      return WriteCard
    case 'Agent':
    case 'Task':
    case 'spawn_agent':
      return AgentCard
    default:
      return GenericToolCard
  }
}

export { BashCard, ReadCard, WriteCard, AgentCard, GenericToolCard }
