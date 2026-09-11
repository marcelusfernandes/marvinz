// Hook that wires the inline ToolApprovalGate to the IPC bridge + Zustand
// store. The UI calls one of { allow, allowAlways, deny }; this hook:
//   1) optimistically updates the local store (so the dot transitions
//      amber → running / red immediately, even before main echoes back)
//   2) sends an `approval` to main via window.marvin.agent.approve()
//      (the convenience wrapper) — falls back to agent.request() if a
//      build is running against an older preload
//   3) lets the agent event stream (tool-result / error) drive the final
//      lifecycle transitions
//
// See chat-tool-approval.md §"Approval Decision Submission".

import { useCallback, useMemo } from 'react'
import { useChatStore } from './store'
import type { ApprovalDecision } from '../../shared/agent-protocol.js'
import type { SessionId, ToolCallId } from './types'

type ApprovalRemember = 'session' | 'always'

// Not migrated to lib/marvinApi.ts's facade (#597): this reads window.marvin.agent
// directly, not marvin.agent, so `if (api.approve) ... else if (api.request)` below
// can genuinely fall through when a build's preload lacks one of those methods.
// The facade's `agent` object always exposes both as functions, which would make
// that existence check vacuous and turn a missing-method case into a thrown error
// instead of the older-preload fallback.
function getAgentApi() {
  if (typeof window === 'undefined') return null
  return window.marvin?.agent ?? null
}

export type UseToolApprovalResult = {
  allow: (toolUseId: ToolCallId) => Promise<void>
  allowAlways: (toolUseId: ToolCallId) => Promise<void>
  deny: (toolUseId: ToolCallId) => Promise<void>
  decide: (toolUseId: ToolCallId, decision: ApprovalDecision) => Promise<void>
}

export function useToolApproval(sessionId: SessionId): UseToolApprovalResult {
  const approveTool = useChatStore((s) => s.approveTool)

  const decide = useCallback(
    async (toolUseId: ToolCallId, decision: ApprovalDecision) => {
      // Optimistic local transition: amber → running (allow) or amber → red
      // (deny). The reducer maps `approved: boolean` to running/denied; the
      // real `tool-result` event will refine to ok/error later.
      approveTool(sessionId, toolUseId, decision.kind === 'allow')

      const api = getAgentApi()
      if (!api) return
      try {
        if (api.approve) {
          await api.approve(sessionId, toolUseId, decision)
        } else if (api.request) {
          await api.request({
            type: 'approval',
            sessionId,
            toolUseId,
            decision,
          })
        }
      } catch {
        // IPC failures are reported to the user via the error stream the
        // main process emits; we don't need to roll back locally because
        // a subsequent tool-result/error event will reconcile state.
      }
    },
    [approveTool, sessionId]
  )

  const allow = useCallback(
    (toolUseId: ToolCallId) => decide(toolUseId, { kind: 'allow' }),
    [decide]
  )
  const allowAlways = useCallback(
    (toolUseId: ToolCallId) =>
      decide(toolUseId, { kind: 'allow', remember: 'session' satisfies ApprovalRemember }),
    [decide]
  )
  const deny = useCallback((toolUseId: ToolCallId) => decide(toolUseId, { kind: 'deny' }), [decide])

  return useMemo(() => ({ allow, allowAlways, deny, decide }), [allow, allowAlways, deny, decide])
}
