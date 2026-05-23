# Marvin

A minimal Obsidian-style Markdown editor with **Claude Code** running as a sidebar. Your vault is just a folder of `.md` files; an embedded terminal runs the `claude` CLI scoped to that folder, so you can ask Claude to read, edit, and create notes via natural language while you write.

> Status: 0.2.0 — early but usable. Built on Electron + React + Vite + TypeScript.

## Features

- **Vault picker** — point Marvin at any folder; choice is persisted across launches.
- **File tree** — shows hidden files by default, skips known noise (`.git`, `node_modules`, `.DS_Store`, …); right-click for rename / move-to-trash / reveal-in-Finder / new-note-here / new-folder-here.
- **Drag & drop** — drag files or folders onto another folder to move them, or onto the empty tree area to move to vault root. Markdown links inside the moved item and references from other notes are auto-rewritten to keep working.
- **Tabs** — clicking a note opens a new tab (or focuses the existing tab if the path is already open). Each tab has its own back/forward history; clicking a link inside a preview navigates within the same tab.
- **CodeMirror 6 editor** with Markdown highlighting, line wrap, and debounced autosave.
- **Live preview** rendered with `react-markdown` + GFM (tables, task lists, strikethrough). Internal `.md` links resolve relative to the note; external `https://` / `mailto:` links open in the system browser.
- **Image previews** — `![alt](path)` and `![[name]]` render inline using a custom `marvin://` protocol that enforces the vault boundary. See [Image syntax](#image-syntax) for the supported forms.
- **External-edit hot reload** — `chokidar` watches the vault; when Claude (or anything else) edits a file open in a tab, the tab updates without losing your unrelated tabs. The watcher distinguishes our own saves from external writes by content equality.
- **Claude Code sidebar** — `xterm.js` + `node-pty` running the `claude` CLI with `cwd = vault` and an inherited shell environment (so `git`, `node`, `ripgrep`, etc. are on `PATH`). The CLI's native `@`-mention completion sees every note in your vault.
- **Restart button** when Claude exits (logout / crash) — re-spawns without reloading the window.

## Requirements

- macOS (Linux/Windows untested but should mostly work)
- Node.js 20+
- [`claude`](https://docs.claude.com/en/docs/claude-code/quickstart) on `PATH`. Marvin detects it via `which claude` and falls back to `~/.local/bin`, `/usr/local/bin`, `/opt/homebrew/bin`. Install via `npm i -g @anthropic-ai/claude-code` or the install script.

## Quickstart

```bash
npm install
npm run dev
```

The dev script launches Vite, then the vite-plugin-electron plugin spawns Electron pointing at the dev server. Hot reload covers both renderer (React) and main process (Electron) changes.

> **Note:** if the launch terminal exports `ELECTRON_RUN_AS_NODE=1` (some agent runtimes do), the npm script clears it for the child process. If you launch Electron differently, make sure the var is unset.

## Build

```bash
npm run build
```

Outputs the renderer to `dist/` and the bundled main/preload to `dist-electron/`. Packaging via `electron-builder` is configured but not yet wired into a script.

## Project layout

```
electron/
  main.ts           Main process: IPC, vault FS, chokidar watcher, pty spawn, link rewriter
  preload.ts        contextBridge exposing window.marvin API
src/
  App.tsx           3-pane layout, tab/state orchestration
  components/
    FileTree.tsx        tree, drag-and-drop, right-click
    Editor.tsx          CodeMirror + react-markdown preview, edit/preview toggle
    ClaudeTerminal.tsx  xterm.js host + pty wiring
    TabBar.tsx          tab bar with back/forward
    ContextMenu.tsx     positioned right-click menu
    InputDialog.tsx     custom modal (window.prompt is disabled in Electron)
    SidebarMenu.tsx     "+" dropdown for new note / new folder
scripts/
  fix-node-pty.cjs  postinstall: chmod +x on node-pty's spawn-helper (npm strips bits)
.claude/
  rules/            project-local rules consumed by Claude Code agents
```

## Image syntax

The live preview resolves four image-source shapes, each routed through the `marvin://` protocol so the renderer cannot escape the active vault:

| Form | Example | Resolution |
|---|---|---|
| Relative path | `![diagram](./assets/diagram.png)` | Resolved against the directory of the current note. `..` segments are allowed but cannot escape the vault. |
| Vault-absolute | `![logo](/assets/logo.png)` | Joined with the vault root. The leading `/` does **not** mean the OS filesystem root. |
| Embed wikilink | `![[cover.png]]` or `![[cover.png\|cover alt]]` | Looked up by filename across the vault (basename match, same-folder preference on ambiguity). |
| External | `![banner](https://example.com/banner.png)` or `data:image/...` | Passed through unchanged. |

When an image cannot be resolved (path escapes the vault, wikilink target missing, file not found at load time), the preview renders an inline `image not found` placeholder showing the original `src` in its `title`. The on-disk markdown is never rewritten — switch to `Edit` mode to see the raw syntax.

> External `http(s)` image URLs are loaded directly — Marvin doesn't proxy or cache them. Be cautious with notes from untrusted sources.

## Workflow

See [`.claude/rules/git-workflow.md`](.claude/rules/git-workflow.md) for the branch model and PR workflow.

- `main` — production
- `develop` — active development
- `<type>/<slug>` — feature branches from `develop`, opened as PRs into `develop`

## What's not (yet) here

- Wikilinks `[[name]]`
- Full-text search
- Backlinks panel / graph view
- Plugin system
- Mobile / Linux / Windows packaging
- Sync (use `git`, iCloud, Syncthing, etc. on the vault folder)
