import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appendPrediction } from '../ledger.ts'
import {
  buildVariance,
  main,
  ratioSeverity,
  renderComment,
  renderNoPrediction,
  VARIANCE_MARKER,
} from '../pr-variance.ts'
import { PredictionVector } from '../schema.ts'
import { makePrediction } from './fixtures.ts'

function pred(overrides: Record<string, unknown> = {}) {
  return PredictionVector.parse(makePrediction(overrides))
}

describe('buildVariance', () => {
  it('flag quando o fanout real excede o previsto', () => {
    const p = pred() // downstream_fanout = 3 (fixture)
    const v = buildVariance(p, { filesTouched: 4, downstreamFanout: 5 })
    expect(v.fanout_underestimate).toBe(2)
    expect(v.flags.join(' ')).toContain('blast radius maior')
  })

  it('flag quando os arquivos excedem o orçamento da banda de size', () => {
    const p = pred({ predicted_size: 'low' }) // budget ~5
    const v = buildVariance(p, { filesTouched: 9, downstreamFanout: 3 })
    expect(v.flags.join(' ')).toContain('mais arquivos')
  })

  it('sem variância → sem flags, severity ok', () => {
    const p = pred({ predicted_size: 'medium' }) // budget ~20
    const v = buildVariance(p, { filesTouched: 4, downstreamFanout: 3 })
    expect(v.flags).toEqual([])
    expect(v.fanout_underestimate).toBe(0)
    expect(v.severity).toBe('ok')
  })

  it('severity = pior entre fanout e arquivos (§504)', () => {
    // low (budget 5): files 16 = 3.2x → over; fanout 2 vs predicted 3 = ok → worst = over
    const p = pred({ predicted_size: 'low' })
    const v = buildVariance(p, { filesTouched: 16, downstreamFanout: 2 })
    expect(v.severity).toBe('over')
  })
})

describe('ratioSeverity (§504)', () => {
  it('cortes por razão: 🟢 ≤1.2× · 🟡 1.2–2× · 🔴 >2×', () => {
    expect(ratioSeverity(6, 5)).toBe('ok') // 1.2x
    expect(ratioSeverity(7, 5)).toBe('warn') // 1.4x
    expect(ratioSeverity(11, 5)).toBe('over') // 2.2x
  })

  it('esperado 0 → valor absoluto: 🟡 ≥2 · 🔴 ≥4', () => {
    expect(ratioSeverity(1, 0)).toBe('ok')
    expect(ratioSeverity(2, 0)).toBe('warn')
    expect(ratioSeverity(4, 0)).toBe('over')
  })
})

describe('renderComment', () => {
  it('inclui o marker e o rodapé advisory', () => {
    const p = pred()
    const out = renderComment(buildVariance(p, { filesTouched: 4, downstreamFanout: 5 }))
    expect(out).toContain(VARIANCE_MARKER)
    expect(out).toContain('Advisory')
    expect(out).toContain('⚠️')
  })

  it('mostra o badge de severidade no título (§504)', () => {
    const p = pred({ predicted_size: 'low' }) // budget 5
    const over = renderComment(buildVariance(p, { filesTouched: 16, downstreamFanout: 2 }))
    expect(over).toContain('🔴')
    const ok = renderComment(
      buildVariance(pred({ predicted_size: 'medium' }), {
        filesTouched: 4,
        downstreamFanout: 3,
      })
    )
    expect(ok).toContain('🟢')
  })
})

describe('renderNoPrediction', () => {
  it('emite advisory de cobertura com o marker e o comando de remediação (§503)', () => {
    const out = renderNoPrediction('432')
    expect(out).toContain(VARIANCE_MARKER)
    expect(out).toContain('/harness:predict 432')
    expect(out).toContain('Advisory')
  })
})

describe('pr-variance CLI', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cx-variance-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('sem issue id → exit 2', () => {
    expect(main([], { HARNESS_FILES: '1', HARNESS_FANOUT: '1' }, root)).toBe(2)
  })

  it('env numérico inválido → exit 2', () => {
    expect(main(['429'], { HARNESS_FILES: 'x', HARNESS_FANOUT: '1' }, root)).toBe(2)
  })

  it('sem predição p/ a issue → exit 0 e imprime advisory de cobertura (§503)', () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    expect(main(['999'], { HARNESS_FILES: '3', HARNESS_FANOUT: '3' }, root)).toBe(0)
    expect(write).toHaveBeenCalledOnce()
    expect(write.mock.calls[0][0] as string).toContain('/harness:predict 999')
  })

  it('com predição → exit 0 e imprime o comentário', () => {
    appendPrediction(pred({ issue_id: '429' }), root)
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    expect(main(['429'], { HARNESS_FILES: '4', HARNESS_FANOUT: '5' }, root)).toBe(0)
    expect(write).toHaveBeenCalledOnce()
  })
})
