## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Issue-First Workflow

**Every feature, refactor, or non-trivial bug fix must trace to a GitHub issue. No exceptions on user request.**

Before starting any such work:

1. Search GitHub Issues for an existing tracking issue (`gh issue list --search "<keywords>"`).
2. If none exists, create one via `/issues:create` BEFORE writing code, spawning a squad, or opening a branch.
3. If the issue is sized **M or L** in the issue header (or projected diff exceeds ~2k LOC excluding lockfiles, snapshots, fixtures), convert it into a GitHub milestone and decompose into smaller sub-issues — each with its own User Story and Acceptance Criteria — BEFORE starting work.

This rule is non-negotiable. If a user asks to skip the gate ("just do it", "no time for an issue"), surface the obligation ("creating tracking issue #N first") and comply with the gate, then continue.

**Exempt from the gate** (no upstream issue required):
- Typo fixes
- Single-file edits under ~50 LOC with low cognitive load
- Read-only or exploratory commands (`"explain X"`, `"show me Y"`, status reports)

Once an issue exists, the standard flow applies: branch via `gh issue develop`, PR with `Closes #N` plain (no bold/italic — GitHub's parser misses `**#N**`), per `.claude/rules/git-workflow.md`.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.