#!/usr/bin/env node
// PreToolUse hook bridge — invoked by the claude CLI for every tool call.
// Reads tool info from stdin, connects to the per-session approval socket
// in the Electron main process, and relays the allow/deny decision back.
//
// Stdin (from claude CLI):
//   { tool_name, tool_input, session_id, cwd, permission_mode, tool_use_id, ... }
//
// Socket protocol (newline-terminated JSON):
//   → send: { toolUseId, toolName, input }
//   ← recv: { decision: "allow" | "deny", reason?: string }
//
// Exit codes (Claude CLI hook convention):
//   0 = allow  (optionally with hookSpecificOutput JSON on stdout)
//   2 = deny   (with reason on stderr)
//
// Fail-closed: any error (no socket path, connect timeout, malformed response)
// exits 2 to prevent accidental execution of unreviewed tool calls.

'use strict'

const net = require('net')

const CONNECT_TIMEOUT_MS = 10_000

const socketPath = process.env.MARVIN_APPROVAL_SOCKET

if (!socketPath) {
  process.stderr.write('marvin: MARVIN_APPROVAL_SOCKET not set — denying tool call\n')
  process.exit(2)
}

// Read all of stdin synchronously before connecting.
let rawInput = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  rawInput += chunk
})
process.stdin.on('end', () => {
  let hookInput
  try {
    hookInput = JSON.parse(rawInput)
  } catch {
    process.stderr.write('marvin: failed to parse hook stdin — denying tool call\n')
    process.exit(2)
  }

  const toolUseId = hookInput.tool_use_id ?? ''
  const toolName = hookInput.tool_name ?? ''
  const input = hookInput.tool_input ?? {}

  if (!toolUseId || !toolName) {
    process.stderr.write('marvin: missing tool_use_id or tool_name in hook stdin — denying\n')
    process.exit(2)
  }

  const msg = JSON.stringify({ toolUseId, toolName, input }) + '\n'

  let timedOut = false
  let done = false

  const connectTimer = setTimeout(() => {
    if (done) return
    timedOut = true
    socket.destroy()
    process.stderr.write(
      `marvin: connect timeout after ${CONNECT_TIMEOUT_MS}ms — denying tool call\n`
    )
    process.exit(2)
  }, CONNECT_TIMEOUT_MS)

  const socket = net.createConnection(socketPath)

  socket.once('connect', () => {
    clearTimeout(connectTimer)
    socket.write(msg)
  })

  let response = ''
  socket.setEncoding('utf8')
  socket.on('data', (chunk) => {
    response += chunk
  })

  socket.on('end', () => {
    if (timedOut || done) return
    done = true

    let parsed
    try {
      parsed = JSON.parse(response.trim())
    } catch {
      process.stderr.write('marvin: malformed response from approval socket — denying tool call\n')
      process.exit(2)
    }

    if (parsed.decision === 'allow') {
      const reason = typeof parsed.reason === 'string' ? parsed.reason : 'approved by marvin'
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            permissionDecisionReason: reason,
          },
        }) + '\n'
      )
      process.exit(0)
    } else {
      const reason = typeof parsed.reason === 'string' ? parsed.reason : 'denied by marvin'
      process.stderr.write(`marvin: tool call denied — ${reason}\n`)
      process.exit(2)
    }
  })

  socket.on('error', (err) => {
    if (timedOut || done) return
    done = true
    clearTimeout(connectTimer)
    process.stderr.write(`marvin: socket error — ${err.message} — denying tool call\n`)
    process.exit(2)
  })
})
