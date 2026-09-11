import { describe, it, expect } from 'vitest'
import { toolStatusLabel } from '../tool-bodies/types'

// The single source of truth for ToolStatus → label (#584). Exhaustiveness over
// the union is enforced at compile time by the trailing `never` assignment in
// the helper; this pins the concrete wording each status resolves to.
describe('toolStatusLabel (#584)', () => {
  it('maps every ToolStatus to its human-readable label', () => {
    expect(toolStatusLabel('pending_approval')).toBe('Awaiting approval')
    expect(toolStatusLabel('running')).toBe('Running')
    expect(toolStatusLabel('ok')).toBe('Completed')
    expect(toolStatusLabel('error')).toBe('Failed')
    expect(toolStatusLabel('denied')).toBe('Denied')
    expect(toolStatusLabel('cancelled')).toBe('Cancelled')
  })
})
