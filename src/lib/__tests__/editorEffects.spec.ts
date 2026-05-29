import { describe, it, expect } from 'vitest'
import { isLargeDoc } from '../editorEffects'

describe('isLargeDoc', () => {
  it('returns true past 50000 chars', () => {
    expect(isLargeDoc('a'.repeat(50001))).toBe(true)
  })

  it('returns true past 5000 lines', () => {
    expect(isLargeDoc('\n'.repeat(5000))).toBe(true)
  })

  it('returns false for a small document', () => {
    expect(isLargeDoc('a'.repeat(100) + '\nsecond line')).toBe(false)
  })

  it('returns false at the char and line boundaries', () => {
    expect(isLargeDoc('a'.repeat(50000))).toBe(false)
    expect(isLargeDoc('\n'.repeat(4999))).toBe(false)
  })

  it('returns false for an empty document', () => {
    expect(isLargeDoc('')).toBe(false)
  })
})
