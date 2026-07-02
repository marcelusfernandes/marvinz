# Chat UI — Terminal-Free Parity Backlog

> Companion to [`chat-ui-parity.md`](./chat-ui-parity.md). This is the executable backlog: every item
> has an **Objective** (why it exists), **Key work** (scope), and a **Definition of Done** (verifiable
> exit). Epics map to GitHub milestones; stories map to issues. Effort: S/M/L. Order respects
> dependencies — do epics top-to-bottom.

## Final expected outcome (north star)

**A user who never opens the terminal can do everything Claude Code offers through the chat UI**, with
the Claude Code VS Code extension as the visual/interaction reference. Concretely: they hold a real
multi-turn conversation, recover from errors, resume past sessions, drive input with @-mentions / slash
commands / images, approve tools with risk visible and "always allow" that sticks, and see their cost
and context usage — all before `CHAT_UI_ENABLED` is flipped on for release.

**Definition of done for the whole program:** the six ship-gate criteria in `chat-ui-parity.md` pass
under E2E + manual QA, no session/process leaks, and the dev-only flag guard is removed.

---

## EPIC 1 — Conversational continuity + recovery

**Epic objective:** turn the chat from a one-shot demo into a real, recoverable conversation. This is
the blocker: without it, nothing else matters because the user can't ask a second question.
**Epic outcome:** follow-ups continue the same session with full context; every error/crash is
recoverable from the GUI; no hung composer, no leaked sessions.

| ID   | Story                                | Objective                                                | Key work                                                                                                                                                                                           | DoD                                                                                                             | Effort |
| ---- | ------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------ |
| C1-1 | Keep stdin open + wire `input`       | Let a live session receive more than one prompt          | Stop `.end()`ing stdin after the first prompt (`electron/agent/index.ts`); implement the `input` `AgentRequest` variant in `electron/main.ts` (currently no-op `ok`) to write to the running child | A second prompt reaches the same CLI process; unit/integration test proves the child is not respawned on turn 2 | M      |
| C1-2 | `send()` continues vs starts         | Stop killing context on every follow-up                  | `hooks.send()` issues `input` on an existing live session; reserve `start` for first turn / explicit new session; pass `resumeFromSessionId` where relevant                                        | Turn 2 shares context of turn 1 (model can reference prior turn); test asserts request type per turn            | M      |
| C1-3 | Message queue + send-while-streaming | Let users type/queue the next message without waiting    | Store queue; distinct Send↔Stop button state; auto-send queued follow-up on `message-end` (`store.ts`, `Composer.tsx`)                                                                             | Can enqueue during a stream; queued msg auto-sends on turn end; covered by test                                 | M      |
| C1-4 | Error / crash recovery surface       | Make an errored turn a recoverable state, not a dead end | Read `turnState==='error'` in `ChatPanel`; render banner/toast with Retry; re-auth prompt on `AGENT_NOT_AUTHENTICATED`; implement the promised `snapshot-warning` toast                            | Auth/rate-limit/network/crash each show a recovery action; Retry resends last turn; test per error code         | M      |
| C1-5 | Optimistic cancel + "Stopping…"      | Never leave the composer stuck after Stop                | Optimistic local reset on cancel; "Stopping…" transient state; don't depend solely on main emitting `cancelled`                                                                                    | Dropping the `message-end` event still clears streaming within a timeout; test simulates dropped event          | S      |
| C1-6 | Fix session leak on tab close        | Stop leaking Zustand sessions + orphan processes         | Call `store.closeSession` from `AgentsPane`/`ChatPanel` on tab close; confirm before closing a mid-stream session                                                                                  | Closing a chat tab removes the session from the store and kills its child; test asserts no residual session     | S      |

---

## EPIC 2 — Input parity (@-mentions, slash commands, images)

**Epic objective:** deliver the three signature Claude Code input affordances that terminal users rely
on and the reference exposes prominently.
**Epic outcome:** the composer can reference files, run commands, and attach images — no terminal
syntax required.

