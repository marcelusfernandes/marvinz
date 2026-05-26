# Bug: "_manifest.json" surfaced in version history with "Invalid file path"

**Status:** Open — documented, not yet fixed
**Reported:** 2026-05-25
**Severity:** Medium — no data loss, but the snapshot/versions feature is partially broken: it shows a confusing toast and a dead-end "Invalid file path." panel for newly-created files. It also pollutes the turn manifest with bookkeeping noise.

## Summary

When the embedded agent creates a new file via the PTY (e.g. `testev3.md`), the
snapshot system's own internal bookkeeping file — `_manifest.json`, which lives
inside `.marvin/snapshots/<turnId>/` — leaks into the turn's user-facing
"modified files" list. The end-of-turn toast then reports "Claude modified
_manifest.json" instead of the real file, and clicking "View versions" opens a
SnapshotPanel that immediately fails with **"Invalid file path."** because the
IPC layer explicitly refuses any path under `.marvin/`. The two symptoms are the
same root leak surfacing in two places.

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

### 1. The watcher does not exclude `.marvin/` subtree files from snapshotting

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

`NOISY_DIRS` includes `.marvin` (`electron/main.ts:418-421`), so a path whose
basename is exactly `.marvin` is ignored. But for a deep file the basename is
`_manifest.json` — which is **not** in `NOISY_DIRS`/`NOISY_FILES`, so the
predicate returns `false` and the watcher fires `change` for
`.marvin/snapshots/<turnId>/_manifest.json` (created/updated by `writeManifest`
in `electron/snapshot.ts:127-131`). The `.marvin` directory is created fresh on
the agent's first write of a turn, and `_manifest.json` writes inside it are
observed as ordinary vault changes.

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
null bytes, `..`, and absolute paths. It does **not** reject `.marvin/...`. So
`_manifest.json`'s own relPath is appended as a `ManifestEntry` into the turn's
`files` array (`electron/snapshot.ts:202-211`).

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

When "View versions" is clicked (`src/App.tsx:1725-1731`), `openSnapshotPanel`
opens the panel with `relPath = .marvin/snapshots/<turnId>/_manifest.json`. The
panel calls `window.marvin.snapshot.listForFile(relPath)`
(`src/components/SnapshotPanel.tsx:47`), which routes to the IPC handler
`snapshot:listForFile` (`electron/main.ts:1354-1363`). That handler calls
`validateRelPath` (`electron/main.ts:1299-1311`), whose **L5 guard explicitly
rejects `.marvin/` paths**:

```ts
if (normalized === MARVIN_DIR_PREFIX || normalized.startsWith(MARVIN_DIR_PREFIX + path.sep)) {
  throw new Error('SNAPSHOT_INVALID_REL_PATH')   // electron/main.ts:1307-1308
}
```

`SNAPSHOT_INVALID_REL_PATH` is mapped to the user-facing string **"Invalid file
path."** in `src/components/SnapshotPanel.tsx:279` (and `MARVIN_INVALID_PATH` →
same string at line 285). That is exactly the red error box shown in the list
pane (`src/components/SnapshotPanel.tsx:178-180`). (Symptom b.)

### Root cause, stated plainly

The `.marvin/` exclusion exists at the IPC read boundary (`validateRelPath`,
`electron/main.ts:1307`) but is **missing from the write/watch path** that
populates manifests (`snapshotExternalChange` at `electron/main.ts:495-525`,
`assertRelPath` at `electron/snapshot.ts:61-68`) and from the watcher ignore
predicate (basename-only, `electron/main.ts:478-480`). The result is that the
snapshot system records and advertises its own `_manifest.json`, then refuses to
open it.

## Suggested fix direction (non-binding — do not implement)

Any one of these would break the chain; defense-in-depth would apply more than
one:

- **Exclude `.marvin/` in `snapshotExternalChange`** (`electron/main.ts:495-525`):
  bail out early when the changed path is inside `.marvin/` so the snapshot
  system never snapshots its own bookkeeping. This is the most targeted fix.
- **Make the watcher ignore the whole `.marvin/` subtree, not just the basename**
  (`electron/main.ts:478-480`): test the path against a `.marvin/` segment (e.g.
  `p.split(path.sep).includes('.marvin')` or a relative-prefix check) instead of
  `path.basename(p)`. This stops the `_manifest.json` `change` event at the source.
- **Filter the turn's user-facing file list** in `finalizeTurn`
  (`electron/main.ts:98`): drop any `relPath` starting with `.marvin/` (and/or
  the `_manifest.json` bookkeeping name) before sending `snapshot:turn-completed`,
  so the toast can never name an internal file.
- **Reject `.marvin/` in `assertRelPath`** (`electron/snapshot.ts:61-68`) to match
  the IPC-layer `validateRelPath` guard, so `writeSnapshot` consistently refuses
  bookkeeping paths everywhere.

Note: the IPC read guard (`validateRelPath`, `electron/main.ts:1307`) is working
as intended for security (L5) — the fix belongs on the write/watch side, not by
loosening that guard.
