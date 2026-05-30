# Complexity-estimation harness — Phase 1 (emission + ledger)

TypeScript/Zod port of `docs/specs/harness-estimative.md`. A learning loop over the
agent team: discovery emits a **PredictionVector** when an issue is born; a separate
post-merge team will emit an **OutcomeRecord** (Phase 2). Paired by `issue_id`, the
two become a labelled example for a trend card.

**The bar is TREND, not mathematical precision.** This is an instrument of legibility
and accountability for routing — not a statistical model.

## Non-negotiable principles honoured here

- **Float without `provenance` is a lie** (§1.2). Every `Metric` carries `provenance`
  (`measured` | `estimated`) + `evidence` (the command run, or the basis for the guess).
- **Don't estimate what you can't measure** (§1.3). `max_node_centrality` stays `null`
  unless genuinely computed. Never estimated by an LLM.
- **Emission is append-only and non-fatal** (§1.9). The CLI never throws; it returns an
  exit code. The discovery flow tolerates `exit != 0` without aborting the mission.
- **Trends only compare within one `harness_version`** (§1.5). The version is
  `${model}+${contentHash(.claude/agents, .claude/commands)}` — content-addressed, so
  uncommitted local prompt edits already change it.
- **Role independence** (§1.6). Whoever predicts ≠ whoever implements ≠ whoever measures.
  Prediction is emitted at `/squad` triage (before teammates spawn); measurement (Phase 2)
  is a separate post-merge command.

## Files

| File | Role |
|---|---|
| `schema.ts` | Zod contract (`SCHEMA_VERSION = "2.0"`) + pure derived helpers |
| `harness-version.ts` | content hash → `${model}+${hash7}` (also a CLI) |
| `ledger.ts` | JSONL append/read + `calibrationPairs()` join by `issue_id` |
| `record-prediction.ts` | CLI: stdin JSON → validate → append. Exit `0`/`1`/`2`, never throws |

Ledger lives at `_complexity-ledger/predictions.jsonl` (repo root, versioned in git).

## Usage

```bash
# Compute the current harness version
npm run complexity:version -- claude-opus-4-8
# → claude-opus-4-8+9bff90d

# Emit a prediction (validated, appended; non-fatal)
echo '<PredictionVector JSON>' | npm run -s complexity:predict
# exit 0 = recorded · 1 = invalid JSON / schema · 2 = empty / usage
```

The `/squad` triage step (`.claude/commands/squad.md`, Passo 1.6) wires this in as a
non-fatal step before spawning teammates.

## Scope

Phase 1 is emission + ledger only. `record-outcome` and the `TrendReport` (Phase 2,
issue #427) come **after** Phase 1 has accumulated real pairs — per the spec, outcome
fields must have their operational definitions locked before the first record is collected.
