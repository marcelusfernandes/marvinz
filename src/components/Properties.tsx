import { useEffect, useRef, useState } from 'react'
import {
  detectType,
  formatDate,
  normalizeTags,
  type Frontmatter,
  type PropertyType,
} from '../lib/frontmatter'
import { Icon } from './Icon'

type Props = {
  data: Frontmatter
  onChange: (next: Frontmatter) => void
}

export function Properties({ data, onChange }: Props) {
  const entries = Object.entries(data)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const updateKey = (key: string, value: unknown) => {
    const next = { ...data, [key]: value }
    onChange(next)
  }

  const renameKey = (oldKey: string, newKey: string) => {
    if (!newKey || newKey === oldKey) return
    if (newKey in data) return // refuse silent overwrite
    const next: Frontmatter = {}
    for (const [k, v] of Object.entries(data)) {
      next[k === oldKey ? newKey : k] = v
    }
    onChange(next)
  }

  const removeKey = (key: string) => {
    const next: Frontmatter = {}
    for (const [k, v] of Object.entries(data)) {
      if (k !== key) next[k] = v
    }
    onChange(next)
  }

  const addProperty = (key: string, type: PropertyType) => {
    if (!key || key in data) return
    const initial = defaultValueForType(type)
    onChange({ ...data, [key]: initial })
    setAdding(false)
    setEditing(key)
  }

  return (
    <div className="props-panel">
      <ul className="props-list">
        {entries.map(([key, value]) => {
          const type = detectType(key, value)
          return (
            <PropertyRow
              key={key}
              propKey={key}
              value={value}
              type={type}
              isEditing={editing === key}
              onStartEdit={() => setEditing(key)}
              onCommit={(nextValue) => {
                updateKey(key, nextValue)
                setEditing(null)
              }}
              onCancel={() => setEditing(null)}
              onRenameKey={(newKey) => renameKey(key, newKey)}
              onRemove={() => removeKey(key)}
            />
          )
        })}
      </ul>
      {adding ? (
        <AddPropertyRow
          onSubmit={addProperty}
          onCancel={() => setAdding(false)}
          existingKeys={new Set(entries.map(([k]) => k))}
        />
      ) : (
        <button type="button" className="props-add" onClick={() => setAdding(true)}>
          + Add property
        </button>
      )}
    </div>
  )
}

function defaultValueForType(type: PropertyType): unknown {
  switch (type) {
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'date':
      return new Date().toISOString().slice(0, 10)
    case 'tags':
    case 'list':
      return []
    case 'object':
      return {}
    default:
      return ''
  }
}

function PropertyRow({
  propKey,
  value,
  type,
  isEditing,
  onStartEdit,
  onCommit,
  onCancel,
  onRenameKey,
  onRemove,
}: {
  propKey: string
  value: unknown
  type: PropertyType
  isEditing: boolean
  onStartEdit: () => void
  onCommit: (next: unknown) => void
  onCancel: () => void
  onRenameKey: (newKey: string) => void
  onRemove: () => void
}) {
  return (
    <li className="prop-row" data-type={type}>
      <span className="prop-icon" aria-hidden>
        <PropertyIcon type={type} />
      </span>
      <KeyEditor name={propKey} onRename={onRenameKey} />
      <span className="prop-value">
        <ValueEditor
          value={value}
          type={type}
          editing={isEditing}
          onStartEdit={onStartEdit}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      </span>
      <button
        type="button"
        className="prop-remove"
        title="Remove property"
        aria-label={`Remove ${propKey}`}
        onClick={onRemove}
      >
        <Icon name="close"/>
      </button>
    </li>
  )
}

function KeyEditor({ name, onRename }: { name: string; onRename: (next: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)

  useEffect(() => setDraft(name), [name])

  if (!editing) {
    return (
      <span className="prop-key" onDoubleClick={() => setEditing(true)} title="Double-click to rename">
        {name}
      </span>
    )
  }
  const commit = () => {
    setEditing(false)
    if (draft.trim() && draft.trim() !== name) onRename(draft.trim())
  }
  return (
    <input
      className="prop-key-input"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        else if (e.key === 'Escape') {
          setEditing(false)
          setDraft(name)
        }
      }}
    />
  )
}

function ValueEditor({
  value,
  type,
  editing,
  onStartEdit,
  onCommit,
  onCancel,
}: {
  value: unknown
  type: PropertyType
  editing: boolean
  onStartEdit: () => void
  onCommit: (next: unknown) => void
  onCancel: () => void
}) {
  if (type === 'boolean') {
    // Toggle is always live; no separate edit mode.
    return (
      <button
        type="button"
        className="prop-bool"
        onClick={() => onCommit(!value)}
        aria-pressed={Boolean(value)}
      >
        <span className={`prop-bool-box${value ? ' checked' : ''}`} aria-hidden />
        <span>{value ? 'true' : 'false'}</span>
      </button>
    )
  }

  if (type === 'object') {
    return <span className="prop-object">{`{${Object.keys(value as object).length} keys}`}</span>
  }

  if (type === 'tags') {
    return <TagsEditor value={value} onCommit={onCommit} />
  }

  if (type === 'list') {
    return <ListEditor value={value} onCommit={onCommit} />
  }

  if (!editing) {
    return (
      <button type="button" className="prop-display" onClick={onStartEdit}>
        <ValueDisplay value={value} type={type} />
      </button>
    )
  }

  return (
    <SimpleInput
      type={type}
      value={value}
      onCommit={onCommit}
      onCancel={onCancel}
    />
  )
}

