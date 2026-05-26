# Bug: internal files (`_manifest.json`, `.obsidian/workspace.json`) surfaced in version history with "Invalid file path"

**Status:** Open — documented + verified by review squad (2026-05-26), not yet fixed
**Reported:** 2026-05-25
**Verified:** 2026-05-26 — confirmed live by runtime logs (149 watcher cache-miss
lines) and a three-way code/mechanism review. The original diagnosis was correct
in effect but imprecise on the *why*; this revision corrects it (macOS fsevents
backend + a basename-only watcher predicate) and adds a second affected file class.
**Severity:** Medium — no data loss, but the snapshot/versions feature is partially broken: it shows a confusing toast and a dead-end "Invalid file path." panel for newly-created files. It also pollutes the turn manifest with bookkeeping noise.

## Summary

When the embedded agent creates a new file via the PTY (e.g. `testev3.md`), the
vault file watcher snapshots internal/tool files that happen to change during the
turn and leaks them into the turn's user-facing "modified files" list. Two classes
are confirmed:

1. **`.marvin/snapshots/<turnId>/_manifest.json`** — the snapshot system's own
   bookkeeping file. The end-of-turn toast reports "Claude modified _manifest.json",
   and clicking "View versions" fails with **"Invalid file path."** because the IPC
   layer explicitly refuses any path under `.marvin/`.
2. **`.obsidian/workspace.json`** — Obsidian's internal workspace-state file (this
   is the "workflow.json" originally reported by the user; Obsidian rewrites it as
   you navigate). `.obsidian` is **not** in `NOISY_DIRS`, so it leaks via the same
   watcher path. "View versions" on it does *not* dead-end (the `.marvin/` guard
   doesn't apply) but shows wrong/empty history — still noise the user never authored.

Both classes share one root: a basename-only watcher predicate that, under the
macOS fsevents backend, fails to prune deep files inside ignored directories.

## Repro steps

1. Open a vault and start the embedded agent (Claude Code) in the agent terminal.
2. Ask the agent to create a new file at the vault root, e.g.
   "cria um arquivo .md testev3 na raiz do projeto".
3. After the turn ends, observe the bottom-right toast: **"Claude modified
   _manifest.json"** with a "View versions" button.
4. Click **View versions**. The SnapshotPanel opens titled "Versions of
   _manifest.json", with the subtitle path
   `.marvin/snapshots/20260526T023148Z-361d4e2921ad/_manifest.json`.
5. The versions list pane renders a red error box: **"Invalid file path."** and
   no versions appear. The panel is unusable.

## Expected vs actual

- **Expected:** The toast and versions panel reference the actual file the user
  created (e.g. `testev3.md`). The snapshot system's internal `_manifest.json`
  bookkeeping file is never presented to the user as a "modified file" and never
  reaches the versions UI.
- **Actual:** `_manifest.json` (path `.marvin/snapshots/<turnId>/_manifest.json`)
  is reported as the modified file. Opening its versions fails with "Invalid
  file path." because that path is inside `.marvin/` and is not a real vault file
  with a version history.

## Investigation / suspected root cause

The bug is a **defense-layer inconsistency**: the IPC boundary refuses `.marvin/`
paths, but the watcher-driven snapshot path that *builds* the manifest does not.
So an internal `_manifest.json` write gets recorded as a user file, leaks into
the toast, and then trips the IPC guard when the panel tries to load its history.

### 1. The watcher predicate is basename-only and, under macOS fsevents, never prunes deep files

`electron/main.ts:477-484` — the chokidar watcher's `ignored` predicate matches
on **basename only**:

```ts
vaultWatcher = chokidar.watch(resolvedVault, {
  ignored: (p) => {
    const base = path.basename(p)
    return NOISY_DIRS.has(base) || NOISY_FILES.has(base)   // .marvin is a NOISY_DIR (line 419)
  },
  ...
})
```

**Why this leaks (corrected mechanism — verified against chokidar 3.6.0):** the
app runs on macOS, and `fsevents` is installed, so chokidar uses the **fsevents
backend** (`lib/fsevents-handler.js`), not the `lib/nodefs-handler.js` readdirp
traversal. fsevents watches the vault root **recursively at the kernel level** and
delivers an event for the **full deep path** of each change. chokidar filters each
event by running the `ignored` predicate on that full path via `anymatch`, which
for a *function* matcher calls it on the exact string with **no ancestor-segment
testing**. So for `.marvin/snapshots/<turnId>/_manifest.json` the predicate sees
`path.basename(p) === '_manifest.json'` ∉ `NOISY_DIRS`/`NOISY_FILES` → returns
`false` → the event is emitted. The `.marvin` directory node itself *is* ignored,
but that does not prune its children under fsevents. (On a non-fsevents/polling
backend, `filterDir` would prune the `.marvin` subtree during traversal — which is
why a purely static read of `nodefs-handler.js` wrongly concludes the path is dead.)

Runtime confirmation: the live dev-server log shows **149** occurrences of
`[snapshot] watcher cache miss — reading from disk` (emitted at
`electron/main.ts:507`, *inside* `snapshotExternalChange`, past its guards) with
relPaths including both `.marvin/snapshots/<turnId>/_manifest.json` and
`.obsidian/workspace.json`.

**add vs change nuance:** `addOrChange` emits `change` only when the directory is
already watched and the file already known; the **first** `writeManifest` of a
turn fires `add` (and the `add` handler at `main.ts:528-531` does **not** call
`snapshotExternalChange`, so no leak), while **subsequent** writes fire `change`
→ leak. Concrete triggers for a single-file turn: (a) `completeTurn`'s final
`writeManifest` (`electron/snapshot.ts:239`), (b) the watcher's own second
`writeSnapshot` for the user file re-writing the manifest.

**`.obsidian/workspace.json` (the reported "workflow.json"):** `.obsidian` is
**not** in `NOISY_DIRS` (`electron/main.ts:418-421` contains only `.git`,
`node_modules`, `.DS_Store`, `.svn`, `.hg`, `.idea`, `.marvin`, `.next`, `dist`,
`build`, `out`, `target`, `.turbo`, `.cache`), so even its directory node is never
a pruning candidate. Obsidian rewrites `workspace.json` during navigation; those
writes leak via the identical path.

**Broader implication:** because the predicate is basename-only, under fsevents
*no* `NOISY_DIRS` subtree is truly pruned — deep files in `.git/`, `node_modules/`,
`dist/`, etc. would also pass the filter. They rarely surface only because
`ignoreInitial: true` suppresses pre-existing files and those dirs are seldom
written during an AI turn. `.marvin/` and `.obsidian/` surface precisely because
they *are* written during/around turns.

### 2. `snapshotExternalChange` snapshots the manifest as if it were a user file

`electron/main.ts:532-538` (watcher `change` handler) calls
`snapshotExternalChange(p)`. Inside `snapshotExternalChange`
(`electron/main.ts:495-525`):

- The only path guard (line 497) is `filePath === activeVaultPath ||
  filePath.startsWith(activeVaultPath + path.sep)` — i.e. "is this inside the
  vault?". `.marvin/...` paths **are** inside the vault, so they pass.
- There is **no `.marvin` exclusion** here. The path is converted to a relPath
  (`const relPath = path.relative(activeVaultPath, filePath)` → line 500, giving
  `.marvin/snapshots/<turnId>/_manifest.json`) and passed to `writeSnapshot`
  (line 514).

### 3. `writeSnapshot` / `assertRelPath` also do not block `.marvin/`

`electron/snapshot.ts:177-228` (`writeSnapshot`) validates the relPath via
`assertRelPath` (`electron/snapshot.ts:61-68`), which only rejects empty strings,
null bytes, `..`, and absolute paths. It does **not** reject `.marvin/...` (nor
`.obsidian/...`). So the internal relPath is appended as a `ManifestEntry` into the
turn's `files` array (`electron/snapshot.ts:203-222` — entry built at 203-207,
manifest written via `writeManifest` at 222).

