import { describe, it, expect } from 'vitest'
import { BoundedCache } from '../bounded-cache.js'

describe('BoundedCache — basic Map-like behavior', () => {
  it('returns undefined for a missing key', () => {
    const cache = new BoundedCache<string, string>(3)
    expect(cache.get('missing')).toBeUndefined()
  })

  it('round-trips a set value through get', () => {
    const cache = new BoundedCache<string, string>(3)
    cache.set('a', '1')
    expect(cache.get('a')).toBe('1')
  })

  it('delete removes an entry', () => {
    const cache = new BoundedCache<string, string>(3)
    cache.set('a', '1')
    cache.delete('a')
    expect(cache.get('a')).toBeUndefined()
  })

  it('clear empties every entry', () => {
    const cache = new BoundedCache<string, string>(3)
    cache.set('a', '1')
    cache.set('b', '2')
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeUndefined()
  })

  it('size reflects the current entry count', () => {
    const cache = new BoundedCache<string, string>(5)
    cache.set('a', '1')
    cache.set('b', '2')
    expect(cache.size).toBe(2)
  })
})

describe('BoundedCache — LRU eviction bound (#568)', () => {
  it('never exceeds maxEntries after inserting beyond the cap', () => {
    const cache = new BoundedCache<string, string>(3)
    for (let i = 0; i < 10; i++) cache.set(`key-${i}`, `value-${i}`)
    expect(cache.size).toBe(3)
  })

  it('evicts the least-recently-set entry once the cap is exceeded', () => {
    const cache = new BoundedCache<string, string>(3)
    cache.set('a', '1')
    cache.set('b', '2')
    cache.set('c', '3')
    cache.set('d', '4') // pushes out 'a', the oldest

    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe('2')
    expect(cache.get('c')).toBe('3')
    expect(cache.get('d')).toBe('4')
  })

  it('get() refreshes recency, protecting a re-accessed entry from eviction', () => {
    const cache = new BoundedCache<string, string>(3)
    cache.set('a', '1')
    cache.set('b', '2')
    cache.set('c', '3')

    cache.get('a') // 'a' is now the most-recently-used, not the oldest

    cache.set('d', '4') // must evict 'b' (now the oldest), not 'a'

    expect(cache.get('a')).toBe('1')
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe('3')
    expect(cache.get('d')).toBe('4')
  })

  it('re-setting an existing key refreshes recency without growing size', () => {
    const cache = new BoundedCache<string, string>(3)
    cache.set('a', '1')
    cache.set('b', '2')
    cache.set('c', '3')

    cache.set('a', '1-updated') // re-set — protects 'a' from eviction

    cache.set('d', '4') // must evict 'b', not 'a'

    expect(cache.size).toBe(3)
    expect(cache.get('a')).toBe('1-updated')
    expect(cache.get('b')).toBeUndefined()
  })
})
