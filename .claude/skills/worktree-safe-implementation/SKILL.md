---
name: worktree-safe-implementation
description: |
  Problem-proof workflow for doing implementation work in an isolated git worktree — especially as a background job, or in a repo with a strict Stop-hook typecheck gate and a write-isolation guard. A clean worktree is the cure for most failure modes; this skill keeps the setup right and the tree healthy so the turbulence never starts. Prevents: write-guard surprises, destructive-git wiping uncommitted work, stale-base worktrees, partial-typecheck false greens, and TDD-red breaking the shared compile gate. Use when: starting any non-trivial implementation in a worktree, isolating a background job before editing files, or coordinating multi-agent work that writes to the repo.
user-invocable: true
---

# Worktree-Safe Implementation

A clean, correctly-based worktree is the **cure** for almost all of this turbulence — not the source of it. Most write-guard fights, lost work, and "stale" confusion come from a *shared* checkout with several writers. Isolate first; then the problems below mostly never arise. Two parts: **set the worktree up right** (A), then **keep the tree healthy while you work** (B).

---

## A. Isolate cleanly — before you write a line

**1. Branch off the right base, and prove it.**
Worktree from the *current* integration branch with its prerequisite merges already in it (e.g. `develop` after the dependency PR merged), not a stale `main`/`HEAD`. `git fetch` first. Then **prove the prerequisite is actually present** before writing anything:

```bash
grep -c "someSymbolFromThePrereq" path/to/file   # >0 = the dependency is in your base
```

This one check would have caught every "my worktree is on an old commit and can't see the other work" problem.

**2. Probe writability at step 0.**
Do one throwaway edit (or `printf > .scratch` then delete it) to confirm you can actually write where you intend. Surface any isolation/guard issue *now*, not three files into the implementation. If the write is rejected, see **Last resort** below — do not start editing and hope.

---

## B. Keep the tree healthy — in any strict-gate repo

**3. Never run destructive git on the working tree.**
`git stash`, `git reset`, `git checkout <file>`, `git clean` destroy *uncommitted* work — and in a shared checkout they destroy **everyone's**. To compare against a baseline, use read-only commands only:

```bash
git diff <ref>           # vs another ref, no mutation
git show <ref>:path      # read one file at a baseline ref
```

If work is ever lost anyway, check `git stash list` and `git reflog` first — it is usually recoverable.

**4. Commit a checkpoint at every green milestone.**
Uncommitted work is the only copy. The moment a unit lands green (a passing test, a clean typecheck), commit it. A stray command, a wipe, or a context reset then costs nothing instead of hundreds of lines. (On an unpushed feature branch you can squash the checkpoints into a clean history before opening the PR.)

**5. Verify with the *exact* gate command — partial typechecks lie.**
This repo's Stop hook (`.claude/hooks/tsc-check.sh`) runs:

```bash
npx tsc -b --noEmit
```

The root `tsconfig.json` uses project **references** (no `files`), so only `tsc -b` checks every project — including the test/spec project. A single-project check like `tsc -p tsconfig.app.json` **excludes the specs and reports a false green**. Always confirm with `tsc -b --noEmit` (and run the actual tests), not a narrower invocation.

**6. Keep the tree compilable every turn (stub-first for TDD-red).**
In TypeScript, a red test that `import`s a not-yet-existent module/symbol is a *compile error*, and the Stop-hook gate blocks the turn until it's gone. So a red test that imports the real symbol breaks the gate for the whole session. Make the red state compile and fail at runtime instead:

- Export a throwing stub first (`export function foo(){ throw new Error('not implemented') }`), then the test imports a real symbol, compiles, and fails at runtime — a true red.
- Never leave a dangling import or a half-changed signature across a turn boundary.

**7. Distrust stale gate/hook errors — re-check real state before acting.**
During active editing the tree is *transiently* broken; a Stop-hook error you receive may be from a state another writer (or your last edit) already fixed. Before reacting, re-run the truth (`npx tsc -b --noEmit`, run the test) and read the current file. Don't "fix" an error that's already gone, and don't edit a file someone else is mid-edit on.

---

## Last resort — when isolation truly isn't possible

If you genuinely cannot isolate (e.g. a multi-writer squad *must* share one checkout) and writes are blocked by the background-job write-guard, disabling it is a **safety-weakening change — get explicit user consent first.** Then, as an observed procedure (not a guaranteed mechanism):

- **Your own (parent) writes** blocked → a gitignored `.claude/settings.local.json` with `{"worktree":{"bgIsolation":"none"}}` unblocked them.
- **A teammate's** writes still blocked after the flag is set → the flag must live in the **tracked** `.claude/settings.json` (teammates read that), and a teammate spawned *before* the flag was set cached the guard at spawn → **re-spawn it**.
- **Always revert the tracked `settings.json` at teardown and keep it out of the PR.** It is operational scaffolding, never a shipped change.

See the memory `squad-bg-isolation-conflict` for the original incident.

---

## Anti-pattern — don't do this

**A multi-writer squad against one shared checkout, as a background job.** The write-guard isolates each teammate into its own (often stale) worktree; they can't see each other's uncommitted work, and a destructive-git from any one wipes the rest. Prefer instead:

- **Solo-in-worktree** — one writer, cleanly isolated (this skill).
- **Lead-as-integrator** — teammates read, draft, and review (reading is never blocked); the lead writes everything in one checkout and commits. You keep the independent-review value without the multi-writer chaos.

Related memories: `no-destructive-git-in-shared-tree`, `fetch-before-develop-baseline`, `squad-bg-isolation-conflict`.