### 4. The leaked entry surfaces in the end-of-turn toast

`finalizeTurn` (`electron/main.ts:89-104`) builds the turn-completed event file
list directly from the manifest with no filtering:

```ts
files: manifest.files.map((f) => f.relPath),   // electron/main.ts:98
```

That now contains `.marvin/snapshots/<turnId>/_manifest.json`. The renderer's
`onTurnCompleted` handler (`src/App.tsx:406-413`) sets `turnToast` from
`event.files`, and `SnapshotToast` (`src/components/SnapshotToast.tsx:65-75`)
shows the basename → "**Claude modified _manifest.json**". (Symptom a.)

### 5. Opening versions hits the IPC `.marvin/` guard → "Invalid file path."

When "View versions" is clicked (toast JSX block at `src/App.tsx:1715-1726`; the
`openSnapshotPanel` call is at line 1722), `openSnapshotPanel` opens the panel with
`relPath = .marvin/snapshots/<turnId>/_manifest.json`. The panel calls
`window.marvin.snapshot.listForFile(relPath)`
(`src/components/SnapshotPanel.tsx:47`), which routes to the IPC handler
`snapshot:listForFile` (`electron/main.ts:1367-1376`). That handler calls
`validateRelPath` (`electron/main.ts:1312-1324`), whose **L5 guard explicitly
rejects `.marvin/` paths** (lines 1319-1322; `MARVIN_DIR_PREFIX = '.marvin'` const
at line 1310):

```ts
if (normalized === MARVIN_DIR_PREFIX || normalized.startsWith(MARVIN_DIR_PREFIX + path.sep)) {
  throw new Error('SNAPSHOT_INVALID_REL_PATH')   // electron/main.ts:1319-1322
}
```

