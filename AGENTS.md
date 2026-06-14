# AGENTS.md

Guidance for autonomous agents working in this repository. For deeper coding
philosophy and the issue-first gate, see [`CLAUDE.md`](CLAUDE.md). For the full
branch/PR workflow see [`.claude/rules/git-workflow.md`](.claude/rules/git-workflow.md).

## Project overview

Marvin is an Obsidian-style Markdown editor with the `claude` CLI running in a
sidebar. It is an **Electron + React + Vite + TypeScript** desktop app:

- **Main process** (`electron/`): IPC, vault filesystem access, a `chokidar`
  watcher, `node-pty` terminal spawning, snapshot/undo storage, and the
  `marvin://` image protocol. Compiled to `dist-electron/`.
- **Renderer** (`src/`): React 19 UI — file tree, tabbed CodeMirror editor with
  live `react-markdown` preview, and an `xterm.js` terminal. Bundled to `dist/`.
- A "vault" is just a user-chosen folder of `.md` files; all filesystem access is
  constrained to that folder (see Security boundaries below).

## Setup

Requires Node.js 20+ and the `claude` CLI on `PATH` (see README for install).

```bash
npm install        # runs scripts/fix-node-pty.cjs postinstall (chmod node-pty helper)
npm run dev        # Vite + vite-plugin-electron spawns Electron at the dev server
```

The `dev`/`start` scripts clear `ELECTRON_RUN_AS_NODE` (some agent runtimes set it
to `1`, which breaks Electron). If you launch Electron manually, unset that var.

## Build

```bash
npm run build      # tsc -b (typecheck) + vite build → dist/ and dist-electron/
npm run preview    # serve the built renderer
npm run dist:mac   # electron-builder .dmg (also dist:win / dist:linux)
```

`npm run build` runs `tsc -b` across `tsconfig.app.json` (renderer) and
`tsconfig.node.json` (main/scripts), so a successful build is also a full
typecheck. Run it before opening a PR.

## Test

```bash
npm test               # vitest run (all projects)
npm run test:coverage  # vitest run --coverage (thresholds enforced, see below)
npm run test:e2e       # playwright test (Electron e2e in e2e/)
```

Vitest is split into projects (see `vitest.config.ts`) — match the right
environment when adding tests:

| Project      | Environment | Location / pattern                                              |
| ------------ | ----------- | --------------------------------------------------------------- |
| `electron`   | node        | `electron/__tests__/**`, `src/lib/__tests__/**/*.spec.ts`       |
| `editor`     | jsdom       | `src/components/__tests__/**`, `src/lib/__tests__/**/*.spec.tsx`|
| `chat`       | jsdom       | `src/lib/chat/__tests__/**`, `src/components/chat/__tests__/**` |
| `complexity` | node        | `scripts/complexity/__tests__/**`                               |

Naming: `.spec.ts` → node (electron), `.spec.tsx` → jsdom (editor). Coverage
thresholds of 80% (lines/functions/branches) are enforced on the `electron` and
`chat` projects for the files listed in `vitest.config.ts`.

To check a single project quickly without running the whole suite:

```bash
npx vitest run --project chat
npx vitest list --project chat   # enumerate tests without executing
```

## Lint and typecheck

```bash
npm run lint       # eslint . (flat config: typescript-eslint + react-hooks)
npx tsc -b         # standalone typecheck
```

There is no auto-formatter configured; match the surrounding style (2-space
indent, single quotes, no semicolons in TS — see existing files).

## Development workflow

This repo is **issue-first**. Before non-trivial feature/refactor/bug work:

1. Search issues: `gh issue list --repo marcelusfernandes/marvinz --search "<keywords>"`.
2. If none exists, create one before writing code.
3. Branch from `develop`: `gh issue develop <num> --base develop --name <type>/<slug> --checkout`.

Branch model: `main` (production) ← PR from `develop` (active dev) ← `<type>/<slug>`
feature branches. Branch/commit prefixes: `feat`, `fix`, `refactor`, `perf`,
`chore`, `docs`, `test`, `ci`.

Conventions (non-negotiable):

- **Never** commit directly to `main` or `develop`; never force-push them.
- **Never** merge a PR — the human reviews and merges.
- PR body uses `Closes #N` in **plain text** (no bold/italic — GitHub's auto-close
  parser misses `Closes **#N**`).
- All text that goes to GitHub (commits, PR/issue titles and bodies, code-facing
  error messages) is written in **English**.
- Commit format: `<type>: <short imperative description>` (lowercase, no trailing period).

Exempt from the issue gate: typo fixes, single-file edits under ~50 LOC, and
read-only/exploratory tasks.

## Project layout

```
electron/
  main.ts            Main process: IPC, vault FS, watcher, pty spawn, link rewriter
  preload.ts         contextBridge exposing window.marvin API
  snapshot.ts        Snapshot/undo storage for user + AI operations
  vault-boundary.ts  Enforces the vault filesystem boundary
  agent/             Agent terminal wiring, permissions, approval socket
src/
  App.tsx            3-pane layout, tab/state orchestration
  components/        FileTree, Editor, ClaudeTerminal, TabBar, chat/, ...
  lib/               Stores, hooks, markdown, featureFlags.ts, marvinUrl.ts
  shared/            Types shared between main and renderer
scripts/
  complexity/        Estimation harness (predict/measure/record outcome ledger)
  fix-node-pty.cjs   postinstall: restore +x on node-pty's spawn-helper
e2e/                 Playwright Electron specs + page objects (poms/)
.claude/             Agent rules, skills, hooks, commands consumed by Claude Code
```

## Security boundaries

- All vault filesystem access goes through `electron/vault-boundary.ts` /
  `vault-allowlist.ts`; paths that escape the active vault are rejected.
- Images render through the custom `marvin://` protocol so the renderer cannot
  read arbitrary OS files.
- Secrets are never hardcoded — CI uses GitHub Actions `secrets.*`. Do not commit
  tokens or `.env` files containing secrets.

## Feature flags

Development-only features are gated in `src/lib/featureFlags.ts` via `VITE_*` env
vars (see `.env.development`): `VITE_CHAT_UI_ENABLED`, `VITE_OFFICE_EDIT_ENABLED`.
Release builds leave these unset so in-progress features stay gated out.
