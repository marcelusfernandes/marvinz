import { describe, it, expect } from 'vitest'
import { scanSourceForIconNames, isIconLikeLiteral } from '../scan-icon-usage.cjs'

function scan(source: string, fileName = 'sample.tsx'): Set<string> {
  const names = new Set<string>()
  scanSourceForIconNames(source, fileName, names)
  return names
}

describe('scanSourceForIconNames', () => {
  it('rule A: extracts a literal <Icon name="X"> prop', () => {
    const names = scan('function C() { return <Icon name="check" /> }')
    expect(names).toEqual(new Set(['check']))
  })

  it('rule A: extracts both branches of a ternary name prop, including nested ternaries', () => {
    const names = scan(
      'function C() { return <Icon name={a ? "chevron-up" : b ? "chevron-down" : "dash"} /> }'
    )
    expect(names).toEqual(new Set(['chevron-up', 'chevron-down', 'dash']))
  })

  it('rule A: ignores name props on JSX elements that are not <Icon>', () => {
    const names = scan('function C() { return <OtherThing name="not-an-icon" /> }')
    expect(names).toEqual(new Set())
  })

  it('rule A: skips a name prop that cannot be statically resolved (identifier/call)', () => {
    const names = scan('function C() { return <Icon name={fileIconFor(path)} /> }')
    expect(names).toEqual(new Set())
  })

  it('rule B: extracts a property literally named `icon` in an object literal', () => {
    const names = scan(`
      const cards = [
        { id: 'browser', icon: 'globe', title: 'Browser' },
        { id: 'note', icon: 'new-file', title: 'New note' },
      ]
    `)
    expect(names).toEqual(new Set(['globe', 'new-file']))
  })

  it('rule B: does not extract sibling properties with other names', () => {
    const names = scan(`const x = { type: 'string', label: 'Text', icon: 'symbol-string' }`)
    expect(names).toEqual(new Set(['symbol-string']))
  })

  it('rule C: extracts every value from a Record<string, IconName>-typed table', () => {
    const names = scan(`
      const EXTENSION_TO_ICON: Record<string, IconName> = {
        md: 'markdown',
        csv: 'table',
        json: 'json',
      }
    `)
    expect(names).toEqual(new Set(['markdown', 'table', 'json']))
  })

  it('rule C: extracts every value from a Record<K, V> table whose value type is an inline string-literal union (not literally named IconName)', () => {
    const names = scan(`
      const PROP_ICON_BY_TYPE: Record<
        PropertyType,
        'symbol-string' | 'symbol-numeric' | 'symbol-boolean' | 'calendar'
      > = {
        string: 'symbol-string',
        number: 'symbol-numeric',
        boolean: 'symbol-boolean',
        date: 'calendar',
      }
    `)
    expect(names).toEqual(
      new Set(['symbol-string', 'symbol-numeric', 'symbol-boolean', 'calendar'])
    )
  })

  it('rule C: does not sweep in sibling fields of an Array<{...; icon: IconName}>-typed table (only rule B covers those)', () => {
    const names = scan(`
      const PROP_TYPES_FOR_PICKER: Array<{ type: PropertyType; label: string; icon: IconName }> = [
        { type: 'string', label: 'Text', icon: 'symbol-string' },
        { type: 'number', label: 'Number', icon: 'symbol-numeric' },
      ]
    `)
    // 'string' and 'number' (the `type` field's values) must NOT appear —
    // only rule B's `icon:` match should fire here.
    expect(names).toEqual(new Set(['symbol-string', 'symbol-numeric']))
  })

  it('rule D: extracts return values from a function whose declared return type is IconName', () => {
    const names = scan(`
      const EXTENSION_TO_ICON: Record<string, IconName> = { md: 'markdown' }
      export function fileIconFor(name: string): IconName {
        const idx = name.lastIndexOf('.')
        if (idx <= 0) return 'file'
        const ext = name.slice(idx + 1).toLowerCase()
        return EXTENSION_TO_ICON[ext] ?? 'file'
      }
    `)
    expect(names).toEqual(new Set(['markdown', 'file']))
  })

  it('rule D: does not descend into a nested function with an unrelated return type', () => {
    const names = scan(`
      function outer(): IconName {
        const helper = (): string => 'not-an-icon-name'
        return 'check'
      }
    `)
    expect(names).toEqual(new Set(['check']))
  })

  it('combines all four rules across one file without cross-contamination', () => {
    const names = scan(`
      const EXTENSION_TO_ICON: Record<string, IconName> = { md: 'markdown' }
      export function fileIconFor(name: string): IconName {
        return EXTENSION_TO_ICON[name] ?? 'file'
      }
      const cards = [{ id: 'browser', icon: 'globe' }]
      function C() {
        return <Icon name={open ? 'folder-opened' : 'folder'} />
      }
    `)
    expect(names).toEqual(new Set(['markdown', 'file', 'globe', 'folder-opened', 'folder']))
  })

  it('parses .tsx-specific JSX syntax when fileName ends with .tsx', () => {
    const names = scan('export const C = () => <Icon name="save" />', 'Component.tsx')
    expect(names).toEqual(new Set(['save']))
  })
})

describe('isIconLikeLiteral', () => {
  it('accepts kebab-case identifiers', () => {
    expect(isIconLikeLiteral('check')).toBe(true)
    expect(isIconLikeLiteral('layout-sidebar-left-off')).toBe(true)
  })

  it('rejects non-kebab-case strings', () => {
    expect(isIconLikeLiteral('Check')).toBe(false)
    expect(isIconLikeLiteral('check_mark')).toBe(false)
    expect(isIconLikeLiteral('check mark')).toBe(false)
    expect(isIconLikeLiteral('')).toBe(false)
    expect(isIconLikeLiteral('-check')).toBe(false)
  })
})
