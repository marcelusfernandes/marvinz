#!/usr/bin/env bash
#
# eslint-fix.sh — Claude Code PostToolUse hook (issue #312)
#
# After Edit/Write/MultiEdit, runs `eslint --fix` on the SINGLE edited file so
# auto-fixable problems are corrected silently and the agent does not spend
# tokens re-applying them by hand.
#
# This hook is AUTO-FIX ONLY: it never blocks. It deliberately does NOT report
# residual (non-autofixable) errors back to the agent, because:
#   1. The repo's lint baseline is not clean (~80 pre-existing errors). Blocking
#      on residue would trap the agent on debt it did not create, every time it
#      touched an affected file.
#   2. Forcing the agent to fix unrelated lint errors in any file it edits
#      contradicts the Surgical Changes rule in CLAUDE.md ("don't improve
#      adjacent code"). Type-correctness is gated instead by the Stop hook
#      (tsc-check.sh); full lint stays a manual/CI concern (`npm run lint`).
#
# Contract (PostToolUse): receives the tool-call JSON on stdin; the edited path
# lives at tool_input.file_path.
#
# Parser: node — guaranteed present for anyone who can run this Electron/Vite
# project (same rationale as block-force-push.sh; NO jq dependency, so nobody
# has to install anything to inherit this hook on pull).
#
# Fail-open: if node or the local eslint binary is missing, or the path is not
# a TS/TSX file inside the project, the hook exits 0 and the edit proceeds.

payload="$(cat)"

# Fast path: payload must mention file_path to be actionable.
case "$payload" in
  *file_path*) ;;
  *) exit 0 ;;
esac

# Extract tool_input.file_path with node (mirrors block-force-push.sh).
file="$(FX_PAYLOAD="$payload" node -e '
  const raw = process.env.FX_PAYLOAD || "";
  let j;
  try { j = JSON.parse(raw); } catch (e) { process.exit(0); }
  const p = (j.tool_input && j.tool_input.file_path) || "";
  process.stdout.write(String(p));
')"

# Only TypeScript / TSX sources are linted.
case "$file" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

# File must exist on disk (e.g. an edit that was reverted/deleted).
[ -f "$file" ] || exit 0

project_dir="${CLAUDE_PROJECT_DIR:-$PWD}"

# Only lint files inside this project — eslint's flat config does not apply
# outside the project root, and we do not want to block edits elsewhere.
case "$file" in
  "$project_dir"/*) ;;
  *) exit 0 ;;
esac

eslint_bin="$project_dir/node_modules/.bin/eslint"
[ -x "$eslint_bin" ] || exit 0

# Apply auto-fixes silently. Residual (non-autofixable) errors are intentionally
# ignored here — see the header for why. Always exit 0; never block the edit.
"$eslint_bin" --fix "$file" >/dev/null 2>&1 || true

exit 0
