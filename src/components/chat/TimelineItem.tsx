import type { ReactNode } from 'react'

export type TimelineDotState =
  | 'outline'
  | 'green'
  | 'amber'
  | 'red'
  | 'running'

export type TimelineKind = 'thinking' | 'text' | 'tool'

type Props = {
  kind: TimelineKind
  dotState?: TimelineDotState
  /**
   * Optional inline header row rendered before children. Tool cards use this
   * for the "<ToolName> <filename pill>" line; thinking/text items leave it
   * undefined and pass content through children.
   */
  header?: ReactNode
  /**
   * Optional ARIA label for the dot. Falls back to dotState-derived text so
   * screen readers can announce state transitions (pending, running, etc.).
   */
  dotLabel?: string
  children?: ReactNode
}

const DOT_DEFAULT_LABEL: Record<TimelineDotState, string> = {
  outline: 'Idle',
  green: 'Success',
  amber: 'Awaiting approval',
  red: 'Error',
  running: 'Running',
}

export function TimelineItem({
  kind,
  dotState = 'outline',
  header,
  dotLabel,
  children,
}: Props) {
  // Tools encode their state semantically via the dot color (amber pending,
  // green ok, red error, etc.) — expose it to assistive tech. Thinking/text
  // items use the dot as pure decoration; the body text already announces
  // them.
  const dotIsSemantic = kind === 'tool'
  const dotProps = dotIsSemantic
    ? {
        role: 'img' as const,
        'aria-label': dotLabel ?? DOT_DEFAULT_LABEL[dotState],
      }
    : { 'aria-hidden': true as const }
  return (
    <li className="chat-timeline-item" data-kind={kind}>
      <span
        className="chat-timeline-dot"
        data-state={dotState}
        {...dotProps}
      />
      <div className="chat-timeline-body">
        {header !== undefined && (
          <div className="chat-timeline-header">{header}</div>
        )}
        {children}
      </div>
    </li>
  )
}
