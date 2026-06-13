# Unified Undo/Redo engine — design

> **Status:** design / not yet implemented. Captured while the GitHub API was down; convert to a milestone + sub-issues when it recovers.
> **Motivation:** the Undo (Cmd+Z) — V1 milestone shipped file-ops undo, but (a) it has **no redo**, (b) undoing a rename requires the file tree to be focused (friction), and (c) the file-op stack is an ad-hoc typed list rather than a proper engine.
> **Reference:** Microsoft VSCode's `IUndoRedoService` + Explorer file-op undo (real source studied, see §2).

---

## 1. Problem with the V1 design

The milestone produced **two disjoint undo mechanisms**:

- **Editor text undo** — CodeMirror 6's built-in `history()` (per document). Cmd+Z / Cmd+Shift+Z work natively when the editor is focused.
- **File-ops undo** — an in-memory FIFO stack (`src/lib/fileOpsHistory.ts`) of typed `FileOp` entries (rename/move/trash), reversed by `undoLast(toast)`. Routed via `getActivePanelContext()` (U4): file-tree focus → `undoLast`.

Concrete gaps:

1. **No redo for file ops.** `fileOpsHistory` only pops; there is no future/redo stack. Cmd+Shift+Z is editor-only.
2. **Focus friction.** File-op undo only fires when the file tree is focused. After a rename (inline input closes, or a native context-menu action) focus is usually *not* on a tree button, so Cmd+Z is a dead no-op until the user clicks the tree.
3. **Ad-hoc reversal.** `undoLast` is a `switch (op.kind)` that hard-codes each inverse and re-pushes on failure. It does not generalize to redo, and there is no locking against a double-Cmd+Z racing an async IPC round-trip, nor invalidation when the underlying file changes.

## 2. What VSCode actually does (and the surprise)

We assumed the fix was "one unified timeline for text + file ops." **VSCode does the opposite — and arrived there deliberately.**

