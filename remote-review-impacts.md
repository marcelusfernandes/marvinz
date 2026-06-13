# Marvin — Review Fix Impact Analysis

Companion to `remote-review.md`. Each cluster groups findings that share a
surface area or fix vector, so they should be batched into a single GitHub
issue (or, when too big, a milestone). The maintainer can use this to scope
each issue before opening it.

## TL;DR

- **10 clusters** identified across security, correctness, UX, IPC design,
  a11y, DX, perf, and docs. Two require **milestone decomposition** (Cluster
  1 — IPC lockdown; Cluster 8 — App.tsx + tsconfig strict); the other eight
  are single-issue scope (S or M).
- **Top priority is Cluster 1 (IPC validation + Electron hardening)**. Three
  of its findings are concrete privilege-escalation paths and the patterns to
  copy already exist in-repo (`validateTurnId`, `requireAgentRequest`,
  `assertInsideVaultAsync`). Effort is M but risk is medium — CSP and
  will-navigate can break dev-server / link flows on first try.
- **Cluster 4 (autosave + state lifecycle)** has the highest user-trust
  payoff for the smallest diff — three small renderer-side fixes that close
  data-loss windows. Should ship as a single PR, not split.
- **Cluster 2 (markdown link rewriter)** sounds small but switching the
  regex for a `marked` lexer walk has wide blast radius — every rename
  touches it, and we have no fixture-level tests. It is the riskiest
  cluster after Cluster 1.
- **Sequencing matters in two places**: (a) Cluster 1's shared
  `validateScalar`/`narrowKeys` helpers should land before Cluster 7's
  `pty:write` byte cap so the cap can reuse the helper; (b) the
  `assertInVault` addition for `file:exportPdf` in Cluster 1 must precede
  any work in Cluster 5 (atomic-write / watcher robustness) that may
  exercise the same handler.

---

## Sequencing recommendation

1. **Cluster 1 — IPC lockdown + Electron defaults (M, milestone).**
   Privilege escalation paths. Land before anything else touches `main.ts`.
2. **Cluster 4 — Renderer state lifecycle (S).** Independent of Cluster 1,
   fast user-trust win; can ship in parallel.
3. **Cluster 7 — IPC argument validation pass (S).** Builds on the
   helper introduced in Cluster 1.
4. **Cluster 2 — Markdown link rewriter robustness (M).** Touches a
   different surface from Cluster 1; can run in parallel with 4 and 7.
5. **Cluster 5 — Watcher / fsevents robustness + AI-active flag (M).**
   Depends on understanding clusters 2 and 4 (file:changed pipeline).
6. **Cluster 3 — README + docs drift (S).** No code coupling; punt to a
   docs-only PR anytime.
7. **Cluster 6 — A11y (FileTree roving-tabindex, focus trap, etc.) (M).**
   Independent. Doesn't touch `main.ts`.
8. **Cluster 9 — Perf coalescing (debounce vault:changed, throttle
   Splitter, memoize flattenVisibleTree) (S).** Independent.
9. **Cluster 10 — Design-token compliance audit (M).** Mechanical, can run
   any time but should follow Cluster 6 to avoid touching the same CSS
   twice.
10. **Cluster 8 — Strict TS + App.tsx decomposition (L, milestone).** Last
    because it touches everything and depends on the corrected state
    machine from Cluster 4.

---

## Cluster 1: IPC lockdown + Electron security defaults

Single cluster because all six findings share one mental model: "anything a
compromised renderer can call must validate inputs and the BrowserWindow
must enforce a CSP/origin/scheme boundary." The fixes share helpers and
should be reviewed together.

- **Findings included:**
  - 🔴 `settings:set` unscoped k/v store, persists `vaultPath` and bypasses
    allowlist on next launch (`electron/main.ts:430`, `:359`)
  - 🔴 `file:exportPdf` does not call `assertInVault` and writes temp HTML
    next to source (`electron/main.ts:905`–`:951`)
  - 🟠 No CSP anywhere (`electron/main.ts:227`–`:247`, `index.html:1`–`:13`)
  - 🟠 `setWindowOpenHandler` doesn't validate scheme on main window
    (`electron/main.ts:256`) or browser tab views (`:1196`)
  - 🟠 No `will-navigate` guard on main `BrowserWindow`
    (`electron/main.ts:226`–`:264`)
  - 🟠 Main `BrowserWindow.webPreferences` is missing `sandbox: true`
    (`electron/main.ts:242`–`:246`)

