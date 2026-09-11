/**
 * A Map with a hard cap on entry count, evicting the least-recently-used
 * entry (by get/set recency) once the cap is exceeded. Used to bound
 * fileContentCache, which would otherwise grow without limit across a long
 * session touching many files (#568).
 */
export class BoundedCache<K, V> {
  private readonly map = new Map<K, V>()
  private readonly maxEntries: number

  constructor(maxEntries: number) {
    if (maxEntries < 1) throw new Error('BoundedCache requires maxEntries >= 1')
    this.maxEntries = maxEntries
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined
    const value = this.map.get(key) as V
    // Map preserves insertion order — delete+re-set moves this key to the
    // end (most-recently-used), so the oldest entry is always map.keys().next().
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: K, value: V): void {
    this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value as K
      this.map.delete(oldestKey)
    }
  }

  delete(key: K): boolean {
    return this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }

  get size(): number {
    return this.map.size
  }
}
