#!/usr/bin/env bash
#
# eslint-fix.sh — Codex PostToolUse hook (issue #638)
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
# Contract (PostToolUse): receives the tool-call JSON on stdin. Codex exposes
# apply_patch content in tool_input.command, so paths are extracted from its
# Update/Add File headers.
#
# Parser: node — guaranteed present for anyone who can run this Electron/Vite
# project (same rationale as block-force-push.sh; no jq dependency).
#
# Fail-open: if node or the local eslint binary is missing, or the path is not
# a TS/TSX file inside the project, the hook exits 0 and the edit proceeds.

payload="$(cat)"
project_dir="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
eslint_bin="$project_dir/node_modules/.bin/eslint"
[ -x "$eslint_bin" ] || exit 0

FX_PAYLOAD="$payload" node -e '
  const raw = process.env.FX_PAYLOAD || "";
  let event;
  try { event = JSON.parse(raw); } catch { process.exit(0); }
  if (event.tool_name !== "apply_patch") process.exit(0);
  const patch = event.tool_input && event.tool_input.command;
  if (typeof patch !== "string") process.exit(0);

  const paths = new Set();
  for (const match of patch.matchAll(/^\*\*\* (?:Update|Add) File: (.+)$/gm)) {
    paths.add(match[1]);
  }
  for (const path of paths) process.stdout.write(path + "\0");
' | while IFS= read -r -d '' path; do
  case "$path" in
    *.ts|*.tsx) ;;
    *) continue ;;
  esac

  case "$path" in
    /*) file="$path" ;;
    *) file="$project_dir/$path" ;;
  esac
  [ -f "$file" ] || continue

  case "$file" in
    "$project_dir"/*) ;;
    *) continue ;;
  esac

  "$eslint_bin" --fix "$file" >/dev/null 2>&1 || true
done

exit 0

exit 0