| ID   | Story                        | Objective                                                              | Key work                                                                                                                                                                                    | DoD                                                                                                                       | Effort |
| ---- | ---------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------ |
| C2-1 | @-mention file/symbol picker | Let users pull vault files into context by name                        | `@` trigger detection in the textarea; fuzzy file/symbol popover (reuse vault index); chip rendering; actually populate + send `composer.mentions` (`send()` ignores `opts.mentions` today) | Typing `@` filters files; selecting inserts a chip; the mention reaches the CLI as file context; test covers trigger→send | L      |
| C2-2 | Slash-command menu           | Give GUI access to `/clear`, `/compact`, `/model`, and custom commands | `/` trigger; command registry with typeahead + descriptions; dispatch that routes `/clear`→new session, `/compact`→compaction, `/model`→switch; load custom project/user commands           | Each built-in command performs its action from the menu; custom commands listed; test covers dispatch                     | L      |
| C2-3 | Image attach + paste         | Enable multimodal input (screenshots, diagrams)                        | Migrate `AgentRequest.prompt` string→content-block array with image blocks (`agent-protocol.ts`, `index.ts`); composer file/image picker + `onPaste` + thumbnails                           | Pasting/attaching an image sends it as an image block the model receives; thumbnail shown; test covers encode path        | L      |

---

## EPIC 3 — Session management + ambient chrome

