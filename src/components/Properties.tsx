import {
  detectType,
  formatDate,
  normalizeTags,
  type Frontmatter,
  type PropertyType,
} from '../lib/frontmatter'

type Props = {
  data: Frontmatter
}

export function Properties({ data }: Props) {
  const entries = Object.entries(data)
  if (entries.length === 0) return null
  return (
    <div className="props-panel">
      <ul className="props-list">
        {entries.map(([key, value]) => {
          const type = detectType(key, value)
          return (
            <li key={key} className="prop-row" data-type={type}>
              <span className="prop-icon" aria-hidden>
                <PropertyIcon type={type} />
              </span>
              <span className="prop-key">{key}</span>
              <span className="prop-value">
                <PropertyValue value={value} type={type} />
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function PropertyValue({ value, type }: { value: unknown; type: PropertyType }) {
  switch (type) {
    case 'empty':
      return <span className="prop-empty">Empty</span>
    case 'boolean':
      return (
        <span className="prop-bool">
          <span className={`prop-bool-box${value ? ' checked' : ''}`} aria-hidden />
          <span>{value ? 'true' : 'false'}</span>
        </span>
      )
    case 'number':
      return <span className="prop-number">{String(value)}</span>
    case 'date':
      return <span className="prop-date">{formatDate(value)}</span>
    case 'tags': {
      const items = normalizeTags(value)
      if (items.length === 0) return <span className="prop-empty">Empty</span>
      return (
        <span className="prop-pills">
          {items.map((item, i) => (
            <span key={i} className="prop-pill prop-pill-tag">
              <span className="prop-pill-hash">#</span>
              {item}
            </span>
          ))}
        </span>
      )
    }
    case 'list': {
      const items = (value as unknown[]).map(formatPrimitive)
      return (
        <span className="prop-pills">
          {items.map((item, i) => (
            <span key={i} className="prop-pill">
              {item}
            </span>
          ))}
        </span>
      )
    }
    case 'object':
      return <span className="prop-object">{`{${Object.keys(value as object).length} keys}`}</span>
    case 'string':
    default:
      return <span className="prop-string">{String(value)}</span>
  }
}

function formatPrimitive(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) return formatDate(v)
  if (typeof v === 'object') return `{${Object.keys(v as object).length} keys}`
  return String(v)
}

function PropertyIcon({ type }: { type: PropertyType }) {
  // 16x16 viewBox, currentColor, stroke-based when reasonable.
  switch (type) {
    case 'number':
      return (
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <path d="M5 2.5 L3.5 13.5" />
          <path d="M12.5 2.5 L11 13.5" />
          <path d="M2.5 5.5 L13.5 5.5" />
          <path d="M2.5 10.5 L13.5 10.5" />
        </svg>
      )
    case 'boolean':
      return (
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4">
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
          <path d="M5 8 L7.2 10.2 L11 5.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'date':
      return (
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
          <path d="M2.5 6.5 L13.5 6.5" />
          <path d="M5.5 2 L5.5 5" />
          <path d="M10.5 2 L10.5 5" />
        </svg>
      )
    case 'tags':
      return (
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 8 L8 2 L13.5 2 L13.5 7.5 L7.5 13.5 Z" />
          <circle cx="10.5" cy="5" r="0.7" fill="currentColor" />
        </svg>
      )
    case 'list':
      return (
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <circle cx="3.5" cy="4" r="0.7" fill="currentColor" stroke="none" />
          <circle cx="3.5" cy="8" r="0.7" fill="currentColor" stroke="none" />
          <circle cx="3.5" cy="12" r="0.7" fill="currentColor" stroke="none" />
          <path d="M6.5 4 L13.5 4" />
          <path d="M6.5 8 L13.5 8" />
          <path d="M6.5 12 L13.5 12" />
        </svg>
      )
    case 'object':
      return (
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5.5 2 C 4 2 4 4 4 5.5 C 4 7 3 8 2 8 C 3 8 4 9 4 10.5 C 4 12 4 14 5.5 14" />
          <path d="M10.5 2 C 12 2 12 4 12 5.5 C 12 7 13 8 14 8 C 13 8 12 9 12 10.5 C 12 12 12 14 10.5 14" />
        </svg>
      )
    case 'empty':
      return (
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <path d="M3.5 8 L12.5 8" />
        </svg>
      )
    case 'string':
    default:
      return (
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <path d="M3 4.5 L13 4.5" />
          <path d="M3 8 L13 8" />
          <path d="M3 11.5 L9 11.5" />
        </svg>
      )
  }
}
