import { describe, expect, it, vi } from 'vitest'

import { main, openIssues, renderGate, type IssueLite } from '../milestone-gate.ts'

const issues = (states: string[]): IssueLite[] =>
  states.map((state, i) => ({ number: i + 1, title: `issue ${i + 1}`, state }))

describe('openIssues', () => {
  it('filtra os não-fechados (case-insensitive)', () => {
    expect(openIssues(issues(['CLOSED', 'OPEN', 'closed'])).map((i) => i.number)).toEqual([2])
  })
})

describe('renderGate', () => {
  it('todas fechadas → complete', () => {
    const r = renderGate('M', issues(['CLOSED', 'CLOSED']))
    expect(r.complete).toBe(true)
    expect(r.message).toContain('complete')
  })

  it('alguma aberta → incomplete e lista as pendentes', () => {
    const r = renderGate('M', issues(['CLOSED', 'OPEN']))
    expect(r.complete).toBe(false)
    expect(r.message).toContain('1/2')
    expect(r.message).toContain('#2')
  })

  it('milestone sem issues → complete (nada a gatear)', () => {
    expect(renderGate('M', []).complete).toBe(true)
  })
})

describe('milestone-gate CLI', () => {
  it('sem milestone → exit 2', async () => {
    expect(await main('[]', [])).toBe(2)
  })

  it('incompleto → exit 1', async () => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    expect(await main(JSON.stringify(issues(['OPEN'])), ['M'])).toBe(1)
    vi.restoreAllMocks()
  })

  it('completo → exit 0', async () => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    expect(await main(JSON.stringify(issues(['CLOSED'])), ['M'])).toBe(0)
    vi.restoreAllMocks()
  })

  it('JSON inválido → exit 2', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await main('not json', ['M'])).toBe(2)
    vi.restoreAllMocks()
  })
})
