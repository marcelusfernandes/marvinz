# Issues to create manually (GitHub API was down)

Copy-paste each block below into **New Issue** on `marcelusfernandes/marvinz`.
Order: create the **regression issue (A)** and the **3 follow-ups (B–D)** first
(they have branches/work ready), then create the **Undo/Redo V2 milestone** and
its **6 sub-issues (1–6)**.

For each: set the **Labels** and **Milestone** noted, paste the **Title** and the
body. PR bodies that reference an issue use plain `Closes #N` (no bold/italic).

---

---

## A — `fix(editor): tab/undo regressions from the Undo milestone`

**Labels:** `bug`, `ux`, `trust` · **Milestone:** _none_
**Branch ready:** `fix/note-tab-hidden-stack` (2 commits) — open a PR with `Closes #A`.

> **Tamanho:** S — one CSS rule + three small renderer guards + tests.

### User Story

**As** a user with notes open, **I want** switching tabs and pressing Cmd+Z to behave correctly, **so that** the app isn't visibly broken after the Undo milestone.

### Cenário atual / Problema

A regression sweep over the Undo (Cmd+Z) — V1 milestone found five real regressions (the first is high-visibility; the rest hit everyday flows):

1. **Stacked editors (CSS).** `#440`'s mounted-but-hidden stack sets `hidden={!isActive}` on `.note-tab-container`, but `.note-tab-container { display: flex }` (`src/App.css:2016`) overrides the UA `[hidden]{display:none}`, so inactive editors render **stacked** and switching tabs shows no change.
2. **Cmd+Z while typing a filename (U4).** The inline rename/create `<input>` lives inside `[data-panel="file-tree"]` and doesn't stop Cmd+Z, so `getActivePanelContext()` returns `file-tree` → Cmd+Z reverts an unrelated previous file op instead of undoing the typed text.
3. **Directory trash (U3).** `handleTrash` ran `snapshot.capture` (utf8 `readFile` → EISDIR) on every folder delete → a scary "Could not prepare safety copy" toast each time.
4. **Binary trash (U3).** Capturing/restoring a binary as utf8 corrupts it on undo (silent data loss).
5. **Vault switch (U3).** `fileOpsHistory` was never reset on vault switch → Cmd+Z acted on the previous vault's paths.

### Solução (implemented on the branch)

1. `.note-tab-container[hidden] { display: none }` (class+attribute specificity wins).
2. `getActivePanelContext()` returns `'other'` for a focused `input, textarea`.
   3+4. `handleTrash` only snapshots markdown notes; directories/binaries trash directly with no undo entry (no error toast, no corruption).
3. `handlePickVault` calls `useFileOpsHistory.getState().reset()`.

### Acceptance Criteria

- [ ] `.note-tab-container[hidden]` computes to `display:none`; with two files open exactly one editor is visible (e2e `tab-switch-visibility.spec.ts`, RED before / GREEN after).
- [ ] Cmd+Z while typing in the inline rename field undoes the text, not a file op (panelContext unit test).
- [ ] Trashing a folder shows no error toast; trashing a binary doesn't corrupt on undo.
- [ ] After switching vault, Cmd+Z does not act on old-vault paths.

### Referências

`src/App.css:2016`, `src/App.tsx` (handleTrash, handlePickVault), `src/lib/panelContext.ts`, `e2e/tab-switch-visibility.spec.ts`. Origin: milestone Undo (Cmd+Z) — V1 / #440.

---

---

## B — `perf(editor): gate HtmlPreview + LiveMarkdown side-effects on isActive`

**Labels:** `tech-debt`, `enhancement` · **Milestone:** _none_

> **Tamanho:** S — thread `isActive` into two components.

### Problema

After `#440`, up to `MAX_MOUNTED_EDITORS = 6` note editors stay mounted. Two side-effects of inactive (hidden) editors were found:

