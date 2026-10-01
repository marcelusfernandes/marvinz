# Chat UI — Terminal-Free Parity Plan

> Goal: make the native chat UI (`CHAT_UI_ENABLED`) a complete way to use Claude Code, so a
> user who is uncomfortable with the terminal can access every Claude Code feature through the
> GUI. Visual/interaction reference: the **Claude Code VS Code extension**.
>
> Assessed: 2026-07-02 · **Parity today: ~57/100**

## Thesis

The chat already has a correct conversational **spine**: token-level text/thinking streaming
(out-of-React rAF coalescer + `StreamingMarkdown`), typed tool cards (Read/Write/Edit/Bash/Agent)
with a `GenericToolCard` fallback, an inline allow/allow-always/deny approval gate wired over the
PreToolUse hook socket, a lazy CodeMirror `MergeView` diff for edits, a four-mode permission pill,
drag-drop file paths, full tab lifecycle, and pre-edit snapshots/Rewind. The protocol
(`src/shared/agent-protocol.ts`) already carries everything the reference needs — text/thinking
deltas, tool-use/result, permission-request (risk + suggestion + snapshot), turn-result
(usage + cost), error/crashed. **So most remaining work is UI/store/adapter, not protocol design.**

Parity is blocked less by rendering and more by **conversational continuity** and **input
surfaces**. The single biggest defect: the chat cannot hold a multi-turn conversation. `stdin` is
`.end()`ed after the first prompt (`electron/agent/index.ts`), the `input` request variant is
unwired in `electron/main.ts` (no-op `ok`), and `hooks.send()` always issues a fresh `type:'start'`
— which kills the prior child and never passes `resumeFromSessionId`. Every follow-up is a
context-less new session. On top of that, the three signature input affordances (@-mention picker,
slash-command menu, image paste) are inert disabled placeholders, there is zero cost/context
visibility (`costUSD` is dropped by the reducer), and `error`/`crashed` events flip `turnState` to
`'error'` with nothing rendered.

Reaching terminal-free parity means, in order: **(1)** make the conversation continuous and
recoverable, **(2)** build the input trio, **(3)** surface session management + cost/model chrome,
**(4)** fill the rich tool/plan/todo surfaces, **(5)** advanced harness features, **(6)** flip the flag.

## Gap matrix

Ranked by user impact for a non-terminal user. Status is today's state; layers are where the work lands.

| Feature                                                             | Category    | Status     | Impact      | Layers                       | Effort |
| ------------------------------------------------------------------- | ----------- | ---------- | ----------- | ---------------------------- | ------ |
| Multi-turn continuity / queued messages                             | session     | **absent** | **blocker** | adapter, store, ui           | L      |
| Error / crash recovery surface (banner, retry, re-auth)             | session     | partial    | high        | store, ui                    | M      |
| Session resume / history browsing                                   | session     | absent     | high        | adapter, store, ui           | L      |
| @-mention file/symbol picker                                        | input       | absent     | high        | store, ui                    | L      |
| Slash-command menu (`/clear`, `/compact`, `/model`, custom)         | input       | absent     | high        | adapter, ui                  | L      |
| Cost / token / context-window indicators                            | context     | absent     | high        | store, ui                    | M      |
| Model picker (Opus/Sonnet/Haiku)                                    | input       | absent     | medium      | store, ui                    | M      |
| Image / file attachment + paste (multimodal input)                  | input       | absent     | medium      | protocol, adapter, store, ui | L      |
| Persistent "always allow" + risk badge/scopes in gate               | permissions | partial    | medium      | adapter, store, ui           | M      |
| TodoWrite plan/checklist panel                                      | tools       | absent     | medium      | adapter, store, ui           | M      |
| ExitPlanMode plan review + approve handoff                          | tools       | absent     | medium      | adapter, store, ui           | M      |
| Subagent (Task) nested live streaming                               | tools       | partial    | medium      | protocol, adapter, ui        | L      |
| MCP server tools (`mcp__*`) config + rendering                      | tools       | absent     | medium      | adapter, store, ui           | L      |
| Diff accept/reject + per-hunk review; WriteCard diff                | permissions | partial    | medium      | adapter, ui                  | L      |
| Background bash (`run_in_background`, BashOutput/KillShell)         | tools       | absent     | medium      | adapter, store, ui           | L      |
| User-defined hooks surfacing (PostToolUse/Stop/…)                   | tools       | absent     | low         | adapter                      | M      |
| Thinking: markdown + collapse/expand + duration summary             | streaming   | partial    | low         | ui                           | S      |
| User message markdown + edit-and-resend                             | rendering   | partial    | low         | ui                           | S      |
| Cancel/interrupt optimistic reset + graceful interrupt              | session     | partial    | low         | store, ui                    | S      |
| Session store leak on tab close (`closeSession` never called)       | session     | partial    | low         | store, ui                    | S      |
| Typed cards for Grep/Glob/WebFetch/WebSearch/MultiEdit/NotebookEdit | tools       | partial    | low         | ui                           | S      |

