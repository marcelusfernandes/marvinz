type Props = {
  text: string
  matches: number[]
  /** When set, only highlight indices < bound. Used to ignore matches that
   * fell on the basename portion when we already highlight that separately. */
  bound?: number
}

export function HighlightedMatch({ text, matches, bound }: Props) {
  if (matches.length === 0) return <>{text}</>
  const filtered = bound != null ? matches.filter((i) => i < bound) : matches
  if (filtered.length === 0) return <>{text}</>
  const parts: Array<string | React.ReactElement> = []
  let cursor = 0
  for (const i of filtered) {
    if (i > cursor) parts.push(text.slice(cursor, i))
    parts.push(<mark key={i}>{text[i]}</mark>)
    cursor = i + 1
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}
