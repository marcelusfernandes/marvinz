# Complexity-estimation harness

TypeScript/Zod port of `docs/specs/harness-estimative.md`. A learning loop over the
agent team: discovery emits a **PredictionVector** when an issue is born; a separate
post-merge step emits an **OutcomeRecord** read from git/gh. Paired by `issue_id`
(within one `harness_version`), the two become a labelled example, and a **TrendReport**
reads direction off the accumulated pairs.

**The bar is TREND, not mathematical precision.** This is an instrument of legibility
and accountability for routing — not a statistical model.

## Non-negotiable principles honoured here

- **Float without `provenance` is a lie** (§1.2). Every `Metric` carries `provenance`
  (`measured` | `estimated`) + `evidence` (the command run, or the basis for the guess).
- **Don't estimate what you can't measure** (§1.3). `max_node_centrality` stays `null`
  unless genuinely computed. Never estimated by an LLM.
- **Emission is append-only and non-fatal** (§1.9). The CLIs never throw; they return an
  exit code. The discovery flow tolerates `exit != 0` without aborting the mission.
- **Trends only compare within one `harness_version`** (§1.5). The version is
  `${model}+${contentHash(.claude/agents, .claude/commands)}` — content-addressed.
- **Role independence** (§1.6). Whoever predicts ≠ whoever implements ≠ whoever measures.
  Prediction is emitted at `/squad` triage; measurement is a separate post-merge step.
- **No weight-fitting on tens of examples** (§1.8). The TrendReport emits direction +
  example count + honest confidence. `score_source` stays `heuristic` on purpose.

## Files

| File                   | Role                                                                      |
| ---------------------- | ------------------------------------------------------------------------- |
| `schema.ts`            | Zod contract (`SCHEMA_VERSION = "2.0"`) + pure derived helpers            |
| `harness-version.ts`   | content hash → `${model}+${hash7}` (also a CLI)                           |
| `ledger.ts`            | JSONL append/read + `calibrationPairs()` join by `issue_id`               |
| `record-prediction.ts` | CLI: stdin JSON → validate → append prediction. Exit `0`/`1`/`2`          |
| `record-outcome.ts`    | CLI: stdin JSON → validate → append outcome. Exit `0`/`1`/`2`             |
| `trend.ts`             | pure trend computation (binary split, ordinal co-movement, routing audit) |
| `trend-report.ts`      | CLI: read ledger → emit a `TrendReport` for one `harness_version`         |

Ledger (two stores, joined by `issue_id`):

- **Predictions** → `_complexity-ledger/predictions.jsonl` on `develop`. Written on the
  feature branch and merged via the issue's PR (rides the normal PR flow).
- **Outcomes** → `_complexity-ledger/outcomes.jsonl` on the orphan `complexity-ledger`
  branch. `develop` is protected (PRs only), so the post-merge
  `harness-record-outcome` workflow appends there via the native `GITHUB_TOKEN`
  (no secret). On `develop` this file is git-ignored; materialize it before reading:

  ```bash
  git show origin/complexity-ledger:_complexity-ledger/outcomes.jsonl \
    > _complexity-ledger/outcomes.jsonl
  ```

  Each `OutcomeRecord` carries `pr_number` + `merge_sha` so a row traces back to its
  PR (and that PR's variance comment) for a deep-dive.

## Usage

```bash
# Current harness version
npm run complexity:version -- claude-opus-4-8

# Emit a prediction at issue triage (non-fatal)
echo '<PredictionVector JSON>' | npm run -s complexity:predict

# Record an outcome post-merge (separate measurement step)
echo '<OutcomeRecord JSON>' | npm run -s complexity:outcome

# Read the trend card for a harness_version (defaults to the latest prediction's)
npm run -s complexity:trend -- claude-opus-4-8+4fca3fa
```

`/squad` triage (`.claude/commands/squad.md`, Passo 1.6) wires the prediction emission in.

## Phase 2 — locked operational definitions (§1.4)

These are frozen **before** the first outcome is collected, so the label can't drift.
The measurement step is run **post-merge by whoever did not predict or implement**, and
reads the factual fields from git/gh; only the last is a judgement.

| Field                         | Provenance      | Definition (the exact thing measured)                                                                                                                                                            |
| ----------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `actual_files_touched`        | `measured`      | `git diff --name-only <base>...<merge> \| wc -l`                                                                                                                                                 |
| `actual_iterations`           | `measured`      | commit count on the PR — the operative proxy for correction rounds, as collected by the merge automation (`gh pr view --json commits`). `pr_review_cycles` tracks review submissions separately. |
| `actual_downstream_fanout`    | `measured`      | importers of the touched files, recomputed post-merge (`grep -rl`)                                                                                                                               |
| `pr_review_cycles`            | `measured`      | distinct review submissions on the PR                                                                                                                                                            |
| `time_to_merge_hours`         | `measured`      | PR `createdAt` → `mergedAt`                                                                                                                                                                      |
| `revisited`                   | `measured`      | issue reopened within `revisit_window_days` (default 30)                                                                                                                                         |
| `rework_after_merge`          | `measured`      | merged code rewritten/deleted within the window (`git log`)                                                                                                                                      |
| `escaped_to_production`       | `measured`      | a bug from this change shipped and was later fixed                                                                                                                                               |
| `nondeterministic_regression` | `measured`      | if it touched AI/prompt: prod evals degraded? else `null`                                                                                                                                        |
| `actual_human_interventions`  | **`estimated`** | times a human had to decide/correct — the only judged field, noisiest label; calibration distrusts it                                                                                            |

## Scope & honesty

The TrendReport is **directional reading to cross-check human instinct**, not a validated
estimator. With small N it stays mostly "insufficient data"; that is correct, not a bug.
`assigned_oversight` is a **treatment variable** (§1.7), not a clean label — it is decided
from the prediction and then affects the outcome, so the routing audit is text, not a verdict.
Promote `score_source` to `calibrated` only when a trend is `consistente` across more than
one `harness_version` **and** survives a validation window.