- **`HtmlPreview`** (`.html` tabs) creates a live `WebContentsView` on mount; up to 6 background `webContents` stay alive (not visual — neutralized by `display:none` + zero bounds — but a perf/memory cost vs the single one pre-#440), plus redundant geometry IPC from window resize/scroll listeners.
- **`LiveMarkdown`** registers a document-wide `selectionchange` listener gated only on `onSendSelection`, not on active state (`src/components/LiveMarkdown.tsx:808`); with a focused agent and N mounted preview tabs, N instances each run a 50ms debounce on every selection change (harmless but redundant).

### Solução

Thread `isActive` into `LiveMarkdown` and early-return its `selectionchange` effect when inactive. Gate `HtmlPreview` mount (or suspend/close its `WebContentsView`) for inactive tabs — a zero-bounds preview has no reason to keep executing.

### Acceptance Criteria

- [ ] An inactive (hidden) note tab does not keep a live `WebContentsView` running for `.html`.
- [ ] An inactive `LiveMarkdown` does not attach the global `selectionchange` listener.
- [ ] No regression in active-tab preview/scroll behaviour.

### Referências

`src/components/HtmlPreview.tsx`, `src/components/LiveMarkdown.tsx:808`, `src/App.tsx` (mounted stack ~2122). Origin: #440 regression hunt.

---

## C — `fix(snapshot): make user-snapshots binary-safe so non-markdown trash is undoable`

**Labels:** `enhancement`, `trust`, `snapshot-restore` · **Milestone:** _none_

> **Tamanho:** S — Buffer-based read/write in `electron/snapshot.ts` + a size policy.

### Problema

The U2 `_user` snapshot store reads/writes utf8 (`captureUserSnapshot`/`restoreUserSnapshot` in `electron/snapshot.ts`). Binary files (png/pdf) are lossily decoded → corrupted on restore. As a stopgap, the regression fix (issue A) restricts trash-undo to markdown only, so deleting a non-markdown file is **not undoable** at all.

### Solução

Read/write snapshot content as `Buffer` (no encoding) so any file round-trips byte-exact. Add an explicit max-size policy (mirror VSCode's `MAX_UNDO_FILE_SIZE`): above the cap, skip the snapshot and record no undo entry (don't silently produce an empty file). Then `handleTrash` can capture all files, not just markdown.

### Acceptance Criteria

- [ ] Capturing then restoring a binary file yields byte-identical content.
- [ ] Trashing a non-markdown file is undoable (within the size cap).
- [ ] Files above the size cap trash without an undo entry (no corruption, no empty restore).

### Referências

`electron/snapshot.ts` (capture/restore), `src/App.tsx` handleTrash. Origin: #440 regression hunt; ties to issue A's markdown-only stopgap. Precedent: vscode#111162.

---

## D — `fix(undo): structured success/failure from undoLast instead of a message regex`

**Labels:** `tech-debt` · **Milestone:** _none_

> **Tamanho:** XS.

### Problema

The Cmd+Z toast adapter (`src/App.tsx`) picks the toast state with `/cannot undo/i.test(msg)`. A note literally named `cannot undo.md` would render a successful undo as an error toast. Cosmetic, but fragile.

### Solução

Have `undoLast` (and the future engine) pass the toast a structured kind — `toast(msg, 'success' | 'error')` — and use it directly. (Superseded if the Undo/Redo V2 engine lands first; create it there instead.)

### Acceptance Criteria

- [ ] Toast state comes from a structured kind, not a message-text regex.

### Referências

`src/lib/fileOpsHistory.ts` (`undoLast`), `src/App.tsx` (toast adapter).

---

---

# MILESTONE: `Undo/Redo V2`

Create this milestone, then create issues 1–6 under it. Full design in
`docs/specs/unified-undo-redo.md`. Key principle (validated against VSCode's real
source): **keep editor-text and file-op undo as separate timelines routed by
focus** — the upgrade is a proper file-op undo/redo _engine_ + redo + a focus
fix, NOT one unified timeline (the abandoned VSCode anti-pattern).

---

## 1 — `feat(undo): undo/redo engine — invertible command objects + past/future stacks`

**Labels:** `enhancement`, `trust` · **Milestone:** `Undo/Redo V2`

> **Tamanho:** S/M — new store + contract, unit-tested in isolation.

### Solução

Replace `fileOpsHistory`'s typed `FileOp` + `switch` with an engine (Zustand store):

- `UndoableOp` contract: `{ label, code, invert(): Promise<{ result, reapply: UndoableOp }> }` — symmetric, so undo and redo are the same operation applied alternately (mirrors VSCode `FileUndoRedoElement._reverse`).
- Dual stacks `past[]` / `future[]`; `push` appends to `past` and **clears `future`**; `undo` pops `past` → `invert` → pushes the returned `reapply` to `future`; `redo` does the inverse. Cap 20.
- `locked` flag during async `invert` (ignore re-entrant Cmd+Z); `reset()`; `canUndo()/canRedo()`.

### Acceptance Criteria

- [ ] Undo→redo→undo flips cleanly N times.
- [ ] `push` clears the redo stack.
- [ ] A second undo while one is in flight is ignored (lock).
- [ ] Unit tests cover push/undo/redo/clear-future/lock/reset.

### Referências

`docs/specs/unified-undo-redo.md` §3.1–3.2. VSCode: `undoRedoService.ts`, `bulkFileEdits.ts`.

---

## 2 — `feat(undo): migrate rename/move/trash to invertible command objects`

**Labels:** `enhancement`, `trust` · **Milestone:** `Undo/Redo V2`

> **Tamanho:** S — depends on #1.

### Solução

Express rename/move/trash as `UndoableOp`s (rename invert = swapped rename; move invert = rename back; trash invert = `snapshot:restoreOne`, reapply = re-capture + trash). Push at the op boundaries in `App.tsx` (replaces `fileOpsHistory.push`). Honor the markdown-only/size policy (issues A/C).

### Acceptance Criteria

- [ ] Rename/move/trash each push an invertible op; undo and redo both work.
- [ ] Trash reuses the U2 `_user` snapshot capture/restore.
- [ ] Integration tests for each op's undo↔redo.

### Referências

`docs/specs/unified-undo-redo.md` §3.1, §4.2. `src/App.tsx` handleCreate/handleDropMove/handleTrash, `electron/snapshot.ts`.

---

## 3 — `feat(shortcuts): redo + focus-routed priority chain with graceful fallback`

**Labels:** `enhancement`, `ux`, `non-tech-user` · **Milestone:** `Undo/Redo V2`

> **Tamanho:** S — depends on #1.

### Solução

Generalize `resolveUndoTarget` into a VSCode-style priority chain: editor-text-focus → editable input/textarea → file-tree (`canUndo`/`canRedo` → engine) → **fallback** (focus the editor and undo/redo its text — Cmd+Z is never a dead no-op). Bind **Cmd+Shift+Z** (Ctrl+Y on win/linux) for redo, routed through the same chain. Editor undo/redo stays in CodeMirror.

### Acceptance Criteria

- [ ] Cmd+Shift+Z redoes the last undone file op when the tree is focused; redoes editor text when the editor is focused.
- [ ] Cmd+Z with nothing to undo in-context falls through to editor undo (never dead).

### Referências

`docs/specs/unified-undo-redo.md` §3.3, §3.5. VSCode: `editorExtensions.ts`, `coreCommands.ts`, `files.contribution.ts` (MultiCommand priority chain).

---

## 4 — `feat(file-tree): keep focus on the tree after a file operation`

**Labels:** `enhancement`, `ux` · **Milestone:** `Undo/Redo V2`

> **Tamanho:** S.

### Problema

After a rename (inline input closes) or a context-menu op, focus leaves the tree, so Cmd+Z is a dead no-op until the user re-clicks — the friction that motivated V2.

### Solução

After a file-panel op completes, keep/return keyboard focus to the file tree (focus the affected row, or the tree container), matching VSCode's flow where the Explorer retains focus through a rename. Combined with #3's fallback, "rename → Cmd+Z" just works.

### Acceptance Criteria

- [ ] Renaming a file then pressing Cmd+Z undoes it without first clicking the tree.

### Referências

`docs/specs/unified-undo-redo.md` §3.4. `src/components/FileTree.tsx`, `src/App.tsx`.

---

## 5 — `feat(undo): invalidate the engine on vault switch and external change`

**Labels:** `enhancement`, `trust` · **Milestone:** `Undo/Redo V2`

> **Tamanho:** S.

### Solução

Flush the engine on vault switch (already done pointwise in `handlePickVault`) and when a path on the stack changes on disk externally (extend the `file:onChanged` handler), so a stale inverse is never applied. Surface invert failures as structured errors → error toast (removes the `/cannot undo/i` heuristic, supersedes issue D).

### Acceptance Criteria

- [ ] Switching vault clears the undo/redo stacks.
- [ ] An external change to a stacked path invalidates its entries (no stale undo).
- [ ] An invert failure shows an error toast via a structured kind, not a regex.

### Referências

`docs/specs/unified-undo-redo.md` §3.2, §3.5. `src/App.tsx` (handlePickVault, file:onChanged).

---

## 6 — `test(e2e): undo↔redo round-trips for file operations`

**Labels:** `enhancement` · **Milestone:** `Undo/Redo V2`

> **Tamanho:** S — depends on #1–#4.

### Solução

E2E covering rename→undo→redo, move→undo→redo, trash→undo→redo against the real filesystem. Note (per #151): rename/trash op-_triggers_ are native-context-menu-gated in Playwright; drive via the testable paths (drag-move is fully driveable; for rename/trash assert at the engine/IPC seam).

### Acceptance Criteria

- [ ] move→undo→redo restores then re-applies the move on disk.
- [ ] undo then redo then undo flips cleanly in e2e.
- [ ] No regression in `e2e/undo/` or `e2e/tab-switch-visibility.spec.ts`.

### Referências

`docs/specs/unified-undo-redo.md` §4.6. `e2e/undo/`, `e2e/tab-switch-visibility.spec.ts`.
