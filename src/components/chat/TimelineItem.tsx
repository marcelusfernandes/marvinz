import type { ReactNode } from 'react'

export type TimelineDotState =
  | 'outline'
  | 'green'
  | 'amber'
  | 'red'
  | 'running'

type Props = {
  kind: 'thinking' | 'text' | 'tool'
  dotState?: TimelineDotState
  children: ReactNode
}

/**
 * Single bullet item in the assistant timeline. Renders a dot + body slot.
 * Connector line between bullets is drawn by ::before in chat.css (see
 * design doc §6.2 "Timeline pattern").
 *
 * Asymmetric bubble rule: assistant content has NO container. Bullets float
 * directly on the panel bg.
 */
export function TimelineItem({ kind, dotState = 'outline', children }: Props) {
  return (
    <li
      className="chat-timeline-item"
      data-kind={kind}
    >
      <span
        className="chat-timeline-dot"
        data-state={dotState}
        aria-hidden="true"
      />
      <div className="chat-timeline-body">{children}</div>
    </li>
  )
}
