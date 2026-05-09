import { parse as parseYAML } from 'yaml'

export type Frontmatter = Record<string, unknown>

export type SplitResult = {
  /** Parsed YAML object, or null if absent / empty / malformed. */
  data: Frontmatter | null
  /** Markdown body after the frontmatter block. */
  body: string
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

export function splitFrontmatter(content: string): SplitResult {
  const match = content.match(FRONTMATTER_RE)
  if (!match) return { data: null, body: content }

  const yamlText = match[1].trim()
  if (!yamlText) {
    // Empty frontmatter block — drop it entirely from preview.
    return { data: null, body: content.slice(match[0].length) }
  }

  let data: Frontmatter | null
  try {
    const parsed = parseYAML(yamlText)
    data = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Frontmatter)
      : null
  } catch {
    // Malformed YAML: fall back to showing the raw block as content
    // (so the user sees the broken YAML instead of silently losing it).
    return { data: null, body: content }
  }

  if (!data || Object.keys(data).length === 0) {
    return { data: null, body: content.slice(match[0].length) }
  }
  return { data, body: content.slice(match[0].length) }
}

export type PropertyType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'list'
  | 'tags'
  | 'object'
  | 'empty'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

const TAG_KEYS = new Set(['tags', 'aliases'])

export function detectType(key: string, value: unknown): PropertyType {
  if (value == null || value === '') return 'empty'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (value instanceof Date) return 'date'
  if (Array.isArray(value)) {
    return TAG_KEYS.has(key) ? 'tags' : 'list'
  }
  if (typeof value === 'object') return 'object'
  if (typeof value === 'string') {
    if (TAG_KEYS.has(key)) return 'tags'
    if (ISO_DATE_RE.test(value)) return 'date'
  }
  return 'string'
}

/**
 * Normalize a tags-like value to a string array. Accepts:
 *   - already-an-array: ['a', 'b']
 *   - comma-separated string: "a, b, c"
 *   - single string: "a"
 */
export function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean)
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => s.trim().replace(/^#/, ''))
      .filter(Boolean)
  }
  return []
}

export function formatDate(value: unknown): string {
  const d = value instanceof Date ? value : new Date(String(value))
  if (isNaN(d.getTime())) return String(value)
  // Hide time when it's midnight UTC (date-only input)
  const hasTime = typeof value === 'string' && /T/.test(value)
  return hasTime
    ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : d.toLocaleDateString(undefined, { dateStyle: 'medium' })
}
