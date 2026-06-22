# Preview images in markdown preview — technical plan

Issue: [#119](https://github.com/marcelusfernandes/marvinz/issues/119) · Branch: `feat/preview-images`

Goal: render images inside the Milkdown live preview for the three syntaxes vault users naturally write — relative paths, vault-absolute paths, and Obsidian-style embed wikilinks (`![[name]]`) — while reusing the existing `marvin://` protocol and its vault-boundary guarantees.

## 1. Current state

### 1.1 LiveMarkdown editor (`src/components/LiveMarkdown.tsx`)

- Mounts a Milkdown 7.20 editor with `commonmark`, `gfm`, and `listener`. No image-specific plugin is registered, so CommonMark's stock `image` node is used: parsed into a `prose-mirror` node and rendered as `<img src=...>` directly into the DOM with no URL rewriting.
- Body pre-processing happens once at mount: `parseWikilinks(body)` rewrites `[[Name]]` → `[Name](wikilink:Name)`. Inverse runs in `listenerCtx.markdownUpdated` to preserve round-trip on disk.
- Click delegation on the host `<div>` intercepts `<a>` to route links through `onLinkClick`; nothing equivalent exists for `<img>`.
- Editor is remounted (via `remountKey={filePath}`) on file switch; not on keystrokes.
- Props received: `body`, `onChange`, `onLinkClick`, `remountKey`. No `filePath`/`vaultPath` today.

### 1.2 Wikilink layer (`src/lib/wikilinks.ts`)

- `WIKILINK_RE = /\[\[([^\[\]\n|]+)(?:\|([^\[\]\n]+))?\]\]/g` — anchored on `[[...]]`, blind to a leading `!`.
- `parseWikilinks` emits `[display](wikilink:<encoded-name>)`. Round-trip handled by `unparseWikilinks` (regex on rendered markdown).
- `resolveWikilink(name, currentFile, vaultPath, items)` resolves bare names to absolute paths via `PaletteItem` index (basename match, same-folder tiebreak); rejects targets outside vault.
- Today the resolver assumes markdown targets (filters `it.isMarkdown`) — needs to accept image items for embed wikilinks.

### 1.3 `marvin://` protocol (`electron/main.ts:191-263`)

- Registered as `standard` + `secure` + `supportFetchAPI` + `stream`.
- Accepts two URL shapes: app-emitted `marvin://localhost/<abs-vault-path>` and user-typed `marvin://<vault-relative>`.
- Path resolution funnels into `assertInsideVaultAsync(activeVaultPath, filePath)` which performs realpath + prefix check — symlink escapes blocked.
- Serves only files; MIME table whitelists `png|jpg|jpeg|gif|webp|bmp|svg|ico|avif|pdf|html|htm|css|js|mjs`. SVG returns `image/svg+xml` (script execution risk — see §4).

### 1.4 URL building (`src/components/ImageViewer.tsx:9-21`)

- `imageUrl(absPath)` URL-encodes each segment of an absolute path and prepends `marvin://localhost`. Used by the standalone image viewer (clicking an image file in the tree).
- Same builder is exactly what the Milkdown plugin needs — duplication must be removed.

### 1.5 Editor link resolution (`src/components/Editor.tsx:72-84, 195-215`)

- `resolveLink(href, currentFile, vaultPath)`: handles `/`-prefix as vault-root, otherwise resolves relative to `currentFile`'s directory; returns `null` if escape attempted lexically. Pure string ops, no FS.
- `handleLinkClick` already discriminates external (`https?:`/`mailto:`), wikilink (via `isWikilinkHref`), and relative paths. The image resolver should mirror this branching structure.
- `vaultPath`, `filePath`, `paletteItems` are already props of `Editor` — passing them down into `LiveMarkdown` is trivial.

## 2. Design decisions

### 2.1 Plugin vs. node view

Use a **ProseMirror node view** wired through Milkdown's `$view` utility, **not** a Milkdown `$nodeAttr` schema patch. Rationale:

- The CommonMark `image` node already exists; we don't need a new schema, only a different render. `$view` replaces only the DOM rendering — leaves parser, serializer, and `gfm` interactions untouched.
- A node view can read `src`/`alt`/`title` from the node, mutate the rendered `<img src>` to a `marvin://` URL, and attach `onerror` to swap in a broken-image placeholder without forking the editor state.
- Avoids messing with the markdown round-trip — the on-disk `![alt](path)` text never changes.
- For `![[name]]` syntax, pre-processing (§2.3) converts it into a CommonMark image with a `wikilink-image:` sentinel scheme; the same node view recognises the scheme and resolves it differently.

### 2.2 Where vault context lives

Pass `filePath` and `vaultPath` (and `paletteItems` for wikilink resolution) **as props** from `Editor` → `LiveMarkdown`, then hand them to the node view through a small closure built at editor construction time. Do not put them in Milkdown's `ctx` — `ctx` is global per editor instance and would force a remount on file switch (which already happens via `remountKey`, so we'd be paying twice).

