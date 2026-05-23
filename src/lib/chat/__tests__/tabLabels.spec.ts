// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest'
import { readTabLabels, writeTabLabels, clearTabLabel } from '../tabLabels'

const STORAGE_KEY = 'marvin.tabLabels'

beforeEach(() => {
  localStorage.clear()
})

describe('readTabLabels', () => {
  it('returns {} when the localStorage key is missing', () => {
    expect(readTabLabels()).toEqual({})
  })

  it('returns {} when the stored value is invalid JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{invalid json}')
    expect(readTabLabels()).toEqual({})
  })

  it('returns {} when the stored value is a JSON array', () => {
    localStorage.setItem(STORAGE_KEY, '["a","b"]')
    expect(readTabLabels()).toEqual({})
  })

  it('returns the stored map when the key contains valid JSON', () => {
    const labels = { tab1: 'My Agent', tab2: 'Another' }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(labels))
    expect(readTabLabels()).toEqual(labels)
  })

  it('ignores entries whose value is not a string', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tab1: 'ok', tab2: 42 }))
    expect(readTabLabels()).toEqual({ tab1: 'ok' })
  })
})

describe('writeTabLabels', () => {
  it('persists the object so a subsequent readTabLabels returns the same data', () => {
    const labels = { tabA: 'Label A', tabB: 'Label B' }
    writeTabLabels(labels)
    expect(readTabLabels()).toEqual(labels)
  })

  it('overwrites a previous write', () => {
    writeTabLabels({ tab1: 'first' })
    writeTabLabels({ tab1: 'second' })
    expect(readTabLabels()).toEqual({ tab1: 'second' })
  })
})

describe('clearTabLabel', () => {
  it('removes only the specified key, leaving others intact', () => {
    writeTabLabels({ keep: 'Keep Me', remove: 'Remove Me' })
    clearTabLabel('remove')
    expect(readTabLabels()).toEqual({ keep: 'Keep Me' })
  })

  it('does nothing when the key does not exist', () => {
    writeTabLabels({ tab1: 'Label' })
    clearTabLabel('nonexistent')
    expect(readTabLabels()).toEqual({ tab1: 'Label' })
  })

  it('results in an empty map when the last key is removed', () => {
    writeTabLabels({ only: 'One' })
    clearTabLabel('only')
    expect(readTabLabels()).toEqual({})
  })
})
