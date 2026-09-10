# Codex project hooks

This repository keeps its Codex lifecycle hooks in `.codex/hooks.json`. Codex
loads project-local hooks only after the project layer has been trusted; inspect
and trust changed definitions with `/hooks`.

Each command resolves its script through `git rev-parse --show-toplevel`.
That keeps the configuration valid when Codex starts in a subdirectory, clone,
or Git worktree.

| Script | Event | Behavior |
| --- | --- | --- |
| `block-force-push.sh` | `PreToolUse` for Bash | Rejects force-push forms before they run. |
| `eslint-fix.sh` | `PostToolUse` for `apply_patch` | Runs `eslint --fix` on changed TypeScript files without blocking. |
| `tsc-check.sh` | `Stop` | Runs `tsc -b --noEmit`; type errors continue the turn. |

The hooks fail open when their prerequisites are unavailable. GitHub rulesets
remain the server-side protection for `main` and `develop`.
