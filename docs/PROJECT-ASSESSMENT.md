# Marvin — Project Assessment

> Date: 2026-07-02 · Version assessed: 0.13.1 · Codebase: ~75k LOC, 144 source files, 149 test files

## Executive Summary

Marvin occupies a unique strategic position as the only desktop markdown editor with a first-class Claude Code sidebar. The codebase demonstrates strong security fundamentals (vault boundary enforcement, IPC validation, contextIsolation) and a mature AI-agent development workflow (12 specialized agents, squad orchestration, complexity calibration harness). However, the project has **critical gaps** that prevent it from reaching production-grade state-of-the-art: two security vulnerabilities enabling arbitrary file read, TypeScript `strict` mode disabled, god modules in both the main process and renderer, WCAG AA non-compliance, no dependency security scanning, and missing table-stakes features (graph view, auto-updater, code signing) needed for competitive parity.

**Maturity: 6.5/10** — solid engineering foundation with security and architectural debt that must be resolved before wider adoption.

---

## 1. Security Findings

### CRITICAL / HIGH

| #   | Finding                                                                                                   | File                                  | Severity   | Effort |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------- | ------ |
| S1  | `file:exportPdf` bypasses vault boundary — arbitrary file read from renderer                              | `electron/main.ts:1308`               | **HIGH**   | Small  |
| S2  | `file:exportPdf` renders unsanitized markdown as HTML in BrowserWindow (no DOMPurify, no CSP, no sandbox) | `electron/main.ts:1313-1340`          | **HIGH**   | Small  |
| S3  | No Content-Security-Policy on main renderer window                                                        | `electron/main.ts:246`, `index.html`  | **MEDIUM** | Small  |
| S4  | `shell:openExternal` in `setWindowOpenHandler` lacks URL scheme validation (accepts `file://`, `smb://`)  | `electron/main.ts:275-278, 1659-1661` | **MEDIUM** | Small  |
| S5  | SheetJS (`xlsx@0.18.5`) — known CVEs (CVE-2023-30533), unmaintained npm package                           | `package.json`                        | **MEDIUM** | Medium |

### Recommendations

1. **Immediate**: Add `assertInVault(filePath)` to `file:exportPdf`, sanitize with DOMPurify, add `sandbox: true` + CSP to the export BrowserWindow, write temp file to `app.getPath('temp')`.
2. **Short-term**: Set CSP on main renderer via `session.webRequest.onHeadersReceived`. Apply URL scheme guard in `setWindowOpenHandler` callbacks. Evaluate xlsx alternatives.
3. **CI**: Add `npm audit` and CodeQL/Snyk to quality pipeline.

### Good Practices Already in Place

- `contextIsolation: true`, `nodeIntegration: false` on all windows
- Vault boundary enforcement with `realpath()` for TOCTOU safety + symlink resolution
- PTY spawn guard with shell allowlist and argument injection blocking
- `marvin://` protocol validates vault boundary + applies `script-src 'none'` CSP
- External file import blocklist (blocks `~/.ssh`, `~/.aws`, `~/.gnupg`, credentials)
- Error envelope sanitization strips host paths before reaching renderer
- Session/turn ID validation with strict regex patterns

---

## 2. Architecture & Code Quality

### Strengths

- Well-extracted security modules (`vault-boundary.ts`, `pty-spawn-guard.ts`, `agent-detect-guard.ts`)
- Agent subsystem properly isolated in `electron/agent/` with own protocol, adapters, permissions
- End-to-end IPC type safety (`preload.ts` → `MarvinAPI` → `Window.marvin`)
- Minimal zustand store surface (3 stores: chat, clipboard, fileOpsHistory)
- Good test infrastructure (4 vitest projects with targeted coverage thresholds)

### Critical Issues

