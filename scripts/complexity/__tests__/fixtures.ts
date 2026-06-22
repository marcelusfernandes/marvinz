/** Fixtures de input válido (pré-parse) para os testes do harness. */

export function makePrediction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    issue_id: '426',
    predicted_at: '2026-05-30T12:00:00Z',
    harness_version: 'claude-opus-4-8+abc1234',
    structural: {
      downstream_fanout: { value: 3, provenance: 'measured', evidence: 'grep -rl "from .schema"' },
      upstream_fanout: { value: 5, provenance: 'measured', evidence: 'grep "^import" ledger.ts' },
      domains_touched: ['chat', 'editor'],
      touches_shared_contract: false,
      touches_nondeterministic: false,
    },
    agents: {
      risks_raised: [{ description: 'pty spawn race', severity: 'high' }],
      uncovered_angles_count: 1,
      spec_branch_count: 2,
      rounds_to_convergence: 2,
    },
    predicted_size: 'medium',
    predicted_iterations: 'low',
    predicted_decision_density: 'low',
    assigned_oversight: 'light_review',
    ...overrides,
  }
}

export function makeOutcome(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    issue_id: '426',
    completed_at: '2026-06-01T12:00:00Z',
    harness_version: 'claude-opus-4-8+abc1234',
    actual_files_touched: { value: 8, provenance: 'measured', evidence: 'git diff --name-only' },
    actual_iterations: { value: 2, provenance: 'measured', evidence: 'gh pr view --json reviews' },
    actual_downstream_fanout: { value: 4, provenance: 'measured', evidence: 'grep -rl' },
    actual_human_interventions: {
      value: 1,
      provenance: 'estimated',
      evidence: 'julgado: 1 decisão',
    },
    ...overrides,
  }
}