function ValueDisplay({ value, type }: { value: unknown; type: PropertyType }) {
  if (type === 'empty') return <span className="prop-empty">Empty</span>
  if (type === 'date') return <span className="prop-date">{formatDate(value)}</span>
  if (type === 'number') return <span className="prop-number">{String(value)}</span>
  return <span className="prop-string">{String(value)}</span>
}

function SimpleInput({
  type,
  value,
  onCommit,
  onCancel,
}: {
  type: PropertyType
  value: unknown
  onCommit: (next: unknown) => void
  onCancel: () => void
}) {
  const initial =
    type === 'date'
      ? toDateInputValue(value)
      : value == null
        ? ''
        : String(value)
  const [draft, setDraft] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select?.()
  }, [])

  const inputType = type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'

  const commit = () => {
    if (type === 'number') {
      const n = Number(draft)
      onCommit(Number.isFinite(n) ? n : draft)
    } else {
      onCommit(draft)
    }
  }

  return (
    <input
      ref={ref}
      className="prop-input"
      type={inputType}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit()
        } else if (e.key === 'Escape') {
          onCancel()
        }
      }}
    />
  )
}

function toDateInputValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/)
    if (m) return m[1]
    const d = new Date(value)
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
  }
  return ''
}

function TagsEditor({
  value,
  onCommit,
}: {
  value: unknown
  onCommit: (next: unknown) => void
}) {
  const tags = normalizeTags(value)
  const [draft, setDraft] = useState('')

  const remove = (i: number) => {
    const next = tags.filter((_, idx) => idx !== i)
    onCommit(next)
  }

  const add = () => {
    const trimmed = draft.trim().replace(/^#/, '')
    if (!trimmed) return
    if (tags.includes(trimmed)) {
      setDraft('')
      return
    }
    onCommit([...tags, trimmed])
    setDraft('')
  }

  return (
    <span className="prop-pills editable">
      {tags.map((tag, i) => (
        <span key={`${tag}-${i}`} className="prop-pill prop-pill-tag">
          <span className="prop-pill-hash">#</span>
          {tag}
          <button
            type="button"
            className="prop-pill-remove"
            aria-label={`Remove ${tag}`}
            onClick={() => remove(i)}
          >
            <Icon name="close"/>
          </button>
        </span>
      ))}
      <input
        className="prop-pill-input"
        placeholder="add tag…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',' || (e.key === 'Tab' && draft.trim())) {
            e.preventDefault()
            add()
          } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
            remove(tags.length - 1)
          }
        }}
        onBlur={add}
      />
    </span>
  )
}

function ListEditor({
  value,
  onCommit,
}: {
  value: unknown
  onCommit: (next: unknown) => void
}) {
  const items = Array.isArray(value) ? value.map((v) => String(v)) : []
  const [draft, setDraft] = useState('')

  const remove = (i: number) => {
    const next = items.filter((_, idx) => idx !== i)
    onCommit(next)
  }

  const add = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    onCommit([...items, trimmed])
    setDraft('')
  }

  return (
    <span className="prop-pills editable">
      {items.map((item, i) => (
        <span key={`${item}-${i}`} className="prop-pill">
          {item}
          <button
            type="button"
            className="prop-pill-remove"
            aria-label={`Remove ${item}`}
            onClick={() => remove(i)}
          >
            <Icon name="close"/>
          </button>
        </span>
      ))}
      <input
        className="prop-pill-input"
        placeholder="add item…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',' || (e.key === 'Tab' && draft.trim())) {
            e.preventDefault()
            add()
          } else if (e.key === 'Backspace' && draft === '' && items.length > 0) {
            remove(items.length - 1)
          }
        }}
        onBlur={add}
      />
    </span>
  )
}

function AddPropertyRow({
  onSubmit,
  onCancel,
  existingKeys,
}: {
  onSubmit: (key: string, type: PropertyType) => void
  onCancel: () => void
  existingKeys: Set<string>
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<PropertyType>('string')

  const submit = () => {
    const key = name.trim()
    if (!key || existingKeys.has(key)) return
    onSubmit(key, type)
  }

  return (
    <div className="props-add-row">
      <input
        autoFocus
        className="prop-input"
        placeholder="property name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') onCancel()
        }}
      />
      <select
        className="prop-type-select"
        value={type}
        onChange={(e) => setType(e.target.value as PropertyType)}
      >
        <option value="string">Text</option>
        <option value="number">Number</option>
        <option value="boolean">Checkbox</option>
        <option value="date">Date</option>
        <option value="tags">Tags</option>
        <option value="list">List</option>
      </select>
      <button type="button" className="props-add-btn primary" onClick={submit}>
        Add
      </button>
      <button type="button" className="props-add-btn ghost" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

const PROP_ICON_BY_TYPE: Record<PropertyType, 'symbol-string' | 'symbol-numeric' | 'symbol-boolean' | 'calendar' | 'tag' | 'list-unordered' | 'json' | 'dash'> = {
  string: 'symbol-string',
  number: 'symbol-numeric',
  boolean: 'symbol-boolean',
  date: 'calendar',
  tags: 'tag',
  list: 'list-unordered',
  object: 'json',
  empty: 'dash',
}

function PropertyIcon({ type }: { type: PropertyType }) {
  return <Icon name={PROP_ICON_BY_TYPE[type]} size={14} />
}