**Epic objective:** make a session a durable, navigable, transparent entity — resume it, choose its
model, and see its cost/context.
**Epic outcome:** users browse and reopen past conversations, pick a model, and always see spend +
context fullness. (Depends on Epic 1's continuous session model.)

| ID   | Story                             | Objective                                                      | Key work                                                                                                                                                                                | DoD                                                                                               | Effort |
| ---- | --------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------ |
| C3-1 | Session history / resume          | Let users return to a prior conversation                       | Wire `list-sessions`/`load-session` in `main.ts`; pass `resumeFromSessionId` from `hooks.send`; history list UI; enable `ChatHeader` history/new-session buttons (disabled stubs today) | Reopening a past session restores its transcript and continues it; test covers list→load→continue | L      |
| C3-2 | Model picker                      | Let users choose Opus/Sonnet/Haiku per session                 | Read `session-init` model; set `req.model` in `hooks.send`; persist per session; UI near composer                                                                                       | Switching model affects the next turn; persists across reopen; test asserts `req.model`           | M      |
| C3-3 | Cost / token / context indicators | Give visibility into spend and context fullness (trust/safety) | Persist `costUSD` + `durationMs` (add `Session.cost`); render running cost + cumulative tokens + a context-window meter in `ChatHeader`; detect compaction                              | Cost + token counters update per turn; context meter reflects usage; test covers reducer + render | M      |
| C3-4 | Persist permission mode           | Stop resetting the safety mode on every reopen                 | Persist `session.permissionMode` across close/reopen                                                                                                                                    | Reopening a session restores its mode; test asserts persistence                                   | S      |

---

## EPIC 4 — Rich tool & agentic surfaces

**Epic objective:** match the reference's per-tool fidelity and the plan/todo workflows that make the
agent legible.
**Epic outcome:** every common tool renders as a purpose-built card; plans and todo lists are
first-class; approval fatigue is reduced with persistent, scoped allow rules.

| ID   | Story                                   | Objective                                               | Key work                                                                                                                                                                                    | DoD                                                                                                                     | Effort |
| ---- | --------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------ |
| C4-1 | TodoWrite panel                         | Show the agent's live plan as an evolving checklist     | `TodoCard` + adapter/store merge of successive `TodoWrite` calls into one list (pending/in-progress/completed)                                                                              | Todo updates coalesce into one live checklist, not repeated JSON blobs; test covers merge                               | M      |
| C4-2 | ExitPlanMode approval card              | Make leaving plan mode an explicit, reviewable handoff  | Plan-presentation card with an approve action that transitions the session out of plan mode                                                                                                 | Approving a plan switches mode and proceeds; test covers transition                                                     | M      |
| C4-3 | Typed cards for remaining tools         | Remove raw-JSON fallback for common tools               | Cards for Grep/Glob (match/file lists), WebFetch/WebSearch (URL/query + preview), MultiEdit (per-hunk diff), NotebookEdit (cell diff); WriteCard diff view                                  | Each listed tool renders a purpose-built card; test per card                                                            | S      |
| C4-4 | Approval gate polish + persistent allow | Reduce approval fatigue without over-granting           | Inline risk badge + suggestion; persistent cross-session "always allow" with scope choices + rule store; batch approve-all (`ToolApprovalGate.tsx`, `useToolApproval.ts`, `permissions.ts`) | "Allow always" persists across sessions with visible scope; risk shown; test covers rule persistence + scope            | M      |
| C4-5 | Reading polish                          | Bring thinking/user text up to the reference's fidelity | Thinking collapse/markdown + "Thought for Ns" summary; user-message markdown; assistant code-block copy + syntax highlighting                                                               | Thinking collapses by default and renders markdown; user messages render markdown; code blocks copy; test covers render | S      |

---

## EPIC 5 — Advanced harness features

**Epic objective:** close the remaining terminal-only capabilities; several require protocol changes so
they come after the core experience is complete.
**Epic outcome:** MCP tools, background bash, hooks, nested subagents, and pre-apply diff review all
work from the GUI.

| ID   | Story                         | Objective                                                    | Key work                                                                                                                   | DoD                                                                                     | Effort |
| ---- | ----------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------ |
| C5-1 | MCP tools config + rendering  | Support Model Context Protocol servers from the GUI          | `--mcp-config` plumbing; per-server tool grouping/icons; tune `classifyToolRisk` so `mcp__*` isn't blanket `'destructive'` | MCP tools load, group by server, and don't over-prompt; test covers risk classification | L      |
| C5-2 | Background bash               | Support detached shells + their lifecycle                    | `run_in_background` handling; BashOutput/KillShell cards; live task list/polling; live foreground stdout + exit-code chip  | A backgrounded command shows in a task list with output/kill; test covers lifecycle     | L      |
| C5-3 | Hook-event surfacing          | Make user-configured hooks visible instead of dropped        | Adapter cases for PostToolUse/Stop/Notification/SessionStart (dropped today despite `--include-hook-events`)               | Hook output/blocking is rendered; test covers adapter parse                             | M      |
| C5-4 | Subagent nested streaming     | Show a subagent's inner work live, not just its final result | Thread child events through the protocol; nested sub-timeline in `AgentCard`                                               | A Task subagent streams its inner tool calls/thinking; test covers child-event carriage | L      |
| C5-5 | Diff accept/reject + per-hunk | Let users review and partially apply edits before they land  | Pre-apply diff review with accept/reject-whole and keep/undo-per-hunk (`DiffCard.tsx`, `permissions.ts`)                   | User can reject or partially apply an edit before it's written; test covers per-hunk    | L      |

---

## EPIC 6 — Ship gate: flip `CHAT_UI_ENABLED`

**Epic objective:** verify terminal-free parity is genuinely complete, then enable the flag for release.
**Epic outcome:** the chat UI ships to release users as a complete Claude Code interface.

| ID   | Story                       | Objective                                                   | Key work                                                                                                                          | DoD                                                            | Effort |
| ---- | --------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------ |
| C6-1 | E2E coverage of the 6 flows | Prove the ship-gate criteria hold automatically             | Playwright E2E: multi-turn, resume, error/retry, @-mention + slash + image send, approval allow/deny/always, cancel, cost/context | All six flows green in CI                                      | M      |
| C6-2 | Manual QA + a11y pass       | Confirm parity against the reference and keyboard/AT access | Manual QA vs VS Code extension top flows; a11y pass (gate keyboard control, live regions)                                         | QA checklist signed off; no critical a11y issues               | S      |
| C6-3 | Flip the flag               | Ship it                                                     | Confirm no store leaks / orphan processes on close/crash; remove dev-only guard in `src/lib/featureFlags.ts`                      | Release build ships the chat UI; smoke test on all 3 platforms | S      |

---

## Sequencing summary

```
EPIC 1 (blocker) ──► EPIC 2 ──► EPIC 3 ──► EPIC 4 ──► EPIC 5 ──► EPIC 6 (gate)
   continuity        input      session     rich       advanced    ship
```

- **Epic 1 is a hard prerequisite** for everything (resume, slash-commands that mutate session state,
  queued input all depend on a continuous session).
- **Epic 2's images (C2-3)** and **Epic 5's subagent nesting (C5-4)** share the `prompt` string→content-block
  protocol migration — do that migration once, in C2-3, behind the flag.
- **Epics 4 and 5 are not ship-gate blockers** — they can land after the flag is on, in later releases.
- Minimum viable terminal-free chat = **Epics 1 + 2 + 3** + the Epic 6 gate.
