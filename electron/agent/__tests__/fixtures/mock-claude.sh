#!/usr/bin/env bash
# Mock claude CLI for E2E tests. Streams MOCK_FIXTURE jsonl to stdout.
# Reads (and discards) one line of stdin before emitting — simulates
# claude's stream-json input handshake so spawnAgent's stdin.write + end()
# doesn't block. Handles SIGINT cleanly (exit 130).

set -euo pipefail

trap 'exit 130' INT

FIXTURE="${MOCK_FIXTURE:-}"
DELAY_MS="${MOCK_DELAY_MS:-0}"

if [[ -z "$FIXTURE" || ! -f "$FIXTURE" ]]; then
  echo '{"type":"error","error":{"type":"internal","message":"MOCK_FIXTURE not set or not found"}}' >&2
  exit 1
fi

# Consume one line from stdin (the initial prompt event from spawnAgent).
read -r _prompt_line || true

while IFS= read -r line || [[ -n "$line" ]]; do
  echo "$line"
  if [[ "$DELAY_MS" -gt 0 ]]; then
    sleep "$(echo "scale=3; $DELAY_MS / 1000" | bc)"
  fi
done < "$FIXTURE"