- **Surfaces touched:**
  - `electron/main.ts`: `settings:set` handler (430), bootstrap settings
    reader (359–372), `file:exportPdf` handler (905–951),
    `createWindow()` (226–264) including `webPreferences` and
    `setWindowOpenHandler`, browser-view `setWindowOpenHandler` (1196).
  - `electron/preload.ts`: narrow the `settings.set` payload type to a
    `SettableKey` union (39–42).
  - `index.html` (root): add `<meta http-equiv="Content-Security-Policy">`.
  - New shared helper `electron/safe-external.ts` (or co-located) for
    `SAFE_EXT_RE` reused by `setWindowOpenHandler` and `shell:openExternal`
    (today the regex only exists at `electron/main.ts:438`).
  - `electron/__tests__/export-pdf.spec.ts` mirrors the handler logic and
    will need to be updated to expect `assertInVault` and `app.getPath('temp')`-based temp file location (its mirror currently writes
    into `path.dirname(filePath)` — see lines 56–101).

- **Downstream dependencies:**
  - **Settings shape**: `Settings` type lives in `src/types.ts:71` and is
    duplicated in `electron/preload.ts:29`. `settingsStore.ts` reads from
    localStorage with explicit per-key parsing (lines 11–39) — already
    safe. The only producer is `settingsStore.setSetting` (line 80) which
    sends one key at a time — `iconTheme | colorTheme | visualStyle | terminalModeEnabled | saveMode`. **No code calls `settings.set({ vaultPath })` directly today** (grep verified) — `vaultPath` is only
    written via the `vault:pick` handler at `main.ts:458`. So narrowing
    `settings:set` to reject `vaultPath` will not break any caller.
  - **Bootstrap settings reader at `main.ts:359`** auto-adds
    `settings.vaultPath` to `allowedVaultPaths`. After the fix this stays
    correct because legitimate `vaultPath` is still set via `vault:pick`,
    which writes a freshly user-confirmed path.
  - **`file:exportPdf` callers**: single call site at `src/components/Editor.tsx:683`. After the fix, calling on a file outside the vault
    throws — Editor already has a `.catch(err => console.error(...))` so
    no UI break, but the user gets no feedback. Worth piping to the same
    `reportError` channel as other handlers.
  - **CSP**: changes the renderer's origin behavior. Specifically the
    `connect-src` must allow `http://localhost:*` and `ws://localhost:*`
    in dev, plus the proposed `marvin:` for the protocol handler. Both
    Milkdown and CodeMirror inline-style heavily (we'd need
    `style-src 'self' 'unsafe-inline'` initially), and `dompurify` /
    `marked` produce HTML that ends up in renderer DOM — already covered
    by `script-src 'self'`.
  - **`will-navigate`** breaks the implicit fallback where any internal
    `<a href>` would navigate the renderer. The renderer must consistently
    use `shell.openExternal` (it already does for most cases — see the
    `editor:openExternal` IPC; verify no raw `<a href>` exists in app
    chrome). `react-markdown` and Milkdown render anchors in the preview
    — those need to be intercepted, but most already are: `Editor.tsx`
    has `handleLinkClick`. Verify nothing falls through.
  - **`sandbox: true`** is in theory a no-op given the preload only uses
    safe APIs, but it disables Node `require` in the preload (currently
    works because preload uses ESM `import` for `contextBridge`,
    `ipcRenderer`, `webUtils` — all sandbox-safe).

- **User-facing behavior change:**
  - `settings:set`: none expected. Renderer never sends `vaultPath` today.
  - `file:exportPdf`: temp HTML moves from vault to `app.getPath('temp')` —
    invisible to users (was `._marvinz_export_*.html` already prefixed
    hidden).
  - CSP: if too tight, breaks Milkdown styling on first load. Mitigate by
    starting permissive (the review suggests `'unsafe-inline'` for styles
    first, tighten later).
  - `will-navigate`: if any chrome link relied on `target=_blank`, it
    breaks. Unlikely given `setWindowOpenHandler` already intercepts.
  - `sandbox: true`: no user-visible change if preload is clean.
  - `setWindowOpenHandler` scheme guard: clicking a `file://` URL no
    longer opens — users will be confused if any in-app feature emits
    `file://` URLs. None found; the markdown preview rewrites internal
    paths to `marvin://` already.

- **Data migration:** None. `settings.json` keeps its current shape;
  existing `vaultPath` keys are preserved (just no longer writable from
  the renderer).

- **Test coverage today:**
  - `electron/__tests__/marvin-protocol.spec.ts`, `boundary.spec.ts`,
    `vault-allowlist.spec.ts`, `export-pdf.spec.ts` exist. The export-pdf
    test mirrors the handler logic (does not import from `main.ts` —
    handler is not exported) so adding `assertInVault` requires updating
    the mirror in the test file.
  - **No tests on `settings:set`**, `setWindowOpenHandler`, CSP,
    `will-navigate`. New tests can be added as standalone unit tests if
    the helpers (`narrowSettings`, `SAFE_EXT_RE`) are factored out.
  - Project test runner: vitest. Single command: `npm test`.

