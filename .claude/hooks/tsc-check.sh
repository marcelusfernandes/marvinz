#!/usr/bin/env bash
#
# tsc-check.sh — Claude Code Stop hook (issue #312)
#
# Runs the TypeScript project type-checker once when the agent finishes a turn,
# instead of the agent invoking tsc ad-hoc several times per session. On type
# errors it returns the first lines to stderr and exits 2, so the agent keeps
# working until the project type-checks clean ("loop until green").
#
# Safe to gate on because the repo's tsc baseline is kept green (issue #312
# fixed the two pre-existing errors); only errors the agent itself introduces
# should block the turn.
#
# Project references: the root tsconfig.json has no `files`, only `references`,
# so build mode (`tsc -b`) is required; `--noEmit` type-checks without emitting.
#
# No stdin parsing needed (Stop carries no edited file). Fail-open if the local
# tsc binary is missing.

project_dir="${CLAUDE_PROJECT_DIR:-$PWD}"
tsc_bin="$project_dir/node_modules/.bin/tsc"
[ -x "$tsc_bin" ] || exit 0

cd "$project_dir" || exit 0

out="$("$tsc_bin" -b --noEmit 2>&1)"
code=$?

if [ "$code" -ne 0 ]; then
  printf '%s\n' "$out" | head -40 >&2
  echo "tsc reported type errors (see above). Fix them before ending the turn." >&2
  exit 2
fi

exit 0