`SNAPSHOT_INVALID_REL_PATH` is mapped to the user-facing string **"Invalid file
path."** in `src/components/SnapshotPanel.tsx:279` (and `MARVIN_INVALID_PATH` →
same string at line 285). That is exactly the red error box shown in the list
pane (`src/components/SnapshotPanel.tsx:178-180`). (Symptom b.)

Note this guard only fires for `.marvin/` paths. The `.obsidian/workspace.json`
leak (Symptom from the user's "workflow.json") does **not** hit it — its
"View versions" opens but shows wrong/empty history instead of erroring.

### Root cause, stated plainly

The watcher ignore predicate (`electron/main.ts:478-480`) is **basename-only**, so
under the macOS fsevents backend it never prunes deep files inside ignored
directories. Internal files written during a turn — `.marvin/.../_manifest.json`
and `.obsidian/workspace.json` (the latter not even in `NOISY_DIRS`) — therefore
reach `snapshotExternalChange`, get recorded into `manifest.files`, and are
advertised in the turn-completed toast. The `.marvin/` exclusion that *does* exist
at the IPC read boundary (`validateRelPath`, `electron/main.ts:1319-1322`) is
missing from the write/watch path (`snapshotExternalChange` at
`electron/main.ts:495-525`, `assertRelPath` at `electron/snapshot.ts:61-68`) and
from the watcher predicate — so the snapshot system records and advertises its own
`_manifest.json`, then refuses to open it. `.obsidian/workspace.json` leaks the same
way but isn't caught by the read guard (it's not under `.marvin/`).

## Suggested fix direction (non-binding — do not implement)

Because the leak now covers two classes (`.marvin/` AND `.obsidian/`), a
`.marvin/`-only fix is insufficient on its own. Recommended combination:

- **PRIMARY — fix the watcher predicate to test path segments, generalized to all
  `NOISY_DIRS`** (`electron/main.ts:478-480`): replace the basename-only check with
  e.g. `p.split(path.sep).some(seg => NOISY_DIRS.has(seg)) || NOISY_FILES.has(base)`,
  and **add `.obsidian`** (and likely `.logseq`, `.vscode`) to `NOISY_DIRS`. This
  stops the events at the source for both classes and prevents the wasteful snapshot
  writes (the 149 disk reads). Verified to have **no side effects**: snapshot-restore
  reload does not use the watcher (it goes through `fileContentCache.delete` +
  `notifyTree`, `main.ts:1398-1399`, and `onRestored → readFreshContent`,
  `src/App.tsx:533`), and real user files are never under `NOISY_DIRS`.
- **DEFENSE-IN-DEPTH — reject `.marvin/` in `assertRelPath`** (`electron/snapshot.ts:61-68`)
  to mirror the IPC `validateRelPath` guard across all 8 `writeSnapshot` callers
  (including `electron/approval-socket.ts:104`, which guards `..`/absolute but lacks
  a `.marvin/` guard). Note: this covers `.marvin/` only — it does **not** block
  `.obsidian/workspace.json`, so it cannot fully fix the user's repro alone.
- **TOAST HYGIENE — filter the turn's file list in `finalizeTurn`**
  (`electron/main.ts:98`): drop any `relPath` whose path has a `NOISY_DIRS` segment
  before sending `snapshot:turn-completed`, so even a stray snapshot can never name
  an internal file. Catches both classes at the symptom level.
- **(Superseded) Exclude `.marvin/` in `snapshotExternalChange`** (`main.ts:495-525`):
  effective for `.marvin/` on the live path but doesn't cover `.obsidian/`; the
  generalized predicate fix above is strictly better.

Note: the IPC read guard (`validateRelPath`, `electron/main.ts:1319-1322`) is working
as intended for security (L5) — the fix belongs on the write/watch side, not by
loosening that guard.

## Regression-test assertions (from QA verification — for when the fix lands)

- `snapshotExternalChange` with a path under any `NOISY_DIRS` segment (e.g.
  `.marvin/...`, `.obsidian/workspace.json`) must NOT call `writeSnapshot`.
- After an agent turn that creates `testev3.md`, `listTurns` returns a manifest whose
  `files` contains `testev3.md` and **zero** entries with a `NOISY_DIRS` segment.
- The `snapshot:turn-completed` event `files` list excludes all internal paths.
- "View versions" on `testev3.md` succeeds (no `SNAPSHOT_INVALID_REL_PATH`).
- Non-regression: `validateRelPath` still rejects `.marvin/...` via IPC (guard
  unchanged); a real user file legitimately named `workflow.json` at the vault root
  is NOT filtered (filtering must be path-segment-based, never name-based).
- Existing tests to extend: `electron/__tests__/snapshot.spec.ts` (`writeSnapshot`,
  `security: expanded relPath validation`, `watcher cache-less snapshot`); add an
  E2E in `e2e/` for the toast content + "View versions" golden path.