| #   | Finding                                                                                                                                                                         | Severity     | Effort |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ |
| A1  | **TypeScript `strict: true` disabled** — no `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`. Entire codebase has zero null-safety at compiler level                  | **CRITICAL** | Large  |
| A2  | **`electron/main.ts` is a god module** — 2116 LOC, 60 IPC handlers mixing file ops, vault management, PTY lifecycle, browser views, snapshots, clipboard, menus, agents, office | **HIGH**     | Large  |
| A3  | **`src/App.tsx` is a god component** — 2363 LOC, 30 `useState` calls, zero intermediate components for state clusters                                                           | **HIGH**     | Large  |
| A4  | **Triplicated types** — `FileNode`, `MenuItemSpec`, `Settings` defined 3× across `main.ts`, `preload.ts`, `types.ts` with drift (`Settings` in preload omits `saveMode`)        | **MEDIUM**   | Small  |
| A5  | **No architectural layer enforcement** — `.dependency-cruiser.cjs` only covers renderer; no rule preventing `src/` from importing `electron/` internals                         | **LOW**      | Small  |

### Refactoring Roadmap

1. **Extract IPC handler groups from `main.ts`**: file ops, browser views, snapshots, PTY, office → separate modules receiving context. Target: `main.ts` < 500 LOC as wiring.
2. **Extract `useTabManager` hook from `App.tsx`**: tab state + operations + dirty tracking (~800 LOC). Extract layout management and keyboard shortcut handlers next.
3. **Consolidate shared types** into `src/shared/types.ts` (pattern already established by `agent-protocol.ts`).
4. **Enable TypeScript `strict: true`** incrementally — start with `strictNullChecks` on new files, expand with `// @ts-strict-ignore` escape hatches for legacy.

---

## 3. Testing & Coverage

### Summary

- **2342 tests total**, 2340 passing (2 environment-specific failures)
- **`electron/main.ts`: 11.57% line coverage** — the 2116-line IPC hub relies solely on slow e2e tests
- **Chat project: 75.31% stmts** — below declared 80% threshold
- **`ToolApprovalGate.tsx`: 52% branch** — security-adjacent UI with weakest coverage among gated files
- **Coverage reporting is broken** when any test fails (`reportOnFailure: false` default)

### Untested Critical Paths

| Component                 | Lines | Coverage   | Risk                                         |
| ------------------------- | ----- | ---------- | -------------------------------------------- |
| `electron/main.ts`        | 2116  | 11.57%     | IPC handlers for all file/vault/agent ops    |
| `MessageList.tsx`         | —     | 0%         | Chat scroll container (deferred to Sprint 9) |
| `DiffViewer.tsx`          | 336   | 0%         | File diff rendering                          |
| `ChatHeader.tsx`          | —     | 0%         | Chat header controls                         |
| `LayoutToggle.tsx`        | —     | 0%         | Layout switching                             |
| `EditorSelectionChip.tsx` | —     | 0%         | Selection-to-agent feature                   |
| `src/lib/attachments.ts`  | —     | 0%         | Drag-drop attachment handling                |
| `ToolApprovalGate.tsx`    | —     | 52% branch | Tool execution permission gate               |

### Recommendations

1. Set `coverage.reportOnFailure: true` in `vitest.config.ts` — a single failing test currently blinds the entire coverage report.
2. Extract and unit-test IPC handler logic from `main.ts` — e2e alone gives no fast feedback.
3. Raise `ToolApprovalGate.tsx` coverage (security-adjacent).
4. Add tests for all 0% components listed above.
5. Make `approval-socket.spec.ts` resilient to offline environments (mock Electron runtime or document network requirement).

---

## 4. Performance

### Strengths

- **Lazy loading done well**: mermaid (~2MB) dynamically imported on first diagram; CodeMirror language modes imported per-language (14 `await import()` calls); xlsx/mammoth parsed in main process, not bundled to renderer
- **Virtualized file tree**: `@tanstack/react-virtual` with `overscan` in `FileTree.tsx`
- **IPC listener cleanup pattern**: consistent unsubscribe functions across all 8 subscription APIs
- **Balanced DOM listeners**: 25 `addEventListener` / 25 `removeEventListener` across components
- **Efficient file watching**: `chokidar` uses `ignoreInitial: true`, closes on vault switch, relative-path-aware filter

### Risks

