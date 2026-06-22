# Marvin Chat — Tool Approval Gate (C2)

> Sprint 3 of Chat v1 milestone. Implements PreToolUse approval gate for inline tool call rendering with 5-minute timeout, multi-state lifecycle, and permission mode integration.

**Status:** In implementation  
**References:** `.docs/chat-design-v1.md` §5 F4 + §6.2 "Tool variants", issue #104  
**Related specs:** `electron/agent/protocol.ts` (IPC contract), `electron/agent/permissions.ts` (evaluation hook), `src/components/chat/TimelineItem.tsx` (component base)

---

## User Story

**Jordan** (PM using Marvin in Obsidian) runs `claude code` to research a topic. When the agent proposes to edit a file, rather than seeing an intimidating xterm prompt, Jordan sees a **humanized inline approval card** directly in the chat timeline. The card shows the tool name, input summary, and two buttons: **Allow** and **Deny**.

If Jordan approves, the tool executes. If she denies, the agent gracefully continues with a denial signal. If she doesn't respond within **5 minutes**, the system times out and sends an `AGENT_PERMISSION_TIMEOUT` error, aborting the turn.

This flow replaces the previous **silent auto-execute** or **xterm-based prompt** with **explicit, trustworthy approval**. Jordan can show this workflow to her CEO without explaining black-box terminals.

---

## Acceptance Criteria

### AC1: Permission Request IPC Event

The main process emits a `permission-request` event on `agent:event:<sessionId>` with:

- `sessionId`: UUID of the session
- `toolUseId`: unique ID for this tool invocation
- `toolName`: string ("Read", "Write", "Edit", "Bash", "WebFetch", etc.)
- `input`: the full tool input object (parsed JSON)
- `risk`: semantic classification `"safe" | "destructive" | "network"` for visual hint
- `suggestion`: `"allow" | "review"` based on permission mode + tool

The renderer receives this event and **must not execute the tool** until it receives `agent:request` with `type: 'approval'` and a decision.

### AC2: Tool Approval Gate UI (Inline Timeline Item)

The renderer displays a timeline item with:

- **Dot state**: `amber` (pending) with semantic label (e.g., "Awaiting approval")
- **Tool label**: e.g., "Edit" bold + filename in monospace pill
- **Inline buttons**: `[Allow]` and `[Deny]` side-by-side, auto-focused to Allow
- **Optional diff preview**: For Edit/Write tools, diff is collapsed by default; user may expand via click on the bullet or filename to see `@codemirror/merge` view

The card renders in the message timeline, **not in a modal** (per Vision v3 principle: approval = timeline item, modals reserved for irreversible actions).

### AC3: Approval Decision Submission

When user clicks `[Allow]` or `[Deny]`:

1. Renderer sends `agent:request` with:
   ```typescript
   {
     type: 'approval',
     sessionId: string,
     toolUseId: string,
     decision: { kind: 'allow' | 'deny'; remember?: 'session' | 'always' }
   }
   ```
2. Main process receives, calls `evaluatePermission()` hook (already scaffolded in `permissions.ts`)
3. If `allow`: signal the agent subprocess to proceed; dot transitions `amber` → `running` (green pulse)
4. If `deny`: send agent a synthetic `tool-result` with error code `AGENT_PERMISSION_DENIED` + reason

### AC4: 5-Minute Approval Timeout

If no approval response is received within **300 seconds**:

1. Main process sets a `setTimeout(300000)` timer when `permission-request` is first sent
2. On timeout:
   - Clear the pending approval
   - Emit `agent:event` with `type: 'error'`, `code: 'AGENT_PERMISSION_TIMEOUT'`, `message: "Approval timed out after 5 minutes"`
   - Send SIGINT to the agent subprocess (clean unwinding)
   - Renderer shows card with error state + `[Resend]` button to restart turn
3. User can click `[Resend]` to re-send the same prompt, spawning a fresh agent run

### AC5: Mid-Stream Denial (Clean Turn Termination)

When user clicks `[Deny]`:

