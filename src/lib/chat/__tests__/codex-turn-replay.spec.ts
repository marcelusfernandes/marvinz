/**
 * Replays real codex-cli output through the Codex adapter AND the renderer
 * store, the way the app wires them (#652). The adapter spec pins the event
 * sequence; this pins what the user sees: the turn stays in flight until
 * Codex is actually done, so the composer treats that window as busy (Stop,
 * or the send queue once #650 lands) instead of spawning a new child over the
 * live one.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useChatStore, flushPendingDeltas, resetStreamingBuffers } from '../store'
import { adaptCodexObj, makeCodexAdapterState } from '../../../../electron/agent/adapter-codex'
import type { ChatStreamEvent } from '../types'

const FIXTURE = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'electron',
  'agent',
  '__tests__',
  'fixtures',
  'codex',
  'tool-multi-message.jsonl'
)

const SID = 'codex-1'

function replay(): string[] {
  const state = makeCodexAdapterState(SID)
  const seen: string[] = []
  for (const line of readFileSync(FIXTURE, 'utf8').split('\n')) {
    if (!line.trim()) continue
    for (const ev of adaptCodexObj(JSON.parse(line), state)) {
      useChatStore.getState().applyStreamEvent(SID, ev as ChatStreamEvent)
      flushPendingDeltas()
      seen.push(`${ev.type}:${useChatStore.getState().sessions[SID].turnState}`)
    }
  }
  return seen
}

describe('codex multi-step turn through adapter + store (#652)', () => {
  beforeEach(() => {
    resetStreamingBuffers()
    useChatStore.setState({ sessions: {}, activeSessionId: null })
    useChatStore.getState().startSession(SID, 'codex', '/vault')
    useChatStore.getState().appendUserMessage(SID, 'o que é o arquivo teste.md?')
  })

  it('keeps the turn streaming through the tool call until turn.completed', () => {
    const seen = replay()
    // Everything up to the single message-end is still in flight — including
    // the tool-use/tool-result that follow the intermediate sentence.
    expect(seen).toContain('tool-use:streaming')
    expect(seen).toContain('tool-result:streaming')
    expect(seen.filter((s) => s.startsWith('message-end'))).toEqual(['message-end:idle'])
    expect(seen.slice(-2)).toEqual(['message-end:idle', 'turn-result:idle'])
  })

  it('renders the intermediate sentence, the tool call and the final answer in one message, in order', () => {
    replay()
    const s = useChatStore.getState().sessions[SID]
    const assistant = s.messages[s.ordering[s.ordering.length - 1]]
    if (assistant.role !== 'assistant') throw new Error('expected an assistant message')
    expect(assistant.done).toBe(true)
    // Chronological: intermediate sentence, then the command, then the answer.
    expect(assistant.blocks.map((b) => b.kind)).toEqual(['text', 'tool_use', 'text'])
    const [first, , last] = assistant.blocks
    expect(first.kind === 'text' && first.text).toBe('Vou ler o arquivo.')
    expect(last.kind === 'text' && last.text).toContain('/tmp/teste.md')
  })
})
