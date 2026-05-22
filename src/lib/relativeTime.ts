const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const delta = now - timestamp
  if (delta < 0) return 'just now'
  if (delta < 45 * SECOND) return 'just now'
  if (delta < MINUTE) return 'less than 1 min ago'
  if (delta < HOUR) {
    const m = Math.round(delta / MINUTE)
    return `${m} min ago`
  }
  if (delta < DAY) {
    const h = Math.round(delta / HOUR)
    return `${h} ${h === 1 ? 'hour' : 'hours'} ago`
  }
  const d = Math.round(delta / DAY)
  if (d < 7) return `${d} ${d === 1 ? 'day' : 'days'} ago`
  return new Date(timestamp).toLocaleString()
}

export function formatAbsoluteTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}