1. Render the denial immediately (dot transitions `amber` → `red`, buttons replaced with label "Denied")
2. Do NOT kill the subprocess immediately; instead, synthesize a `tool-result` event with:
   ```typescript
   {
     type: 'tool-result',
     toolUseId: string,
     output: { message: 'User denied execution' },
     isError: true
   }
   ```
3. This allows the agent to see the denial as a natural tool error and continue (e.g., "I see, I won't edit that file")
4. Possible outcomes:
   - Agent suggests an alternative approach
   - Agent explains why the edit was needed
   - Agent simply says "Understood, continuing without that change"

### AC6: Mode-to-CLI-Flag Mapping

The UI permission mode pill (4 modes) maps **1:1** to CLI `--permission-mode` flags:

| UI Mode            | CLI Flag                        | Approval Behavior                                                              |
| ------------------ | ------------------------------- | ------------------------------------------------------------------------------ |
| Ask before edits   | `--permission-mode default`     | Blocks on Edit/Write/Bash; auto-allows safe Read/WebFetch                      |
| Edit automatically | `--permission-mode acceptEdits` | All edits auto-allowed; non-file tools auto-allowed                            |
| Plan mode          | `--permission-mode plan`        | All file writes denied; agent generates plan without side effects              |
| Auto mode          | `--permission-mode auto`        | CLI chooses best mode per request (experimental; sync behavior with CLI v2.1+) |

When user switches modes in the UI (via mode pill → popover), the **next message sent uses the new mode**; retroactive mode changes do not re-evaluate in-flight tool calls.

### AC7: Concurrent Tool Call Handling

If the agent emits multiple tool calls in a single message (e.g., `tool_use` events in rapid succession before `message_end`), the renderer:

- Displays **multiple pending approval cards stacked** in timeline order
- Each card has its own approval state machine (pending → approved/denied)
- User may approve/deny cards in any order
- Renderer collects all decisions and sends them to main process **in sequence** (or coalesced if >1 pending at send time)
- Agent only proceeds when **all pending approvals in the message have been resolved**

### AC8: Unknown/Custom Tool Fallback

If the agent calls a tool name that the renderer has no specific card component for (e.g., a new MCP tool added to the CLI after Marvin shipped), the renderer:

- Falls back to a **GenericToolCard** that displays:
  - Tool name (bold)
  - JSON input (pretty-printed, monospace, max-height 200px with scroll)
  - Same approval buttons as other tools
- Does not crash; applies the same permission logic
- This future-proofs the UI against CLI tool additions without Marvin version bump

---

## Edge Cases

### Timeout → SIGINT Flow

**Scenario**: User ignores approval card for 5+ minutes.

**Expected behavior**:

1. Timer fires
2. Main emits `{ type: 'error', code: 'AGENT_PERMISSION_TIMEOUT', message: '...' }`
3. Main sends SIGINT to child process
4. Child unwinds cleanly, sends `message-end` (or crash if it doesn't handle SIGINT)
5. Renderer shows error banner with `[Resend]` button
6. User clicks `[Resend]` → sends original prompt again as new turn

**Why SIGINT, not SIGKILL?** Allows the agent to flush any buffered state, close files, and report a clean exit code 130 (SIGINT). More trustworthy than hard kill.

### Mode Switch Mid-Turn

**Scenario**: User is in "Ask before edits" mode. Agent proposes an Edit. While the approval card is pending, user clicks the mode pill and switches to "Edit automatically".

**Expected behavior**:

- The in-flight approval card respects the **old mode** (was "Ask before edits")
- User still sees the card and must approve/deny
- When the next turn starts, the **new mode** ("Edit automatically") applies
- No retroactive re-evaluation of pending approvals (complexity explosion)

**Why?** Simpler semantics: each turn has one mode, set at send time. Prevents race conditions in the approval state machine.

### Concurrent Denial + Timeout

**Scenario**: Two tools pending approval. User denies the first. Timer fires for the second (user ignored it).

**Expected behavior**:

1. Denial of first tool sends synthetic `tool-result` → agent continues
2. Timeout of second tool fires independently
3. Main emits `AGENT_PERMISSION_TIMEOUT` error
4. Agent sees both: one tool result (denied), one error. Decides how to handle

No special coordination needed; both events are broadcast to renderer + agent independently.

### Denied Edit → Vault Boundary Violation

**Scenario**: User clicks `[Deny]` on an Edit call that would write outside the vault anyway.

**Expected behavior**:

- Denial is processed first (user intent honored)
- Renderer shows "User denied execution"
- Vault boundary check is **downstream** in the tool execution, not at approval time (keep concerns separate)

### Session-Scoped "Allow Always" Button

**Scenario**: User approves an Edit to `src/utils.ts`. Clicks `[Allow] → Remember for this session`.

**Expected behavior**:

1. Current approval allowed
2. Main process calls `recordDecision(sessionId, 'Edit', { kind: 'allow', remember: 'session' })`
3. `evaluatePermission()` checks this cache on next Edit call in same session
4. If cached, auto-allows (skip approval card)
5. On new session (user closes + reopens chat), cache is cleared

**Persistence?** "Remember for this session" only — do not persist to disk in Sprint 3. "Remember always" deferred to future (complex RBAC). Session rules stored in `Map<sessionId, Map<string, ApprovalDecision>>` in `permissions.ts`.

---

## State Machine: Tool Lifecycle

```
PENDING (amber dot)
  ├─ User clicks [Allow] ───→ APPROVED (spinner) ───→ RUNNING (green pulse) ───→ SUCCESS (green dot) or ERROR (red dot)
  ├─ User clicks [Deny]  ───→ DENIED (red dot, locked)
  └─ 5-min timeout       ───→ TIMEOUT (red dot, locked, shows [Resend])

APPROVED (rendering spinner while tool executes)
  ├─ tool-result arrives ───→ SUCCESS (green) or ERROR (red)
  └─ subprocess crashes  ───→ CRASHED (red, bubble "Agent stopped")

RUNNING (pulse animation on green dot)
  ├─ tool-result success ───→ SUCCESS (solid green)
  ├─ tool-result error   ───→ ERROR (solid red, shows error message + [Retry])
  └─ SIGTERM from user   ───→ CANCELLED (gray, "Cancelled by user")

SUCCESS (solid green dot, card collapses to summary)
  └─ No further state transitions (terminal)

ERROR (solid red dot, shows error text)
  └─ [Retry] button allows user to resend the same tool call

DENIED (solid red dot, "User denied execution")
  └─ No further state transitions (terminal); agent continues with error signal

TIMEOUT (solid red dot, "Approval timed out after 5 minutes")
  └─ [Resend] button restarts turn from user's original prompt
```

---

## IPC Contract Expansion

### permission-request Event (Main → Renderer)

```typescript
{
  type: 'permission-request',
  sessionId: string,
  toolUseId: string,
  toolName: string,  // "Read", "Write", "Edit", "Bash", "WebFetch", "Agent", etc.
  input: unknown,    // full tool input object
  risk: 'safe' | 'destructive' | 'network',  // for visual hint
  suggestion: 'allow' | 'review'  // based on evaluatePermission() + mode
}
```

### approval Request (Renderer → Main)

```typescript
{
  type: 'approval',
  sessionId: string,
  toolUseId: string,
  decision: ApprovalDecision  // { kind: 'allow' | 'deny'; remember?: 'session' | 'always' }
}
```

### evaluatePermission() Hook Expansion

Current scaffold in `electron/agent/permissions.ts`:

```typescript
export function evaluatePermission(ctx: PermissionContext): PermissionResult {
  // Modes:
  // - 'auto' → auto-allow everything (trust mode)
  // - 'acceptEdits' → auto-allow all (edit mode)
  // - 'plan' → auto-deny all file writes (plan mode)
  // - 'default' → check session rules, fallback to 'request' (ask mode)

  if (ctx.permissionMode === 'auto' || ctx.permissionMode === 'acceptEdits') {
    return { action: 'allow' }
  }
  if (ctx.permissionMode === 'plan') {
    return { action: 'deny', reason: 'Plan mode: file writes are not permitted' }
  }
  // default: check session rules or request
  const rules = getSessionRules(ctx.sessionId)
  const remembered = rules.get(ctx.toolName)
  if (remembered?.kind === 'allow') return { action: 'allow' }
  if (remembered?.kind === 'deny')
    return { action: 'deny', reason: remembered.reason ?? 'Denied by remembered rule' }
  return { action: 'request' } // ask user
}
```

Renderer awaits a `permission-request` event → user clicks Allow/Deny → sends `approval` request back → main calls `recordDecision(sessionId, toolName, decision)` to update rules.

---

## Tool Card Visual States

### 6.2 Timeline Dot Semantic Mapping

| Dot Color                        | State                                               | Semantics              |
| -------------------------------- | --------------------------------------------------- | ---------------------- |
| **Outline** (transparent border) | Thinking, neutral text                              | Passive observation    |
| **Green** (solid)                | Tool success, agent success, auto-allowed execution | Positive outcome       |
| **Amber** (solid)                | Tool pending approval                               | Action required (user) |
| **Red** (solid)                  | Tool error, user denied, timeout                    | Negative outcome       |
| **Running** (green pulse)        | Tool executing                                      | Active work            |

**Design tokens** (from `.claude/rules/design-tokens.md`):

- Outline: `border: 1.5px var(--border-strong)`, `background: transparent`
- Green: `background: var(--text-success)` (no border)
- Amber: `background: var(--text-warning)` (no border)
- Red: `background: var(--text-error)` (no border)
- Running: `background: var(--accent)` + `animation: pulse 1.2s ease-in-out infinite`

Dot size: 8×8px, `border-radius: 50%`, `margin-top: 6px` (optical alignment).

### Tool Card Layout (Timeline Item)

```
● [AMBER] Edit src/utils.ts
   [Allow] [Deny]

   ┌─────────────────────────┐
   │ - 3 lines / + 5 lines   │ (opt-in expand)
   └─────────────────────────┘
```

When expanded, inline `@codemirror/merge` shows full diff (max-height 200px, scroll if needed).

---

## Testing Strategy

### Unit Tests (permissions.ts)

1. **evaluatePermission() correctness**:
   - Mode 'auto' → always allow
   - Mode 'acceptEdits' → always allow
   - Mode 'plan' → always deny file writes
   - Mode 'default' + no rules → return 'request'
   - Mode 'default' + remembered allow → return 'allow'
   - Mode 'default' + remembered deny → return 'deny'

2. **recordDecision() session isolation**:
   - Two sessions with same tool name have separate rules
   - Decision in session A doesn't affect session B
   - Clearing session rules works

### Integration Tests (IPC flow)

1. **Approval card rendering**:
   - `permission-request` event received → card renders with correct tool name + input summary
   - Dot is amber, buttons enabled
   - Auto-focus on Allow button

2. **Denial flow**:
   - Click Deny → sends `approval` request with `kind: 'deny'`
   - Main receives, calls `evaluatePermission()` (which returns already denied)
   - Synthesizes `tool-result` with `isError: true`
   - Renderer dot transitions to red
   - Agent continues (turn does not halt)

3. **Timeout flow**:
   - Permission request sent
   - 5-minute timer not explicitly triggered (set in main)
   - (In tests: mock `setTimeout`, advance clock 300s)
   - `AGENT_PERMISSION_TIMEOUT` error emitted
   - SIGINT sent to subprocess
   - Renderer shows error card + `[Resend]` button

4. **Concurrent approvals**:
   - Two `permission-request` events in rapid succession
   - Two cards render in timeline
   - Approve first, deny second (in any order)
   - Both decisions sent
   - Correct tool-result synthesized for each

### E2E Test (full flow with real agent)

1. Send prompt that triggers an Edit tool
2. Approval card appears in chat
3. Click `[Allow]` → agent continues → edit renders in timeline as success
4. (Variant) Click `[Deny]` → agent sees denial → continues without edit
5. (Variant, slow) Wait 5+ minutes on approval card → timeout error → `[Resend]` button appears

---

## Security Considerations

### Vault Boundary Enforcement

**Timing**: Approval gate happens **before** tool execution. However, vault boundary violation is a **secondary check** downstream in the tool adapter (post-approval).

**Why separate?** User may approve an Edit to a path they don't realize is outside the vault. The tool adapter should validate and synthesize an error, not approve it silently.

**Implementation**:

```typescript
// In evaluatePermission: check mode, check rules
// In tool executor: check vault boundary independently
// If boundary violated: synthesize tool-result { isError: true, message: 'Marvin blocked: path outside vault' }
// Renderer shows error, agent continues (can't edit outside vault)
```

### No Secrets in Tool Input Display

Tool input may contain sensitive data (API keys, auth tokens, SQL passwords). The approval card displays the **full input as JSON**. Future mitigations:

- Mask known sensitive keys (e.g., `apiKey: "••••••••"`)
- Allow user to expand masked values (opt-in reveal)
- Log unmasked input server-side only

For Sprint 3: **Display input as-is** (short-term trust model; assume local vault = trusted env). Add masking in future sprint if users request.

### No Bypass Flag in v1

CLI offers `--permission-mode bypassPermissions` for dev flows. Marvin **does not expose this in the UI** (no "YOLO mode" button). Users who need auto-execute can set "Auto mode" via the mode picker.

If a developer manually edits `Settings.json` to enable a hypothetical bypass: they own that decision. Not our responsibility to prevent self-inflicted wounds, but we don't encourage it in the UI.

---

## Dependencies & Integration Points

### electron/agent/permissions.ts (Scaffolded)

- `evaluatePermission()` already exists; expand logic per modes ✓
- `recordDecision()` already exists; no changes needed ✓
- `getSessionRules()` / `clearSessionRules()` exist for session isolation ✓

### electron/agent/protocol.ts

- Add `risk` and `suggestion` fields to `permission-request` event ✓ (already in current types)
- No breaking changes

### electron/agent/adapter-claude.ts

- On receiving agent's `tool-use` event, call `evaluatePermission()`
- If `action: 'request'` → emit `permission-request` to renderer
- If `action: 'allow'` → proceed to tool execution
- If `action: 'deny'` → synthesize `tool-result` with error

### src/components/chat/TimelineItem.tsx

- Already has `kind` prop for "thinking" | "text" | "tool"
- Extend with `dotState` prop for "outline" | "green" | "amber" | "red" | "running" ✓

### src/components/chat/ (New components)

- `ToolApprovalGate.tsx` — renders buttons, handles click events
- `ToolCard.tsx` + variants (DiffCard, BashCard, ReadCard, GenericToolCard)
- `ToolApprovalButtons.tsx` — Allow / Deny buttons with styling

### src/lib/chat/ (New hooks)

- `useToolApproval.ts` — manage tool state machine, timeout timers, button click handlers
- Integration with Zustand store for approval queue + decision history

---

## Success Criteria (Measurable)

By end of Sprint 3:

1. ✅ All permission-request events are received by renderer and rendered as approval cards
2. ✅ Approval/denial decisions are correctly sent back to main + recorded in session rules
3. ✅ 5-minute timeout emits AGENT_PERMISSION_TIMEOUT error without hang
4. ✅ Tool state machine transitions (pending → approved/denied/timeout) match spec above
5. ✅ Mode pill integration: switching modes affects next turn (not retroactively)
6. ✅ Concurrent tool calls: multiple approval cards render stacked, user can approve in any order
7. ✅ E2E test passes: full approval → tool execution flow with real Claude agent
8. ✅ Edge cases: denial, timeout, concurrent approvals all covered in test suite
9. ✅ Unknown tool fallback (GenericToolCard) renders correctly for unhandled tool names
10. ✅ Design tokens used throughout; no hardcoded colors/spacing (audit with `.claude/rules/design-tokens.md`)

---

## Appendix: Related Context

- **Vision v3**: Jordan persona (PM) needs approval gates to replace xterm.
- **Chat Design v1 §5.F4**: Tool call lifecycle (states, timing, user actions).
- **Chat Design v1 §6.2**: Visual spec for timeline bullets, tool variants, approval buttons.
- **Chat Design v1 §7.2**: IPC contract (AgentRequest, AgentEvent types).
- **Issue #104**: Feature request for PreToolUse approval in chat (C2 of roadmap).
- **Permission modes**: Inherited from Claude Code CLI (ask, edit auto, plan, auto).
- **5-minute timeout**: Standard CloudFlare / request timeout convention; user can always resend.