- **Separate stacks, routed by focus.** Editor text undo lives on the text model's stack; file-op undo lives on a dedicated `UndoRedoSource` (`UNDO_REDO_SOURCE`). They never intermix. Cmd+Z chooses between them by focus. VSCode *removed* a more-global file undo because users complained Cmd+Z **ate their text edits** (vscode#113653, #111630). So our focus-routing instinct matches the validated design — and, notably, **undoing a rename in VSCode also requires the Explorer to be focused.**
- **One `undo` command, a priority chain of implementations** (`MultiCommand`): `10000` editor-with-text-focus → `1000` editable `<input>`/`<textarea>` → **`110` explorer** (`explorerService.hasViewFocus() && undoRedoService.canUndo(UNDO_REDO_SOURCE)`) → `0` fallback (focus the active editor and undo its text). **Cmd+Z is never a dead no-op** — it degrades to editor undo.
- **Dual stacks per resource.** Each `ResourceEditStack` has `_past[]` (undo) and `_future[]` (redo). `undo()` moves an element past→future; `redo()` moves it future→past; **a new `pushElement()` destroys `_future`.** Redo is a free byproduct of this shape.
- **Undo elements are invertible command objects.** `FileUndoRedoElement.undo()` and `.redo()` both call a symmetric `_reverse()` that **re-performs each operation and stores the new inverse in place** — rename↔reverse-rename, create↔delete flip cleanly any number of times. `undo()/redo()` return `Promise<void> | void` (async-friendly for IPC).
- **Delete is undoable via a content snapshot taken before the delete** (exactly our U2 approach), with a `MAX_UNDO_FILE_SIZE = 5MB` cap above which content is *not* snapshotted (root of vscode#111162 "undo leaves files empty"). OS trash is an orthogonal axis.

**Conclusion:** keep focus-routing (don't unify the timelines — that's the abandoned anti-pattern). The real upgrade is a proper **undo/redo engine for file ops** (command objects + past/future + redo + locking + invalidation) plus fixing the focus friction.

## 3. Proposed design

### 3.1 Command-object contract

Replace the typed `FileOp` + `switch` with invertible command objects:

```ts
type UndoResult = { ok: true } | { ok: false; message: string }

interface UndoableOp {
  /** User-facing, e.g. "rename note.md", "delete draft.md". */
  label: string
  /** Machine code for grouping/telemetry, e.g. 'fileops.rename'. */
  code: string
  /** Apply the inverse. Async (IPC). Returns the NEW op to push on the opposite
   *  stack (the inverse-of-the-inverse), mirroring VSCode's symmetric _reverse. */
  invert(): Promise<{ result: UndoResult; reapply: UndoableOp }>
}
```

- `rename` invert → a rename op with swapped paths.
- `move` invert → a rename op back to the original parent.
- `trash` invert → a `restore` op via `snapshot:restoreOne(snapshotId)`; the re-apply is a fresh `trash` (re-capture + trash).
- Symmetric design means **undo and redo are the same operation** applied alternately — no separate redo logic.

### 3.2 Engine (Zustand store, replaces `fileOpsHistory`)

```ts
interface UndoRedoEngineState {
  past: UndoableOp[]        // available to undo (newest at end)
  future: UndoableOp[]      // available to redo
  locked: boolean           // true while an async invert is in flight
  push(op: UndoableOp): void          // append to past; clears future
  undo(notify: Notify): Promise<void> // pop past → invert → push reapply to future
  redo(notify: Notify): Promise<void> // pop future → invert → push reapply to past
  reset(): void                        // vault switch / external invalidation
  canUndo(): boolean
  canRedo(): boolean
}
```

- **`push` clears `future`** (VSCode rule). Cap retained at 20 entries (existing behavior).
- **Locking:** `undo`/`redo` set `locked = true` for the duration of the async invert so a fast double-Cmd+Z can't interleave a half-applied rename. A second invocation while locked is ignored.
- **On invert failure** (target moved, snapshot gone): do **not** move the entry to the other stack; surface a structured failure (`{ ok:false, message }`) so the toast shows an error — fixes the current `/cannot undo/i` regex heuristic too.
- **Invalidation/flush:** `reset()` on vault switch (already added pointwise in `handlePickVault`); also flush when a path on the stack changes on disk externally (extend the existing `file:onChanged` handler) so we never apply a stale inverse.

### 3.3 Routing — keep focus-based, add a graceful fallback chain

Generalize `resolveUndoTarget` into a small priority chain mirroring VSCode's `MultiCommand`:

1. **editor text-focus** → let CodeMirror handle (don't preventDefault) — undo *and* redo.
2. **editable `<input>`/`<textarea>`** → let it handle its own undo (the inline rename guard, already added).
3. **file tree focus** (`canUndo`/`canRedo`) → engine `undo`/`redo`.
4. **fallback** → if nothing above handled it and an editor exists, focus it and undo/redo its text (never a dead no-op).

Editor undo/redo stays in CodeMirror (`historyKeymap`) — we do **not** wrap CM transactions into the engine (that's the timeline-unification trap VSCode warns against).

### 3.4 Fix the friction the VSCode way

After a file-panel operation completes, **keep/return focus to the file tree** (focus the affected row, or the tree container) so "do a file op → Cmd+Z" works without re-clicking — matching VSCode's flow where the Explorer retains focus through a rename. Combined with the graceful fallback (§3.3.4), Cmd+Z stops feeling dead.

### 3.5 Redo wiring

- Bind **Cmd+Shift+Z** (and Ctrl+Y on Linux/Windows) in the global keydown handler, routed through the same chain → engine `redo` when the tree is focused, CodeMirror redo when the editor is focused.
- The native Edit-menu already has `redo`; keep it consistent.

## 4. Milestone breakdown (sub-issues, each S where possible)

1. **Engine** — `UndoableOp` contract + `undoRedoEngine` store (past/future, push-clears-future, lock, canUndo/canRedo, reset). Unit-tested in isolation.
2. **Migrate file ops to command objects** — rename/move/trash as `UndoableOp`s (trash reuses U2 `snapshot:capture`/`restoreOne`; honor the markdown-only / size policy from the regression fix). Wire push at the op boundaries (replaces the current `fileOpsHistory.push`).
3. **Redo + routing chain** — generalize `resolveUndoTarget` into the priority chain with graceful fallback; bind Cmd+Shift+Z; route both undo and redo.
4. **Focus retention** — file ops keep/return focus to the tree.
5. **Invalidation** — flush the engine on vault switch (done) + external file change; structured failure → error toast (removes the `/cannot undo/i` heuristic).
6. **E2E** — undo↔redo round-trips: rename→undo→redo; move→undo→redo; trash→undo→redo (real FS). Note rename/trash op-*triggers* are native-context-menu-gated in Playwright (see #151); drive via the testable paths.

## 5. Acceptance criteria

- [ ] Cmd+Shift+Z redoes the last undone file op (rename/move/trash), restoring the redone state on disk.
- [ ] Undo then redo then undo flips cleanly N times (symmetric command objects).
- [ ] "Rename a file, press Cmd+Z" works without first clicking the tree (focus retention) and never a dead no-op (graceful fallback).
- [ ] A double Cmd+Z during an in-flight async undo does not corrupt state (lock).
- [ ] Switching vault (and an external change to a stacked path) flushes the engine; no stale-path undo.
- [ ] Editor text undo/redo is unchanged (still CodeMirror; not routed through the engine).
- [ ] No regression in the V1 e2e (`e2e/undo/`).

## 6. Out of scope / non-goals

- **One unified timeline for text + file ops** — deliberately rejected (VSCode's abandoned anti-pattern; ate text edits). Timelines stay separate, routed by focus.
- **Binary/large-file trash-undo** — tracked separately (make snapshots Buffer-based + a size policy); the engine should treat a non-undoable delete as "no op pushed", like the current markdown-only guard.
- **Multi-resource (workspace) atomic edits** and VSCode's `split()`/URI-comparison-key machinery — not needed for a note app; if a participating note is invalidated, flush rather than split.

## 7. References

- VSCode core: `src/vs/platform/undoRedo/common/undoRedo.ts`, `undoRedoService.ts` (IUndoRedoElement, dual past/future stacks).
- VSCode file ops: `src/vs/workbench/contrib/bulkEdit/browser/bulkFileEdits.ts` (`FileUndoRedoElement`, symmetric `_reverse`, snapshot-before-delete, `MAX_UNDO_FILE_SIZE`).
- VSCode routing: `src/vs/editor/browser/editorExtensions.ts` (`UndoCommand`/`RedoCommand` MultiCommand), `coreCommands.ts` (priority impls), `files.contribution.ts` (explorer impl @ priority 110, `UNDO_REDO_SOURCE`).
- Our V1: `src/lib/fileOpsHistory.ts`, `src/lib/panelContext.ts`, `src/App.tsx` (handleTrash/handleDropMove/keydown), `electron/snapshot.ts` (U2 `_user` bucket). Milestone: Undo (Cmd+Z) — V1 (#4), PRs #442/#444/#446/#447/#448.
