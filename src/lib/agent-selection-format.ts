// Format a selected text snippet for the selection-to-agent chip
// (issue #376, milestone #19). Both Codex and Claude Code receive the
// same wrapping — backtick code fences only matter for multi-line; the
// agent prefix convention from agent-drop-format only applies to paths.
//
// - Trailing whitespace is stripped (a trailing newline from the
//   selection shouldn't bleed into the fence).
// - Leading whitespace is preserved (indentation is signal, not noise).
// - Empty / whitespace-only → '' so the call site can suppress the chip
//   without a separate guard.
// - Single-line → text as-is, no fence.
// - Multi-line → wrap in a triple-backtick fence. If the text itself
//   contains triple (or longer) backtick runs, escalate the fence to
//   one tick longer than the longest run.
//
// AgentKind is imported from the drop-format helper so the union stays
// a single source.

import type { AgentKind } from './agent-drop-format'

function longestBacktickRun(text: string): number {
  let max = 0
  let current = 0
  for (const ch of text) {
    if (ch === '`') {
      current++
      if (current > max) max = current
    } else {
      current = 0
    }
  }
  return max
}

export function formatSelectionForAgent(text: string, _agent: AgentKind): string {
  const trimmed = text.replace(/\s+$/u, '')
  if (trimmed === '') return ''
  if (!trimmed.includes('\n')) return trimmed
  const fenceLen = Math.max(3, longestBacktickRun(trimmed) + 1)
  const fence = '`'.repeat(fenceLen)
  return `${fence}\n${trimmed}\n${fence}`
}