**Already solid (done):** text streaming, tool-call cards for the core five, generic tool fallback,
tool approval flow, edit diff rendering, the four permission modes.

## Roadmap

### Phase 1 — Conversational continuity + recovery (the foundation)

**Goal:** a real multi-turn conversation that survives follow-ups and errors — the true blocker.
Everything else is cosmetic if the user can't ask a second question or recover from a crash.

- Keep `stdin` open after the first prompt; wire the `input` request variant end-to-end
  (`electron/agent/index.ts`, `electron/main.ts`) instead of the no-op `ok`.
- Change `hooks.send()` to issue an `input` on an existing live session instead of always
  `type:'start'` (which kills the prior child); reserve `start` for the first turn / new session
  (`src/lib/chat/hooks.ts`).
- Add a message queue in the store: allow sending while streaming, distinct Send-vs-Stop state,
  auto-send queued follow-up on turn end (`src/lib/chat/store.ts`, `Composer.tsx`).
- Surface `error`/`crashed`: read `turnState==='error'` in `ChatPanel`, render an error banner/toast
  with Retry and (for auth) a re-auth prompt; implement the promised `snapshot-warning` toast.
- Optimistic cancel reset + "Stopping…" state so a dropped `message-end` can't hang the composer.
- Fix the session leak: call `store.closeSession` on tab close in `AgentsPane`/`ChatPanel`; confirm
  before closing a mid-stream session.

### Phase 2 — Input parity: @-mentions, slash commands, images

**Goal:** the three signature Claude Code input affordances. Mostly UI/store; protocol mostly ready.

- **@-mention picker:** `@` trigger detection, fuzzy file/symbol popover (reuse the vault index),
  chip rendering, and actually populate + send `composer.mentions` (`send()` ignores `opts.mentions`
  today).
- **Slash-command menu:** `/` trigger, command registry with typeahead + descriptions, dispatch —
  route `/clear`→new session, `/compact`→compaction request, `/model`→switch, plus custom
  project/user commands. Several need dedicated request types, not just prompt text.
- **Image attach + paste:** extend `AgentRequest.prompt` from a plain string to a content-block
  array with image blocks; build `index.ts` input accordingly; add composer file/image picker +
  `onPaste` + thumbnails.
- Reuse the existing drag-drop plumbing (`formatPathsForAgent`) as the insertion substrate for chips.

### Phase 3 — Session management + ambient chrome

**Goal:** resume past conversations, pick a model, see cost/context — trust + navigation. Depends on
Phase 1's continuous session model.

- **History/resume:** wire `list-sessions`/`load-session` in `main.ts`, pass `resumeFromSessionId`
  from `hooks.send`, build a history list UI, enable the `ChatHeader` history/new-session buttons
  (currently disabled stubs).
- **Model picker** near the composer: read `session-init` model, set `req.model`, persist per session.
- **Cost/context indicators:** persist `costUSD` + `durationMs` (add `Session.cost`), render running
  cost + cumulative tokens + a context-window meter in `ChatHeader`; detect compaction.
- Persist `permissionMode` across close/reopen.

### Phase 4 — Rich tool & agentic surfaces

