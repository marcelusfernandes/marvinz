<!--
Write everything in English (see .claude/rules/git-workflow.md).
PRs target `develop`, never `main`. Do not merge your own PR — the maintainer reviews.
-->

## Summary

<!-- What does this PR do and why? 1-3 sentences focused on the "why". -->

Closes #<!-- issue number, PLAIN TEXT only — no bold/italic, e.g. "Closes #123". GitHub's auto-close parser misses `Closes **#123**`. -->

## Changes

<!-- Bullet the notable changes. Reference files/modules where useful. -->

-

## Testing done

<!-- Commands run and their result. Add screenshots / recordings for UI changes. -->

- [ ] `npm run lint`
- [ ] `npm run build` (typecheck via `tsc -b`)
- [ ] `npm test`
- [ ] `npm run test:e2e` (if behavior is covered by Playwright)

## Screenshots / recordings

<!-- For any user-facing change. Delete if not applicable. -->

## Checklist

- [ ] Targets `develop` (not `main`)
- [ ] Tests added/updated for the change (unit / integration / e2e as applicable)
- [ ] Documentation updated (README of the touched area, `AGENTS.md`, or project rules if needed)
- [ ] No secrets or `.env` files committed
- [ ] Commit messages follow `<type>: <short imperative description>`
