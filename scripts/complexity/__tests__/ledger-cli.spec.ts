import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runLedgerCli } from '../ledger-cli.ts'

type Rec = { issue_id: string }

const okSchema = (data: Rec) => ({ safeParse: () => ({ success: true as const, data }) })
const errSchema = () => ({
  safeParse: () => ({ success: false as const, error: { message: 'schema mismatch' } }),
})

describe('runLedgerCli (#594)', () => {
  let stderr: ReturnType<typeof vi.spyOn>
  let stdout: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  })
  afterEach(() => vi.restoreAllMocks())

  it('valid record: appends and returns 0 with the success line', async () => {
    const append = vi.fn(() => '/ledger/thing.jsonl')
    const code = await runLedgerCli<Rec>({
      schema: okSchema({ issue_id: '7' }),
      append,
      schemaLabel: 'ThingRecord',
      recordLabel: 'thing',
      stdinText: '{"issue_id":"7"}',
    })
    expect(code).toBe(0)
    expect(append).toHaveBeenCalledWith({ issue_id: '7' }, undefined)
    expect(stdout).toHaveBeenCalledWith('recorded thing for issue 7 -> /ledger/thing.jsonl\n')
  })

  it('schema validation failure: returns 1 and does not append', async () => {
    const append = vi.fn()
    const code = await runLedgerCli<Rec>({
      schema: errSchema(),
      append,
      schemaLabel: 'ThingRecord',
      recordLabel: 'thing',
      stdinText: '{"bad":true}',
    })
    expect(code).toBe(1)
    expect(append).not.toHaveBeenCalled()
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('ThingRecord inválido'))
  })

  it('empty stdin: returns 2 (usage)', async () => {
    const code = await runLedgerCli<Rec>({
      schema: okSchema({ issue_id: '1' }),
      append: vi.fn(),
      schemaLabel: 'ThingRecord',
      recordLabel: 'thing',
      stdinText: '   ',
    })
    expect(code).toBe(2)
  })

  it('invalid JSON: returns 1', async () => {
    const code = await runLedgerCli<Rec>({
      schema: okSchema({ issue_id: '1' }),
      append: vi.fn(),
      schemaLabel: 'ThingRecord',
      recordLabel: 'thing',
      stdinText: 'not json',
    })
    expect(code).toBe(1)
  })

  it('append throwing: returns 1', async () => {
    const append = vi.fn(() => {
      throw new Error('disk full')
    })
    const code = await runLedgerCli<Rec>({
      schema: okSchema({ issue_id: '9' }),
      append,
      schemaLabel: 'ThingRecord',
      recordLabel: 'thing',
      stdinText: '{"issue_id":"9"}',
    })
    expect(code).toBe(1)
  })
})