Concrete shape:

```
LiveMarkdown props gain: filePath: string, vaultPath: string, paletteItems: PaletteItem[]
useEditor(...) closes over these and passes them to imageNodeView(filePath, vaultPath, paletteItems)
```

The node view is rebuilt on remount alongside the editor — same lifecycle as today.

### 2.3 Round-trip for `![[name]]`

Extend `parseWikilinks` to a sibling regex match for the embed form, but emit a **distinct** sentinel scheme so the node view can tell them apart from regular link wikilinks:

- `![[name]]` → `![name](wikilink-image:<encoded-name>)`
- `![[name|alt]]` → `![alt](wikilink-image:<encoded-name>)`
- `[[name]]` → `[name](wikilink:<encoded-name>)` (unchanged)

Add a matching `unparseWikilinksImage` (or fold into `unparseWikilinks` with a second regex) for the inverse on emit. The two transforms must be applied in the right order: image first (more specific — starts with `!`), then link.

`isWikilinkHref` gets a sibling `isWikilinkImageSrc(src)` so the node view can branch cleanly.

### 2.4 Path resolution surface

New module `src/lib/marvinUrl.ts` exports:

- `toMarvinUrl(absPath: string): string` — moved from `ImageViewer` (§3.1 in task #2).
- `resolveImageSrc(src, currentFile, vaultPath, items): { kind: 'marvin', url } | { kind: 'external', url } | { kind: 'missing' }` — the central router used by the node view (task #3).

Routing rules:

1. `^(https?|data):` → `kind: 'external'`, pass through unchanged.
2. `^wikilink-image:` → resolve name via `resolveWikilink` extended to accept non-markdown items → `marvin://` URL or `missing`.
3. `^/` → vault-root-relative; join with `vaultPath`; lexical-only inside-vault check (FS check is the main process's job). Build `marvin://` URL.
4. Otherwise (relative path) → join with `dirname(currentFile)`, normalize `..` lexically, inside-vault check, build `marvin://` URL.
5. Any traversal escape or empty result → `kind: 'missing'`.

The main process still enforces the boundary at request time via `assertInsideVaultAsync`; the renderer-side check is a UX optimization to render the placeholder without a network round-trip when the path is obviously off-vault.

### 2.5 Broken-image placeholder

Node view sets `<img onerror>` to swap the element with a small inline placeholder (existing `Icon name="file-media"` styled like the file-tree's broken-link affordance) plus the unresolved `src` as title text. Pure DOM, no React inside the node view.

## 3. Files to change

| File                                       | Change                                                                                                                      | Task   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------ |
| `src/components/ImageViewer.tsx`           | Replace local `imageUrl` with `toMarvinUrl` import                                                                          | #2     |
| `src/lib/marvinUrl.ts` _(new)_             | `toMarvinUrl`, `resolveImageSrc`                                                                                            | #2, #3 |
| `src/lib/marvinUrl.test.ts` _(new)_        | Resolver coverage: 3 syntaxes + edge cases                                                                                  | #4     |
| `src/lib/wikilinks.ts`                     | Add `WIKILINK_IMAGE_RE`, extend `parseWikilinks`, add `isWikilinkImageSrc`; extend `resolveWikilink` to accept non-md items | #5     |
| `src/components/LiveMarkdown.tsx`          | New props `filePath`/`vaultPath`/`paletteItems`; install image node view via `$view`                                        | #6     |
| `src/components/Editor.tsx`                | Forward props to `LiveMarkdown`                                                                                             | #6     |
| `README.md`                                | Document supported image syntaxes                                                                                           | #9     |
| `tests/e2e/preview-images.spec.ts` _(new)_ | Playwright: relative, absolute, wikilink, broken                                                                            | #7     |

No `electron/main.ts` change required — protocol already serves images and enforces boundary.

## 4. Risk register

Reviewed by `security` teammate (2026-05-23). Original entries kept; **Resolution** column reflects the binding decision.

| #   | Risk                                                                                                          | Mitigation                                                                                                                                                                              | Resolution                                                                                                                                                                                                                                                                                                                                                                               | Owner                     |
| --- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| R1  | Extending `parseWikilinks` for `!` prefix breaks the existing link form (e.g. greedy match consumes the `!`). | The image regex must run **before** the link regex on the same input and capture `!` as part of the match; link regex is unchanged. Unit tests with adjacent `![[img]] [[link]]` mixes. | Open — verified by tests #4.                                                                                                                                                                                                                                                                                                                                                             | react (#5) + qa (#4)      |
| R2  | Filesystem escape via `..` in a relative path.                                                                | Lexical `..` resolution in `resolveImageSrc` + inside-vault check before building URL; final authority remains `assertInsideVaultAsync` in main.                                        | **Closed** — `assertInsideVaultAsync` already covers all cases (null-byte, `..`, abs-outside, active symlink, dangling symlink) and is tested in `electron/__tests__/marvin-protocol.spec.ts`. Renderer-side check stays as UX. **Add one case to test #4**: `src` with `..` escape → `resolveImageSrc` returns `{ kind: 'missing' }`.                                                   | react (#3), qa (#4)       |
| R3  | SVG with `<script>` executes in the renderer context (privileged origin).                                     | See §4.1 below.                                                                                                                                                                         | **Not critical** — Chromium's "secure animation mode" for `<img>`-loaded SVGs disables `<script>`, inline event handlers, `<foreignObject>`, external fetches, and CSS `@import` unconditionally. This is a normative gate at the SVG-as-image renderer, not configurable via CSP. The plan's `<img>`-only node view (§2.1) keeps us in that mode. **Defense-in-depth actions in §4.1.** | security (#8), react (#6) |
| R4  | `paletteItems` may not include image files today (filtered to markdown for the palette).                      | Verify in task #5 — if filtered, broaden the index source or use a separate vault file index for image lookup.                                                                          | Open — confirm in #5.                                                                                                                                                                                                                                                                                                                                                                    | react (#5)                |
| R5  | Editor remount cost when wiring new props.                                                                    | Already remounts on `filePath` change. New props (`vaultPath`, `paletteItems`) won't change mid-session for a given file. Safe.                                                         | Closed.                                                                                                                                                                                                                                                                                                                                                                                  | —                         |
| R6  | External `http(s)` images cause network requests from a privileged origin.                                    | Default behaviour acceptable for v1 (matches Obsidian); revisit if `security` (#8) flags it.                                                                                            | **Accepted for v1.** Privacy leak via tracking pixels acknowledged but matches Obsidian/Typora baseline. **README disclaimer required in #9.** Privacy-hardening preference filed as follow-up (out of scope).                                                                                                                                                                           | security (#8), react (#9) |

### 4.1 R3 — defense-in-depth (must do in this PR)

These are belt-and-suspenders measures, **not** the primary defense. The primary defense is `<img>`-only rendering in the node view (§2.1).

1. **Add CSP response header to `marvin://` handler** (`electron/main.ts:256-258`): set `Content-Security-Policy: script-src 'none'; object-src 'none'` on the `Response`. Cost: one line. Protects against a future regression where someone wires SVG via `<object>` (where CSP **is** honored, unlike for `<img>` where it's already irrelevant).
2. **Comment the invariant** in `electron/main.ts:205` (the SVG MIME entry): one line stating that SVGs may only be embedded via `<img>`; `<object>`/`<iframe>`/`<embed>` would enable script execution.
3. **Node view must use `<img>` exclusively** — no `dangerouslySetInnerHTML`, no `<object>`, no `<iframe>`. The error placeholder (§2.5) is pure DOM (`document.createElement`), not React-injected innerHTML.

Explicitly rejected mitigations: server-side SVG sanitization (cost too high, breaks legitimate SVGs); `Content-Disposition: attachment` (breaks the feature entirely).

### 4.2 Post-implementation review (task #8)

When task #6 lands, `security` re-reviews the diff to confirm:
(a) `<img>`-only in the node view, (b) URL shape matches `marvin://localhost/<encoded-abs-path>`, (c) round-trip in `unparseWikilinks` does not leak absolute disk paths into saved markdown, (d) no `dangerouslySetInnerHTML` in the placeholder.

## 5. Out of scope

- Image resizing syntax (`![[img\|300]]` width param) — defer.
- Click-to-open in `ImageViewer` from preview — defer (track as follow-up).
- Drag-and-drop image insertion — separate issue.
- Image caching/thumbnailing — relying on Chromium cache for now.

## 6. Suggested commit slicing

Implementers should land in this order, one commit each:

1. `refactor: extract imageUrl to marvinUrl module` (task #2)
2. `feat: resolveImageSrc for relative/absolute/wikilink paths` (task #3)
3. `test: marvinUrl resolver coverage` (task #4)
4. `feat: parse ![[name]] embed wikilinks` (task #5)
5. `feat: render images in markdown preview` (task #6) — the user-visible change
6. `test(e2e): preview images render across syntaxes` (task #7)
7. `docs: document supported image syntaxes` (task #9)

Task #8 (security review) runs in parallel and may add a follow-up commit.