**Goal:** match the reference's per-tool fidelity and plan/todo workflows. Mostly UI-layer.

- **TodoWrite panel:** `TodoCard` + adapter/store merge of successive `TodoWrite` calls into one
  evolving checklist (pending/in-progress/completed).
- **ExitPlanMode** plan-approval card with an approve action that transitions out of plan mode.
- Typed cards for Grep/Glob (match/file lists), WebFetch/WebSearch (URL/query + preview), MultiEdit
  (per-hunk diff), NotebookEdit (cell diff); WriteCard diff view.
- Approval gate polish: inline risk badge + suggestion, persistent cross-session "always allow" with
  scope choices + a rule store, batch approve-all.
- Thinking collapse/markdown + duration summary; user-message markdown; assistant code-block copy +
  syntax highlighting.

### Phase 5 — Advanced harness features

**Goal:** close the remaining terminal-only capabilities. Several need protocol changes.

- **MCP:** `--mcp-config` plumbing, per-server tool grouping/icons, tune `classifyToolRisk` so
  `mcp__*` isn't blanket `'destructive'` (over-prompts today).
- **Background bash:** `run_in_background` handling, BashOutput/KillShell cards, live task
  list/polling; live foreground stdout + exit-code chip.
- **Hook events:** add adapter cases for PostToolUse/Stop/Notification/SessionStart (dropped today).
- **Subagent nested live streaming** via child-event threading in the protocol.
- **Diff accept/reject + per-hunk review** before apply.

### Phase 6 — Ship gate: flip `CHAT_UI_ENABLED`

Verify parity acceptance criteria, then enable the flag for release builds.

- E2E: multi-turn conversation, session resume, error/retry, @-mention + slash + image send,
  approval allow/deny/always, cancel, cost/context display.
- Manual QA against the VS Code extension for the top flows; a11y pass (gate keyboard control, live
  regions).
- Confirm no store leaks, no orphaned processes on close/crash; remove the dev-only flag guard.

## Ship-gate criteria

Flip `CHAT_UI_ENABLED` for release only when a terminal-averse user can complete a full workflow
with **no terminal fallback**:

1. Hold a real multi-turn conversation — follow-ups continue the same session with context.
2. Recover from any error/crashed turn via a visible banner + Retry (and re-auth on auth errors),
   with no hung composer.
3. Resume a prior conversation from a working history list.
4. Use @-mentions, slash commands, and image paste to send real requests.
5. Approve/deny tools with the risk surfaced, and have "always allow" actually persist.
6. See running cost + context-window usage so unattended spend is visible.

Plus hygiene: `closeSession` is called on tab close (no Zustand leak), cancel resets optimistically
(no stuck Stop), and E2E covers the six flows above. **TodoWrite/plan cards, MCP, background bash,
hooks, and per-hunk diff review are NOT gate blockers** — they can ship behind the flag being on and
land in later releases.

## Risks

- **Protocol churn.** Images and nested-subagent streaming require changing `AgentRequest.prompt`
  from a string to a content-block array and threading child events — touching the protocol, adapter,
  `index.ts`, and store together. Land the string→content-block migration once, behind the flag.
- **Streaming correctness.** Keeping `stdin` open, queueing input, and not killing the child risks
  races: a dropped `message-end` leaving the composer in Stop, out-of-order deltas across queued
  turns, and rAF-coalescer per-key `seq` idempotency under interleaved turns. Add optimistic resets
  and per-turn keying.
- **Approval trust.** "Always allow" silently downgrades to session scope and risk/suggestion isn't
  shown; shipping a persistent allowlist without a clear scope UI (per-command/per-path/session vs
  forever) risks over-granting. The conservative `'destructive'` default for `mcp__*` over-prompts in
  the other direction.
- **Performance.** No timeline windowing (relies on CSS `content-visibility`), lazy `MergeView`
  diffs, and always-mounted hidden tabs could degrade on long transcripts / many sessions. Fix the
  `closeSession` leak; consider true virtualization before enabling for large conversations.
- **Reference drift.** The VS Code extension evolves (per-hunk diff, queued messages, context meter);
  prioritize the conversational spine over pixel-matching chrome.