- **Likely breakages:**
  1. CSP `connect-src` too strict → breaks Vite HMR (websocket to
     `ws://localhost:5173`). Mitigate by branching CSP for dev vs prod or
     by allowing `ws://localhost:*`.
  2. CSP `script-src 'self'` → breaks any feature that inlines a
     `<script>` (none currently, but Editor / Milkdown may inject inline
     event handlers — needs verification before merging).
  3. `will-navigate` rejecting all but `http://localhost:5173` (dev) →
     breaks any in-renderer `<a href>` click. The renderer should
     `e.preventDefault` and use `marvin.shell.openExternal`.
  4. `sandbox: true` breaks preload if any `require('fs')`-style
     statement was hiding in a transitive import (none in
     `electron/preload.ts:1–7`; safe).
  5. Tightening `setWindowOpenHandler` rejects `mailto:` / `tel:` /
     `file://` schemes. Review's regex already allows `https?` and
     `mailto`. If the agent terminal ever emits a `vscode://` link, it
     stops working.

- **Effort:** M (2–4 days). Each finding is small individually but they
  share helpers, tests, and the dev-server CSP gotcha needs iteration.

- **Risk:** Medium-High. The CSP and will-navigate fixes have the
  biggest blast radius (everything renders through the same window).

- **Suggested issue shape:** **Milestone "harden Electron + IPC
  defaults"** with these sub-issues (each its own PR):
  1. `settings:set` key allowlist + reject `vaultPath`
     (S — `main.ts:430` only)
  2. `file:exportPdf` vault-bounded read + tmp dir relocation + CSP on
     emitted HTML (S — `main.ts:905`–`:951`)
  3. `setWindowOpenHandler` scheme guard + shared helper
     (S — `main.ts:256`, `:1196`, new helper)
  4. `will-navigate` guard on main window (S — `main.ts:226`)
  5. `sandbox: true` on main webPreferences (S — `main.ts:242` + smoke
     test of preload bridge)
  6. CSP meta in `index.html` + `onHeadersReceived` (M — iterative
     loosening for Milkdown/CodeMirror)

