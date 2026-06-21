/**
 * Smoke test for chat foundation IPC (Sprint 1 of Chat v1).
 *
 * Run this from the DevTools console while `pnpm dev` is running.
 * The app must be open with an active vault selected.
 *
 * Usage:
 *   1. Copy this entire file into the DevTools console
 *   2. Call: await smokeSimpleText()
 *   3. Call: await smokeToolUse()
 *   4. Call: await smokeCancel()
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function subscribe(sessionId) {
  const events = []
  const unsub = window.marvin.agent.onEvent(sessionId, (ev) => {
    events.push(ev)
    console.log('[EVENT]', ev.type, JSON.stringify(ev).slice(0, 200))
  })
  return { events, unsub }
}

function waitForEvent(events, predicate, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const check = () => {
      const found = events.find(predicate)
      if (found) return resolve(found)
      if (Date.now() > deadline) return reject(new Error('Timeout waiting for event'))
      setTimeout(check, 100)
    }
    check()
  })
}

function assert(condition, msg) {
  if (!condition) throw new Error(`FAIL: ${msg}`)
  console.log(`  PASS: ${msg}`)
}

// ---------------------------------------------------------------------------
// Test 1: Simple text response
// ---------------------------------------------------------------------------

async function smokeSimpleText() {
  console.group('=== SMOKE: simple text response ===')
  const sessionId = `smoke-text-${Date.now()}`
  const { events, unsub } = subscribe(sessionId)

  const res = await window.marvin.agent.request({
    type: 'start',
    sessionId,
    provider: 'claude',
    prompt: 'Reply with exactly the word: PONG',
    vaultRoot: '/tmp',
    permissionMode: 'default',
  })

  assert(res.ok === true, `agent:request returned ok=true (got: ${JSON.stringify(res)})`)

  const init = await waitForEvent(events, (e) => e.type === 'session-init').catch(() => null)
  assert(init !== null, 'session-init event received')
  if (init) {
    assert(init.sessionId === sessionId, `session-init.sessionId matches (${init.sessionId})`)
    assert(
      typeof init.cliSessionId === 'string' && init.cliSessionId.length > 0,
      'session-init.cliSessionId non-empty'
    )
    assert(
      typeof init.model === 'string' && init.model.length > 0,
      `session-init.model present (${init.model})`
    )
  }

  const msgStart = await waitForEvent(events, (e) => e.type === 'message-start').catch(() => null)
  assert(msgStart !== null, 'message-start event received')

  const turnResult = await waitForEvent(events, (e) => e.type === 'turn-result', 45_000).catch(
    () => null
  )
  assert(turnResult !== null, 'turn-result event received')
  if (turnResult) {
    assert(
      typeof turnResult.costUSD === 'number',
      `turn-result.costUSD is a number (${turnResult.costUSD})`
    )
    assert(
      typeof turnResult.usage?.inputTokens === 'number',
      'turn-result.usage.inputTokens present'
    )
  }

  const deltas = events.filter((e) => e.type === 'text-delta')
  assert(deltas.length > 0, `text-delta events received (${deltas.length} total)`)

  const seqs = deltas.map((d) => d.seq)
  const isMonotonic = seqs.every((s, i) => i === 0 || s > seqs[i - 1])
  assert(isMonotonic, `text-delta seq values are monotonically increasing: [${seqs.join(', ')}]`)

  const fullText = deltas.map((d) => d.delta).join('')
  console.log(`  Full text response: "${fullText}"`)
  assert(typeof fullText === 'string' && fullText.length > 0, 'non-empty text response received')

  const msgEnd = events.find((e) => e.type === 'message-end')
  assert(msgEnd !== undefined, 'message-end event received')
  if (msgEnd) {
    assert(
      ['end_turn', 'tool_use', 'max_tokens', 'cancelled'].includes(msgEnd.stopReason),
      `message-end.stopReason valid (${msgEnd.stopReason})`
    )
  }

  unsub()
  console.log('\nSummary:', events.map((e) => e.type).join(' → '))
  console.groupEnd()
  return { ok: true, events }
}

// ---------------------------------------------------------------------------
// Test 2: Tool use (Read tool)
// ---------------------------------------------------------------------------

async function smokeToolUse() {
  console.group('=== SMOKE: tool use (Read) ===')
  const sessionId = `smoke-tool-${Date.now()}`
  const { events, unsub } = subscribe(sessionId)

  const res = await window.marvin.agent.request({
    type: 'start',
    sessionId,
    provider: 'claude',
    prompt: 'Use the Read tool to read /etc/hostname and tell me the hostname.',
    vaultRoot: '/tmp',
    permissionMode: 'auto',
  })

  assert(res.ok === true, `agent:request returned ok=true`)

  const init = await waitForEvent(events, (e) => e.type === 'session-init', 15_000).catch(
    () => null
  )
  assert(init !== null, 'session-init event received')

  const turnResult = await waitForEvent(events, (e) => e.type === 'turn-result', 60_000).catch(
    () => null
  )
  assert(turnResult !== null, 'turn-result event received (tool use completes)')

  const toolUseEvents = events.filter((e) => e.type === 'tool-use')
  console.log(`  tool-use events: ${toolUseEvents.length}`)
  if (toolUseEvents.length > 0) {
    const tu = toolUseEvents[0]
    assert(
      typeof tu.toolUseId === 'string' && tu.toolUseId.length > 0,
      `tool-use.toolUseId present (${tu.toolUseId})`
    )
    assert(typeof tu.name === 'string', `tool-use.name present (${tu.name})`)
    console.log(`  tool-use: name=${tu.name} input=${JSON.stringify(tu.input)}`)
  }

  const toolResultEvents = events.filter((e) => e.type === 'tool-result')
  if (toolUseEvents.length > 0 && toolResultEvents.length > 0) {
    assert(
      toolResultEvents.some((r) => r.toolUseId === toolUseEvents[0].toolUseId),
      'tool-result.toolUseId matches tool-use.toolUseId'
    )
  }

  unsub()
  console.log('\nSummary:', events.map((e) => e.type).join(' → '))
  console.groupEnd()
  return { ok: true, events }
}

// ---------------------------------------------------------------------------
// Test 3: Cancel mid-stream
// ---------------------------------------------------------------------------

async function smokeCancel() {
  console.group('=== SMOKE: cancel mid-stream ===')
  const sessionId = `smoke-cancel-${Date.now()}`
  const { events, unsub } = subscribe(sessionId)

  const res = await window.marvin.agent.request({
    type: 'start',
    sessionId,
    provider: 'claude',
    prompt: 'Count from 1 to 1000, one number per line, with a brief pause described between each.',
    vaultRoot: '/tmp',
    permissionMode: 'default',
  })

  assert(res.ok === true, 'start request returned ok=true')

  // Wait for at least one text-delta before cancelling
  await waitForEvent(events, (e) => e.type === 'text-delta', 20_000).catch(() => {
    console.warn('  No text-delta before cancel — cancelling anyway')
  })

  const deltasBefore = events.filter((e) => e.type === 'text-delta').length
  console.log(`  Deltas received before cancel: ${deltasBefore}`)

  const cancelRes = await window.marvin.agent.request({ type: 'cancel', sessionId })
  assert(cancelRes.ok === true, `cancel returned ok=true (got: ${JSON.stringify(cancelRes)})`)

  // After cancel, the stream should eventually stop (no new events after a grace period)
  await new Promise((r) => setTimeout(r, 2000))
  const deltasAfter = events.filter((e) => e.type === 'text-delta').length
  console.log(`  Deltas after cancel: ${deltasAfter}`)
  console.log(`  All event types: ${events.map((e) => e.type).join(' → ')}`)

  // The session should not have an active child anymore — a second cancel should be a no-op
  const cancelAgain = await window.marvin.agent.request({ type: 'cancel', sessionId })
  assert(cancelAgain.ok === true, 'second cancel (no-op) returns ok=true')

  unsub()
  console.groupEnd()
  return { ok: true, deltasBeforeCancel: deltasBefore, deltasAfterCancel: deltasAfter }
}

// ---------------------------------------------------------------------------
// Run all tests sequentially
// ---------------------------------------------------------------------------

async function runAll() {
  console.log('Running smoke tests for chat-foundation IPC...\n')
  try {
    await smokeSimpleText()
    await smokeToolUse()
    await smokeCancel()
    console.log('\n=== ALL SMOKE TESTS PASSED ===')
  } catch (err) {
    console.error('\n=== SMOKE TEST FAILED ===', err.message)
    throw err
  }
}

console.log('Smoke test functions loaded. Run:')
console.log('  await smokeSimpleText()  — text-only response')
console.log('  await smokeToolUse()     — tool use with Read')
console.log('  await smokeCancel()      — cancel mid-stream')
console.log('  await runAll()           — run all three in sequence')
