# Smoke Test: Chat Foundation IPC (Sprint 1)

Manual verification of `electron/agent/` IPC infrastructure without UI.
Run before merging `feat/chat-foundation` into `develop`.

## CLI output format (updated after Sprint 1 investigation)

`claude --output-format stream-json --verbose --include-partial-messages` emits a mix of:

- `stream_event` — wraps raw Anthropic streaming events (`message_start`, `content_block_delta`, etc.) for incremental delivery. The adapter unwraps these and processes the inner event.
- `assistant` — complete message snapshot after each turn. Skips re-emitting content for messages already streamed via `stream_event` (tracked by `streamedMessageIds`); always emits `message-end`.
- `user` — tool results returned to the model.
- `result` — final cost/usage summary → `turn-result`.
- `rate_limit_event`, `system/status` — informational, produce no `AgentEvent`.

The adapter handles both paths without double-emitting events.

## Prerequisites

- `claude` binary available in PATH (`which claude` should succeed)
- A vault directory you can use (the tests use `/tmp` which is always available)
- App built and running: `pnpm dev`

## Steps

### 1. Launch the app

```bash
pnpm dev
```

Wait for the Electron window to open fully (file tree visible).

### 2. Open DevTools

**Mac:** `Cmd+Option+I`  
**Windows/Linux:** `Ctrl+Shift+I`

Switch to the **Console** tab.

### 3. Load the smoke script

Paste the entire contents of `scripts/smoke-chat-foundation.js` into the console and press Enter.

You should see:
```
Smoke test functions loaded. Run:
  await smokeSimpleText()  — text-only response
  await smokeToolUse()     — tool use with Read
  await smokeCancel()      — cancel mid-stream
  await runAll()           — run all three in sequence
```

### 4. Run: text-only response

```javascript
await smokeSimpleText()
```

**Expected output:**
```
=== SMOKE: simple text response ===
[EVENT] session-init {"type":"session-init","sessionId":"smoke-text-...","cliSessionId":"<uuid>","model":"claude-opus-4-7[1m]","cwd":"/tmp",...}
[EVENT] message-start {"type":"message-start","messageId":"msg_<id>","role":"assistant",...}
[EVENT] text-delta {"type":"text-delta","delta":"PONG","seq":0,...}
[EVENT] message-end {"type":"message-end","stopReason":"end_turn",...}
[EVENT] turn-result {"type":"turn-result","costUSD":0.155...,"durationMs":2300,"usage":{"inputTokens":6,"outputTokens":4},...}
  PASS: agent:request returned ok=true
  PASS: session-init event received
  PASS: session-init.sessionId matches (smoke-text-...)
  PASS: session-init.cliSessionId non-empty
  PASS: session-init.model present (claude-opus-4-7[1m])
  PASS: message-start event received
  PASS: turn-result event received
  PASS: turn-result.costUSD is a number (0.155...)
  PASS: turn-result.usage.inputTokens present
  PASS: text-delta events received (1 total)
  PASS: text-delta seq values are monotonically increasing: [0]
  Full text response: "PONG"
  PASS: non-empty text response received
  PASS: message-end event received
  PASS: message-end.stopReason valid (end_turn)

Summary: session-init → message-start → text-delta → message-end → turn-result
```

**Acceptance criteria:**
- `session-init` fires first with a non-empty `cliSessionId` and `model`
- One or more `text-delta` events with strictly increasing `seq` values
- `message-end` with `stopReason: "end_turn"`
- `turn-result` with numeric `costUSD > 0` and `usage.inputTokens > 0`

### 5. Run: tool use

```javascript
await smokeToolUse()
```