- **Rollback plan (top-3 critical):**
  - **`settings:set` lockdown**: ship as a single conditional guarded by
    an env var `MARVIN_LEGACY_SETTINGS_SET=1` for one release. Logs an
    audit line whenever the legacy path is exercised (it shouldn't be).
    Remove the env var in the next minor.
  - **`file:exportPdf` assertInVault**: ship behind a try/catch that
    falls back to the old behavior with a console warning if
    `assertInVault` throws. Watch logs for 1 release; remove fallback in
    the next minor. (Or simpler: gate via env var `MARVIN_UNSAFE_EXPORT_PDF=1`.)
  - **CSP**: implement via `<meta http-equiv>` in `index.html`. If
    something breaks in prod, ship a hotfix that removes the meta tag
    (one line) — no main-process change needed. Add a feature-flag in
    `src/lib/featureFlags.ts` if needed.

---

## Cluster 2: Markdown link rewriter robustness

- **Findings included:**
  - 🟠 Not code-fence aware (`electron/main.ts:718`)
  - 🟡 `rewriteOneFile` not idempotent for self-links (`:721`–`:769`)
  - missing reference-style + raw HTML + angle autolinks (review §3
    correctness)
  - 🔵 `await listAllMarkdown` opens every .md in parallel — RLIMIT_NOFILE
    risk on big vaults (`:693`–`:711`, `:847`)

- **Surfaces touched:** `electron/main.ts:693`–`:865`
  (`listAllMarkdown`, `MD_LINK_RE`, `WIKILINK_RE`, `rewriteOneFile`,
  `rewriteWikilinksOneFile`, `rewriteLinksAfterMove`).

- **Downstream dependencies:**
  - Caller is `path:rename` (`main.ts:867`). Rename behavior changes:
    fewer false-positive rewrites (good), more correct reference-style
    rewrites (new behavior).
  - `writeSnapshot('cascade')` (line 857) — every rewritten file gets a
    snapshot. If we now correctly rewrite *more* files (reference-style),
    snapshot volume per rename goes up — could surprise users on big
    vaults. Worth raising the `cascadeTurnId` snapshot cap if there is
    one (check `snapshot.ts` GC).

- **User-facing behavior change:**
  - Code blocks containing `[label](path)` no longer corrupted on rename
    (intentional fix, documented in the README as a feature).
  - Reference-style `[ref]: ./path` now updates on rename — this is new
    behavior. Some users may have intentional broken links they relied
    on. Low risk.
  - Idempotency fix: rename → revert returns the file to original bytes.

- **Data migration:** None. Pure code change to a stateless function.

- **Test coverage today:** No tests for the rewriter. Adding a fixtures
  table (input markdown + rename op + expected output) is a prerequisite
  to the refactor and would catch the corruption case. Effort included in
  the M estimate.

- **Likely breakages:**
  1. Switching from regex to `marked.lexer` walk changes token granularity.
     Edge cases: nested links, escaped brackets, custom syntax (Milkdown
     extensions). Snapshot every rename in tests to catch.
  2. Reference-style rewriting touches link definitions that may live
     anywhere in the file. The `vault-relative` path math in
     `rewriteOneFile` (line 752) assumes a single-line link — reference
     definitions are at the bottom of files and use a different math.
  3. `p-limit(16)` on `listAllMarkdown` will slow rename on small
     vaults (today: parallel = fast; capped: ~16x slower in worst case).
     Mitigate by setting limit higher (e.g. `min(64, listAllMarkdown.length)`).

- **Effort:** M (2–4 days). Lexer walk + reference-style support +
  fixtures + the FD-limit fix. Independent of Cluster 1.

- **Risk:** Medium. Wide blast radius on rename, no tests today.

- **Suggested issue shape:** **Single issue** "Code-fence-aware markdown
  link rewriter". Already called out in review's Bigger Refactors
  section. Sub-tasks (in the issue body, not separate issues):
  1. Add fixture table + tests (current behavior captured)
  2. Switch to `marked.lexer` walk
  3. Reference-style + raw HTML + angle autolinks
  4. Idempotency fix for self-links
  5. Concurrency-limit `listAllMarkdown` reads

---

## Cluster 3: README + docs drift

- **Findings included:**
  - 🟠 README status 0.2.0 vs package.json 0.10.0 (`README.md:5` /
    `package.json:5`)
  - 🟠 Project layout references nonexistent files
    (`README.md:54`–`:60`)
  - 🟠 "Not yet here" lists wikilinks + full-text search, both shipped
    (`:90`–`:97`)
  - 🟢 Unmentioned: snapshots, agent rewind, browser tabs, HTML preview,
    CSV editor

- **Surfaces touched:** `README.md` only.

- **Downstream dependencies:** None.

- **User-facing behavior change:** Documentation only.

- **Data migration:** None.

- **Test coverage today:** N/A.

- **Likely breakages:** None.

- **Effort:** S (≤1 day).

- **Risk:** Low.

- **Suggested issue shape:** **Single issue** "README sweep — sync with
  current code state". Closes by drafting the new README, listing every
  shipped feature, removing stale file references. Tooling-wise: project
  has no auto-generated docs, so this is a one-time manual write.

---

## Cluster 4: Renderer state lifecycle + autosave

These three findings share the same `App.tsx`/`Editor.tsx` state machine
around tabs, content caches, and the save pipeline. All three are small,
related, and should land together — the bootstrap fix actually depends on
the closeTab cache symmetry to avoid post-error stale entries.

- **Findings included:**
  - 🟠 Editor unmount drops pending autosave (`src/components/Editor.tsx:428`)
  - 🟠 Bootstrap IIFE has no `catch` — single throw strands welcome
    state (`src/App.tsx:392`)
  - 🟠 `lastDiskContentRef` leaks on `closeTab` (asymmetry vs
    `closeTabsUnder`) (`src/App.tsx:785`, `:1223`)

- **Surfaces touched:**
  - `src/components/Editor.tsx`: unmount cleanup at line 428; `runSave`
    (434), `flushSave` (449), `latestValue`/`onSaveRef` refs.
  - `src/App.tsx`: bootstrap IIFE at 392; `closeTab` at 785;
    `closeTabsUnder` at 1223; `lastDiskContentRef`, `bufferContentRef`
    maps; `setBootstrapped` setter (262).

- **Downstream dependencies:**
  - **Editor unmount flush** races with React's component teardown. The
    review proposes `void onSaveRef.current(latestValue.current)` — this
    is an unawaited IPC `invoke`. If `file:write` throws (rare — vault
    boundary, ENOSPC), the error is silently swallowed. Acceptable per
    review.
  - **Bootstrap try/catch**: introduces a new error state for "vault
    inaccessible at boot". Today there's no UI for this — `setError`
    just renders the toast. The user can never recover without
    `vault:pick`. Best to render a "Pick vault" inline button in the
    welcome screen when bootstrap fails.
  - **`closeTab` symmetry**: both `lastDiskContentRef` and
    `bufferContentRef` should be cleared when no tab owns the path.
    Today's asymmetry means `file:changed` keeps `file.read`-ing
    closed-tab paths.

- **User-facing behavior change:**
  - **Saved bytes that were previously lost (autosave race)** now
    persist. Strict improvement.
  - **Welcome screen "Loading…" forever bug** now resolves to a clear
    error state. Strict improvement.
  - `closeTab` cache cleanup is invisible.

- **Data migration:** None.

- **Test coverage today:**
  - `src/components/__tests__/editor-save-mode.spec.tsx` exists but
    focuses on auto/manual switching, not unmount. Will need an unmount
    test added.
  - No tests for App.tsx bootstrap or closeTab.

- **Likely breakages:**
  1. Editor unmount flush firing during HMR re-mount could double-write
     (one from unmount, one from the new mount's debounce). Mitigate by
     checking `isDirtyRef.current` before flushing.
  2. Bootstrap catch may mask real bugs during development if added
     without `console.error`. Make sure `console.error` is unconditional.

- **Effort:** S (1 day total).

- **Risk:** Low.

- **Suggested issue shape:** **Single issue** "Renderer state lifecycle
  hardening" with 3 numbered items in the body. One PR.

---

## Cluster 5: Watcher / fsevents / external-edit detection

- **Findings included:**
  - 🟠 `file:changed` content-equality misses BOM/CRLF/trailing-newline
    flips (`src/App.tsx:457`–`:516`)
  - 🟡 `lastPtyWriteAt`-based "AI turn active" classification has
    false negatives (native chat agent path doesn't bump it)
    (`electron/main.ts:96`)
  - 🟡 `chokidar.watch` keeps default options — fsevents quirks
    (`electron/main.ts:518`–`:526`)
  - 🟡 `add` events fire `notifyTree()` per file → vault:tree rebuild
    storms (`electron/main.ts:570`–`:573`)

- **Surfaces touched:**
  - `electron/main.ts:96` (`AI_TURN_WINDOW_MS`, `lastPtyWriteAt`)
  - `electron/main.ts:518`–`:586` (watcher setup + handlers)
  - `electron/agent/index.ts:316`–`:326` (agent spawn — needs to bump a
    shared `aiActive` flag)
  - `src/App.tsx:457`–`:516` (`file:changed` handler) — add
    `normalizeForCompare` helper

- **Downstream dependencies:**
  - **Renaming `lastPtyWriteAt` → `lastAgentActivityAt`** affects every
    snapshot-trigger condition (file:write line 623, watcher change
    line 575, pty:write line 1125, path:rename line 873). Touching them
    together is correct.
  - **Debouncing `notifyTree`** changes timing of `vault:tree` reload
    — must preserve correctness when a single edit emits add+unlink.
  - **`awaitWriteFinish`** introduces a 50ms latency on every notify —
    user-visible only if they watch the tree update in real time.

- **User-facing behavior change:**
  - Fewer spurious "external change" banners on BOM/EOL normalizations
    by editors like Sublime/VSCode in atomic mode.
  - Snapshot triggers correctly during native-chat agent edits (today
    they're misclassified as external).
  - Tree updates less choppy during agent bursts.

- **Data migration:** None.

- **Test coverage today:** `noisyPaths.spec.ts` exists but doesn't
  cover the watcher integration. No test for AI-active classification.

- **Likely breakages:**
  1. `awaitWriteFinish` can hide rapid programmatic writes (the agent
     loop) — verify snapshot pre-write hook still catches changes.
  2. Debouncing `vault:tree` reload: if a user creates a file via
     `file:create` IPC, the tree shows up 50ms later. Currently
     `file:create` directly calls `notifyTree()` (`main.ts:667`), so
     debouncing must still be leading-edge for that path.
  3. `followSymlinks: false` excludes any vault that uses symlinks
     intentionally (e.g. `attachments/ → ~/Pictures`). Documented as a
     known limitation.

- **Effort:** M (2–4 days).

- **Risk:** Medium. Touches the snapshot trigger path which has no
  end-to-end test.

- **Suggested issue shape:** **Single issue** "Watcher robustness + AI
  active flag refactor" with the four numbered findings. Combine because
  they all share the `lastPtyWriteAt` rename.

---

## Cluster 6: Accessibility

- **Findings included:**
  - 🟠 `error-toast` not announced (`src/App.tsx:1759`)
  - 🟠 `InputDialog` no focus trap; backdrop `onMouseDown` cancels
    spuriously (`src/components/InputDialog.tsx:42`–`:48`)
  - 🟠 `FileTree` lacks roving-tabindex keyboard nav
    (`src/components/FileTree.tsx:258`–`:328`)
  - 🟡 `Splitter` has `role="separator"` but no `aria-valuenow` /
    keyboard (`src/components/Splitter.tsx:48`–`:60`)
  - 🟡 ContextMenu focus return on Linux unverified
    (`electron/main.ts:991`)
  - 🟢 `error-toast` contrast check

- **Surfaces touched:** `App.tsx`, `InputDialog.tsx`, `FileTree.tsx`,
  `Splitter.tsx`. No `main.ts` changes (except Linux verification).

- **Downstream dependencies:**
  - **Roving-tabindex on FileTree** requires switching the `<button>` to
    a focusable `<div role="treeitem" tabIndex={isFocused?0:-1}>`.
    Virtualization (lines 139–143) interacts: not-rendered rows can't
    receive focus, so arrow-down past the rendered window must trigger
    a virtualizer scroll first. This is non-trivial.

- **User-facing behavior change:** Keyboard nav improvements only.
  No behavioral regression for mouse users.

- **Data migration:** None.

- **Test coverage today:** None for a11y. `@testing-library/jest-dom` is
  set up — `axe-core` integration would be a small addition.

- **Likely breakages:**
  1. FileTree's roving-tabindex + virtualization is the trickiest piece.
     Mistakes could break selection or focus management.
  2. InputDialog focus trap could prevent legitimate focus escapes
     (e.g. command palette opened from inside a dialog).

- **Effort:** M (3–5 days for FileTree alone; the others are S).

- **Risk:** Low-Medium. Pure renderer work, no security implication.

- **Suggested issue shape:** **Single issue** "a11y pass — focus
  management + screen-reader announcements". Sub-tasks listed in body
  (toast role/aria-live; InputDialog focus trap + click-vs-mousedown;
  Splitter keyboard + aria-value; FileTree roving-tabindex). The FileTree
  piece alone could be its own issue if maintainer prefers.

---

## Cluster 7: IPC argument validation + small surface tightening

Lower-severity IPC hygiene that doesn't fit Cluster 1's "critical
hardening" framing but should reuse the same validator helpers introduced
there.

- **Findings included:**
  - 🟠 IPC arg types not enforced at runtime — `pty:write`,
    `browser:setBounds`, etc. (`electron/main.ts:430`, `:1125`, `:1300`)
  - 🟠 `file:writeBinary` redundant `vaultPath` argument
    (`electron/main.ts:671`–`:682`, `electron/preload.ts:63`)
  - 🟡 `marvin://` host accepts URL-encoded `..%2f..` — caught by
    boundary check but reject up front (`electron/main.ts:321`–`:329`)
  - 🟡 `noisyPaths` excluded from chokidar but NOT from `marvin://`
    handler — `.marvin/snapshots/*` readable via the protocol
    (`electron/main.ts:523` vs `:306`)
  - 🟡 `pty:spawn` env scrubbing (SSH_AUTH_SOCK, AWS keys etc.)
    (`electron/main.ts:1062`–`:1082`)
  - 🟡 `pty:spawn` `getShellEnv()` 4s timeout too short on slow boxes
    (`electron/main.ts:58`)
  - 🟡 `path:rename` rejects case-only rename on macOS
    (`electron/main.ts:867`–`:897`)
  - 🟡 `path:rename` doesn't check both paths live in same vault (nit
    — multi-vault not supported yet)
  - 🔵 `pty:write` no length cap (1MiB cap recommended)
    (`electron/main.ts:1125`)
  - 🔵 `pty:spawn` returns raw `pid` to renderer (unused)
    (`electron/main.ts:1115`)
  - 🔵 `pty:resize/kill/write` no id validation
  - 🔵 `file:create` / `folder:create` no basename validation
  - 🔵 `fileContentCache` never pruned
  - 🔵 Channel naming inconsistency (kebab vs camel)

- **Surfaces touched:** Many handlers in `electron/main.ts`. New shared
  helper(s): `validateScalar(s, kind)`, `validateBasename(name)`,
  `narrowKeys(obj, allowlist)`.

- **Downstream dependencies:**
  - **Removing `vaultPath` from `file:writeBinary`** breaks the preload
    type (`preload.ts:63`) and every caller in
    `src/lib/dropAttachments.ts`, `Editor.tsx`, `LiveMarkdown.tsx`,
    `__tests__/Editor-drop.spec.tsx`, `LiveMarkdown-drop.spec.tsx`.
    Caller has the vaultPath anyway; the change is cosmetic in renderer
    but reduces IPC surface. **Tests break**: `Editor-drop.spec.tsx` and
    `LiveMarkdown-drop.spec.tsx` mock `writeBinary` with the current
    signature — they need updating.
  - **`pty:write` 1MiB cap**: real terminal use rarely sends >4kB at
    once. Safe cap.
  - **Channel renaming**: massive blast radius across `preload.ts`,
    `main.ts`, every consumer. Probably out of scope unless paired with
    the IPC schema rewrite (Cluster 1's milestone might include it).

- **User-facing behavior change:**
  - Case-only rename on macOS now works (currently silently rejected).
  - `pty:write` with >1MiB throws — only affects pathological
    callers.
  - Other changes invisible.

- **Data migration:** None.

- **Test coverage today:**
  - `pty-spawn.spec.ts`, `file-write-binary.spec.ts` exist for the
    main surfaces. Will need updating.

- **Likely breakages:**
  1. Removing `vaultPath` from `file:writeBinary` signature breaks at
     least 2 mocked tests + 2 renderer callers. Coordinated PR.
  2. Channel renaming (if in scope) would require a coordinated
     preload/renderer rewrite.

- **Effort:** M (3–5 days for the whole list; or split into multiple
  S PRs).

- **Risk:** Low individually, Medium aggregated.

- **Suggested issue shape:** **Single issue** "IPC validation pass +
  surface cleanup". Sub-tasks in body. Channel-rename pulled out into a
  separate parking-lot issue (defer until IPC schema work).

---

## Cluster 8: TS strict + App.tsx decomposition

- **Findings included:**
  - 🟠 tsconfigs don't enable `"strict": true` (`tsconfig.app.json:2`,
    `tsconfig.node.json:2`)
  - 🟢 `Editor.tsx` 820 lines (refactor)
  - 🟢 `App.tsx` 1834 lines (refactor — `useTabsReducer`,
    `useGlobalShortcuts`, `useFileSync`, `useExternalChangeBanner`,
    `useSnapshotToasts`)
  - 🟡 React 19 `useEffect` returning `off` directly is brittle
    (`src/App.tsx:443, :452, :515, :964`)
  - 🟢 Type duplication for `FileNode`, `Tab`, `MenuItemSpec`
  - 🟡 `humanizeError` regex catalog scattered
  - 🟡 Path joining uses literal `/`

- **Surfaces touched:** Nearly everything in `src/`. Touches at least:
  `App.tsx` (the big one), `Editor.tsx`, `types.ts`, both tsconfigs,
  several lib files.

- **Downstream dependencies:**
  - **`"strict": true`** lights up `strictNullChecks` across the entire
    codebase. Grep'd: many places use `x?.foo` patterns already, so
    impact is moderate. Estimated by the review: "many safer paths
    already, defensive `?? null` can be removed."
  - **Extracting hooks from App.tsx** moves state across module
    boundaries. Each extraction is small in isolation but they share
    refs (`bufferContentRef`, `lastDiskContentRef`, `loadGenRef`).
  - **Type unification** (FileNode, Tab, MenuItemSpec) requires moving
    types to `src/shared/`. The current duplication is the standard
    Electron preload/renderer boundary pattern; consolidating means
    deciding which side owns the types.

- **User-facing behavior change:** None expected.

- **Data migration:** None.

- **Test coverage today:** Existing tests would catch some regressions
  but not all. Strict-mode migration in particular can hide bugs in
  paths that don't have tests.

- **Likely breakages:**
  1. Strict-mode flips `strictNullChecks` — every `?` access in IPC
     event payloads becomes a compile error. Will require touching
     dozens of files.
  2. Refactoring App.tsx hooks has high chance of subtle regressions in
     tab/state machine.
  3. `humanizeError` move to shared affects every error display
     callsite.

- **Effort:** L (>5 days). The review correctly flagged App.tsx as a
  "milestone with sub-issues per hook".

- **Risk:** Medium-High. Pure DX work but easy to introduce regressions.

- **Suggested issue shape:** **Milestone "DX / TS-strict / App.tsx
  decomposition"** with sub-issues:
  1. Enable `"strict": true` in `electron/` only (M)
  2. Enable `"strict": true` in `src/lib/` (S)
  3. Enable `"strict": true` in `src/components/` + `src/App.tsx` (M)
  4. Unify `FileNode`/`Tab`/`MenuItemSpec` into `src/shared/` (S)
  5. Extract `useTabsReducer` (M)
  6. Extract `useGlobalShortcuts` (S)
  7. Extract `useFileSync` + `useExternalChangeBanner` (M)
  8. Extract `useSnapshotToasts` (S)
  9. Extract `Editor.tsx` autosave/findbar/mention into `src/lib/editor/` (M)
  10. Path joining utilities + `humanizeError` move (S)
  11. Defensive `off()` wrapping pattern (S — find/replace)

---

## Cluster 9: Performance coalescing

- **Findings included:**
  - 🟡 `vault:tree` rebuilds on every chokidar event
    (`electron/main.ts:495`–`:498`, `:570`–`:586`,
    `src/App.tsx:441`)
  - 🟡 `FileTree` flattenVisibleTree memo retriggers on every nodes
    change (`src/components/FileTree.tsx:139`–`:143`)
  - 🔵 `Splitter` doesn't throttle `onDelta`
    (`src/components/Splitter.tsx:20`–`:28`)
  - 🟢 `paletteItemsBase` rebuild on every tree change
    (`src/App.tsx:592`–`:599`)
  - 🔵 `humanizeError` toast text not length-capped
    (`src/App.tsx:229`–`:251`)

- **Surfaces touched:** Renderer-side mostly, plus a single
  `setTimeout` debounce in `main.ts` notifyTree.

- **Downstream dependencies:** Minor. Debouncing `vault:tree` reload
  changes timing for snapshot-toast triggered tree refreshes.

- **User-facing behavior change:** Improved perf on big vaults and
  splitter drags. Tree updates may be ~50ms delayed during agent
  bursts.

- **Data migration:** None.

- **Test coverage today:** None for perf.

- **Likely breakages:** Minor — debounced tree refresh might leave the
  tree stale at the end of a multi-event burst if the trailing edge is
  missed. Test the trailing-edge logic carefully.

- **Effort:** S (1 day).

- **Risk:** Low.

- **Suggested issue shape:** **Single issue** "Perf coalescing pass" —
  five small fixes batched. Could also ship as the first PR in any
  iteration.

---

## Cluster 10: Design-token compliance

- **Findings included:**
  - 🟡 ~10 spot-checked hardcoded hex literals in `src/App.css`
  - 30+ raw `rgba()` literals outside tokens
  - 231 raw `padding/margin/gap/width/height` px literals
  - 🟡 Need a stylelint rule for enforcement going forward

- **Surfaces touched:** `src/App.css` only (+ new stylelint config).

- **Downstream dependencies:**
  - Visual style changes if a hardcoded hex didn't match its token
    cousin. Each substitution should be sight-tested.
  - Adding stylelint affects CI.

- **User-facing behavior change:** None intended.

- **Data migration:** None.

- **Test coverage today:** No visual regression tests.

- **Likely breakages:** Subtle visual drift if mechanical substitution
  picks a wrong token. Recommend grouping by component (e.g. find-bar,
  image-viewer) and reviewing each batch visually.

- **Effort:** M (2–3 days for the migration + lint rule).

- **Risk:** Low for code, Medium for visual regressions.

- **Suggested issue shape:** **Single issue** "Design-token compliance
  audit". Body has a per-region checklist
  (find-bar, image-viewer, error-toast, etc.). One PR per region is
  fine; the stylelint rule is its own sub-PR.

---

## Cross-cluster conflicts

- **Cluster 1 → Cluster 7**: Cluster 1 introduces shared validator
  helpers (`narrowKeys`, `SAFE_EXT_RE`). Cluster 7's
  `validateBasename`, `pty:write` byte cap, etc. should reuse these.
  **Sequence: 1 before 7.**

- **Cluster 1 (file:exportPdf assertInVault) → Cluster 7
  (file:writeBinary vaultPath removal)**: both touch the
  vault-bounded handler family. Both can use the same `assertInVault`
  helper that already exists, no real conflict beyond `main.ts`
  merge-conflicts if landed simultaneously. **Sequence: any.**

- **Cluster 2 (rewriter refactor) → Cluster 5 (watcher AI-active
  flag)**: both touch the `path:rename` snapshot flow. Cluster 5
  renames `lastPtyWriteAt → lastAgentActivityAt` which is read at
  `main.ts:873`. **Sequence: 2 before 5** (rewriter contract stays
  stable; watcher flag is a renaming).

- **Cluster 4 (closeTab cache symmetry) → Cluster 5 (file:changed
  normalization)**: both touch `src/App.tsx:457`–`:516`.
  **Sequence: 4 before 5** (cache symmetry is a pure simplification).

- **Cluster 8 (App.tsx hooks extraction) → all renderer clusters**:
  if started early, every other cluster's renderer change has to be
  re-applied to the new hook files. **Sequence: 8 last.**

- **Cluster 1 (CSP) → Cluster 6 (a11y toast role/aria-live)**: both
  touch `src/App.tsx:1759`. Trivial conflict — line-level. **Sequence:
  any.**

---

## Untouched (review findings that don't need impact analysis)

Pure docs/nits — ship as one cleanup PR or fold into Cluster 3:

- 🟢 `path:trash` and `shell:reveal` vault-bounded (informational —
  already correct)
- 🟢 `path:rename` cross-vault check (no-op until multi-vault, defer)
- 🟢 Channel naming inconsistency (defer — pair with future IPC schema
  rewrite)
- 🟢 `error-toast` contrast verification (single line of CSS, fold into
  Cluster 10)
- 🟢 `Editor.tsx` palette filter memoization (`Editor.tsx:639`–`:642`)
  — micro-perf, fold into Cluster 9

The "What's good" section of the review confirms vault-boundary, PTY guard,
agent-detect guard, snapshot system, and `marvin://` CSP defense-in-depth
are already at the standard the rest of the codebase should match. No
action needed there.