| #   | Finding                                                                                                | Impact                       | Effort |
| --- | ------------------------------------------------------------------------------------------------------ | ---------------------------- | ------ |
| P1  | `MessageList.tsx` has no virtualization — long chat sessions re-render all messages                    | **HIGH** (deferred Sprint 9) | Medium |
| P2  | Only 4 components use `React.memo` out of dozens — streaming chat re-renders propagate widely          | **MEDIUM**                   | Medium |
| P3  | No explicit vendor chunk strategy in `vite.config.ts` — CodeMirror/Milkdown/zustand in one main bundle | **LOW**                      | Small  |
| P4  | `chokidar.watch` on vault root with no depth cap — large vaults untested                               | **LOW**                      | Small  |

---

## 5. UX & Accessibility

### Current State: **WCAG 2.1 Level A** (not AA)

### Critical Gaps

| #   | Finding                                                                                                                                           | WCAG   | Effort |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| U1  | **CommandPalette missing ARIA combobox pattern** — no `role="combobox"`, `aria-owns`, `aria-expanded`. Search completely opaque to screen readers | 4.1.2  | 2-3h   |
| U2  | **SettingsModal missing focus trap** — tab key escapes modal to content behind                                                                    | 2.4.3  | 1-2h   |
| U3  | **Text contrast failures** — `--text-tertiary` (#9e9e9e light / #8e8e93 dark) fails AA 4.5:1                                                      | 1.4.3  | 1h     |
| U4  | **No skip links or landmark navigation** — no `<nav>`, `<main>`, `<region>`                                                                       | 2.4.1  | 1h     |
| U5  | **Context menus keyboard-inaccessible** — file tree right-click is mouse-only                                                                     | 2.1.1  | 2h     |
| U6  | **Missing heading hierarchy** — no semantic heading structure for screen readers                                                                  | 2.4.10 | 1h     |
| U7  | **Inconsistent form labeling** — inputs use `aria-label` instead of `<label htmlFor>`                                                             | 1.3.1  | 1h     |

### Design Token Compliance: ~95%

Hardcoded values found in: image viewer backgrounds (#1e1e1e, #232323), browser host background (#1e1e1e), scrollbar rgba values, occasional button padding px values. All should use tokens.

### Path to AA: ~8-12 hours

Fix contrast → add combobox/focus trap → add landmarks/skip links → convert form inputs → test with assistive tech.

---

## 6. CI/CD & DevOps

### Present

- Quality pipeline: Prettier, ESLint, TypeScript, vitest (on PRs)
- AI code review via `anthropics/claude-code-action`
- Cross-platform release builds (Linux/Windows/macOS matrix)
- npm launcher publishing (`npx marvinz`)
- Milestone completeness gate
- Complexity prediction calibration harness (3 workflows)
- Husky pre-commit: lint-staged (prettier + eslint)
- Code quality: knip (dead code), jscpd (duplication), dependency-cruiser (circular deps)

### Missing

| #   | Gap                                                                                   | Impact     | Effort               |
| --- | ------------------------------------------------------------------------------------- | ---------- | -------------------- |
| C1  | **No security scanning** — no CodeQL, Snyk, `npm audit`, SAST/DAST                    | **HIGH**   | Small                |
| C2  | **No Dependabot/Renovate** — no automated dependency updates                          | **HIGH**   | Small                |
| C3  | **No auto-updater** — desktop users must manually download new releases               | **HIGH**   | Medium               |
| C4  | **No Windows code signing** — SmartScreen warnings on install                         | **MEDIUM** | Medium               |
| C5  | **macOS code signing wired but secrets not set** (#515) — Gatekeeper warnings persist | **MEDIUM** | Small (just secrets) |
| C6  | **No changelog generation** — relies on GitHub `--generate-notes` only                | **LOW**    | Small                |
| C7  | **No pre-push hook** — type-check and tests rely entirely on CI                       | **LOW**    | Small                |
| C8  | **No e2e tests in CI** — only unit tests run in `quality.yml`                         | **MEDIUM** | Medium               |

---

## 7. Developer Experience & Ecosystem

### Strengths

- **Exceptional Claude Code integration**: 12 specialized agents, `/squad` orchestration with full lifecycle management, 6 auto-invoked skills, 3 enforcement hooks (force-push block, eslint auto-fix, tsc check)
- **Complexity calibration harness**: PredictionVector at triage → OutcomeRecord at merge → TrendReport for calibration drift. Unique among open-source projects.
- **Quality tooling**: knip + jscpd + dependency-cruiser catch dead code, duplication, and circular deps
- **Issue-first workflow**: enforced by CLAUDE.md, git-workflow.md, and CI gates

### Gaps

| #   | Gap                                                                           | Impact     |
| --- | ----------------------------------------------------------------------------- | ---------- |
| E1  | **No plugin/extension API** — users can't extend Marvin without forking       | **HIGH**   |
| E2  | **No CONTRIBUTING.md** — onboarding for external contributors unclear         | **MEDIUM** |
| E3  | **No Storybook or component catalog** — UI development lacks isolated preview | **LOW**    |
| E4  | **No API documentation** — IPC surface and `MarvinAPI` undocumented           | **LOW**    |

---

## 8. Product Gaps vs. Competitors

### Table Stakes (Missing)

| Feature                      | Obsidian      | Cursor     | VS Code       | Marvin                |
| ---------------------------- | ------------- | ---------- | ------------- | --------------------- |
| Graph view / backlinks panel | Yes           | —          | Extension     | **No**                |
| Plugin system                | 1500+ plugins | Extensions | Marketplace   | **No**                |
| Auto-updater                 | Yes           | Yes        | Yes           | **No**                |
| Code signing                 | Yes           | Yes        | Yes           | **Wired, not active** |
| Mobile app                   | Yes           | —          | Web/mobile    | **No**                |
| Sync                         | Paid          | —          | Settings Sync | **No**                |
| Daily notes / templates      | Yes           | —          | Extension     | **No**                |

### Unique Differentiators (Marvin Wins)

1. **AI IDE + note editor in one** — no competitor bundles Claude Code inside a markdown editor
2. **Privacy-first vault** — no cloud, no accounts, no telemetry
3. **External-edit hot reload** — content-equality detection, multi-writer safe
4. **Agent-aware snapshots** — turn-based undo with AI vs. user attribution
5. **Multi-agent workspace** — Claude Code + Codex in separate panes

---

## 9. Unexploited Opportunities

### Transformative

| #   | Opportunity                                                                                                                       | Thesis                                                                                                             | Effort |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------ |
| O1  | **Markdown as executable interface** — inline `claude:` directives in notes that trigger agent actions                            | Turn notes into programs. Researchers write hypotheses → Claude runs experiments. PMs write specs → Claude codes.  | Large  |
| O2  | **Vault-aware context in chat** — drag notes into composer, auto-include as context (like Cursor's "Add Files" but for knowledge) | Bridge the gap between note-taking and AI prompting. Users include background notes, error logs, research context. | Small  |
| O3  | **Knowledge graph + semantic search** — embedding-based search returning conceptually related notes even without keyword match    | No local-first editor does this. Obsidian only has keyword + graph topology.                                       | Large  |

### High Impact

| #   | Opportunity                                                                                                                        | Thesis                                                                                             | Effort |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------ |
| O4  | **Approval pattern learning** — track what edits users approve/reject, surface patterns to Claude for better suggestions over time | Implicit preference model without explicit data collection. Uses existing snapshot infrastructure. | Medium |
| O5  | **Vault templates** — ship "Research Vault," "Software Project," "Content Studio" templates with pre-configured agent rules        | Obsidian guides teach organizing; Marvin teaches "organizing for AI." Lower barrier to entry.      | Small  |
| O6  | **Multi-vault synthesis** — query across vaults, Claude synthesizes findings                                                       | Cross-project knowledge work. No competitor does this well locally.                                | Medium |

---

## 10. Prioritized Action Plan

### Tier 1 — Fix Now (security + correctness, < 1 week)

| #   | Action                                                     | Why                                       | Effort |
| --- | ---------------------------------------------------------- | ----------------------------------------- | ------ |
| 1   | Fix `file:exportPdf` vault boundary bypass + sanitize HTML | Arbitrary file read from renderer         | 2h     |
| 2   | Add CSP to main renderer window                            | XSS defense-in-depth                      | 2h     |
| 3   | Fix `setWindowOpenHandler` URL validation                  | Blocks `file://`/`smb://` open            | 1h     |
| 4   | Set `coverage.reportOnFailure: true` in vitest             | Coverage report currently silently broken | 15m    |
| 5   | Fix `--text-tertiary` contrast to AA 4.5:1                 | Accessibility compliance                  | 1h     |

### Tier 2 — Ship This Quarter (competitive parity + trust)

| #   | Action                                    | Why                                         | Effort       |
| --- | ----------------------------------------- | ------------------------------------------- | ------------ |
| 6   | Ship native chat UI + tool approval gates | Biggest blocker for AI interaction trust    | In progress  |
| 7   | Activate macOS code signing (#515)        | Remove "sketchy installer" friction         | Secrets only |
| 8   | Add auto-updater (`electron-updater`)     | Users stuck on old versions = security risk | 1 week       |
| 9   | Add CodeQL/Snyk + `npm audit` to CI       | Zero security scanning today                | 1 day        |
| 10  | Add Dependabot/Renovate                   | No automated dep updates                    | 1h           |
| 11  | WCAG AA: combobox, focus trap, landmarks  | Accessibility compliance                    | 8-12h        |
| 12  | Enable TypeScript `strictNullChecks`      | No null-safety = runtime crashes            | 2-4 weeks    |

### Tier 3 — Next Quarter (architecture + product)

| #   | Action                                          | Why                                       | Effort    |
| --- | ----------------------------------------------- | ----------------------------------------- | --------- |
| 13  | Extract IPC handlers from `main.ts`             | God module blocks testability + velocity  | 2 weeks   |
| 14  | Extract `useTabManager` from `App.tsx`          | God component with 30 useState            | 1 week    |
| 15  | Consolidate shared types                        | 3× duplicate types with drift             | 1 day     |
| 16  | Add graph view / backlinks panel                | #1 feature gap vs. Obsidian               | 3-4 weeks |
| 17  | Unit-test `electron/main.ts` (currently 11.57%) | Largest untested critical path            | 2 weeks   |
| 18  | Vault-aware drag-to-compose (O2)                | Low-effort, high-impact AI-native feature | 1 week    |

### Tier 4 — Strategic (6-12 months)

| #   | Action                                 | Why                                                 | Effort        |
| --- | -------------------------------------- | --------------------------------------------------- | ------------- |
| 19  | Plugin/extension API                   | Ecosystem play, community growth                    | 2-3 months    |
| 20  | Vault templates                        | Lower barrier to entry, differentiate from Obsidian | 2 weeks       |
| 21  | Markdown as executable interface (O1)  | Transformative differentiator — notes as programs   | 2-3 months    |
| 22  | Windows code signing                   | Enterprise adoption                                 | 1 week + cert |
| 23  | Knowledge graph + semantic search (O3) | AI-native discovery no competitor does locally      | 3-4 months    |
| 24  | MessageList virtualization             | Chat performance at scale (deferred Sprint 9)       | 1 week        |

---

## Risk Assessment

**If current trajectory continues:**

1. **Security incident risk is elevated** — `file:exportPdf` arbitrary read + no CSP + no dependency scanning means a single malicious markdown file or compromised dependency could leak user data.
2. **God module velocity tax** — `main.ts` and `App.tsx` will continue growing, making every change harder and slower. New contributors will avoid both files.
3. **Accessibility lawsuit exposure** — WCAG A without AA means the app is legally vulnerable in regulated industries. Enterprise customers will require AA minimum.
4. **Competitive gap widens** — without graph view and plugin system, Obsidian users won't switch. Without auto-updater and code signing, casual users won't trust the installer.
5. **TypeScript without strict mode** is a ticking time bomb — null pointer crashes will increase as the codebase grows, and enabling strict later becomes exponentially harder.

**What's going right:** The AI-agent integration is genuinely best-in-class. The security module architecture (vault boundary, PTY guard, agent detection) is production-quality. The complexity calibration harness is innovative. The foundation is strong — the gaps are in the next layer up.