**Expected output:**
```
=== SMOKE: tool use (Read) ===
[EVENT] session-init {...}
[EVENT] message-start {"messageId":"msg_<id1>",...}
[EVENT] message-end {"stopReason":"end_turn",...}   ← thinking block (empty), no text-delta
[EVENT] message-start {"messageId":"msg_<id1>",...}  ← same message, tool_use block
[EVENT] tool-use {"name":"Read","toolUseId":"toolu_<id>","input":{"file_path":"/etc/hostname"},...}
[EVENT] message-end {...}
[EVENT] tool-result {"toolUseId":"toolu_<id>","isError":true,...}   ← /etc/hostname not on macOS
[EVENT] message-start {"messageId":"msg_<id2>",...}
[EVENT] text-delta {"delta":"`/etc/hostname` doesn't exist...","seq":0,...}
[EVENT] message-end {...}
[EVENT] turn-result {"costUSD":0.18...}
  PASS: agent:request returned ok=true
  PASS: session-init event received
  PASS: turn-result event received (tool use completes)
  tool-use events: 1
  PASS: tool-use.toolUseId present (toolu_...)
  PASS: tool-use.name present (Read)
  PASS: tool-result.toolUseId matches tool-use.toolUseId
```

**Acceptance criteria:**
- `tool-use` event has non-empty `toolUseId` and `name`
- `tool-result` event has matching `toolUseId`
- Full turn completes with `turn-result`

### 6. Run: cancel mid-stream

```javascript
await smokeCancel()
```

**Expected output:**
```
=== SMOKE: cancel mid-stream ===
[EVENT] session-init {...}
[EVENT] message-start {...}
[EVENT] text-delta {...}
  PASS: start request returned ok=true
  Deltas received before cancel: N
  PASS: cancel returned ok=true
  Deltas after cancel: M  (M may be slightly > N due to in-flight buffering)
  PASS: second cancel (no-op) returns ok=true
```

**Acceptance criteria:**
- `cancel` request returns `{ok: true}`
- Streaming stops within ~2 seconds of cancel (SIGINT sent to child)
- A second cancel on the same (already stopped) sessionId returns `{ok: true}` without error

### 7. Run all in sequence

```javascript
await runAll()
```

Should print `=== ALL SMOKE TESTS PASSED ===` at the end.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `AGENT_NOT_FOUND` error event | `claude` binary not in PATH | Run `which claude` in terminal; ensure `~/.local/bin` is in PATH |
| No `session-init` after 15s | Spawn failed silently | Check `~/.marvin/logs/agent-<sessionId>.log` for stderr |
| No `text-delta` events | `--include-partial-messages` flag missing | Verify `index.ts` passes the flag to `buildClaudeArgs` |
| `AGENT_INVALID_STREAM` error | Malformed NDJSON line | Check log file; 3 consecutive malformed lines → `onFatal` → `crashed` event |
| text-delta count doubles | Double-emission bug | Verify `streamedMessageIds` is used in adapter; `stream_event` and `assistant` should not both emit content |

## Actual event sequence (captured from real CLI run)

With `claude --output-format stream-json --verbose --include-partial-messages`:

```
# Simple text response
system/init           → session-init
stream_event/message_start → (message marked as streamed)
stream_event/content_block_start → []
stream_event/content_block_delta × N → text-delta × N
stream_event/content_block_stop → []
stream_event/message_delta → message-end
stream_event/message_stop  → []
assistant             → message-end only (content skipped, already streamed)
rate_limit_event      → []
result/success        → turn-result

# Tool use response (two turns)
system/init           → session-init
stream_event/message_start → (turn 1 marked as streamed)
stream_event/content_block_start (thinking) → []
stream_event/content_block_delta (signature_delta) → []
assistant (thinking, empty) → message-end only
stream_event/content_block_stop → []
stream_event/content_block_start (tool_use) → []
stream_event/content_block_delta × N (input_json_delta) → []
assistant (tool_use) → tool-use + message-end (content not yet marked streamed for this block)
stream_event/content_block_stop → tool-use (from content_block_stop handler)
user (tool_result)    → tool-result
stream_event/message_stop → []
stream_event/message_start → (turn 2 marked as streamed)
stream_event/content_block_start (text) → []
stream_event/content_block_delta × N → text-delta × N
stream_event/content_block_stop → []
stream_event/message_delta → message-end
stream_event/message_stop  → []
assistant (text)      → message-end only (content skipped)
result/success        → turn-result
```
