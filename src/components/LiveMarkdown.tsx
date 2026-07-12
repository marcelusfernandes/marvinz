/* eslint-disable react-refresh/only-export-components -- legacy file exports helpers alongside the component; refactor tracked in #474 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Editor as MilkdownEditor,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  parserCtx,
  prosePluginsCtx,
  rootCtx,
} from '@milkdown/core'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import { selectAll } from 'prosemirror-commands'
import { history as pmHistory, redo, redoDepth, undo, undoDepth } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { findNext, findPrev, search } from 'prosemirror-search'
import { Slice, type Node as PMNode } from 'prosemirror-model'
import { Plugin, TextSelection } from 'prosemirror-state'
import { dropCursor } from 'prosemirror-dropcursor'
import type { EditorView } from 'prosemirror-view'
import { imageNodeView } from '../lib/imageNodeView'
import { mermaidNodeView } from '../lib/mermaidNodeView'
import { taskListNodeView } from '../lib/taskListNodeView'
import { taskListBracketInputRule } from '../lib/taskListInputRule'
import { justInsertedPlugin, justInsertedPluginKey } from '../lib/pmJustInsertedHighlight'
import { justReplacedPlugin } from '../lib/pmJustReplacedHighlight'
import type { PaletteItem } from '../lib/paletteRanker'
import { parseWikilinks, unparseWikilinks } from '../lib/wikilinks'
import { mentionInsertText } from '../lib/mentionInsert'
import { mentionTrigger } from '../lib/pmMentionTrigger'
import { MentionPicker } from './MentionPicker'
import {
  MARVIN_PATH_MIME,
  MARVIN_PATHS_MIME,
  collectFiles,
  emitSummaryToast,
  internalDragMarkdown,
  persistDroppedFiles,
  readDraggedPaths,
} from '../lib/dropAttachments'
import type { ImportToastState } from './ImportToast'
import type { AgentKind } from '../lib/agent-drop-format'
import type { MenuItemSpec } from '../types'
import { formatSelectionForAgent } from '../lib/agent-selection-format'
import { clampToViewport } from '../lib/chipViewportClamp'
import { EditorSelectionChip } from './EditorSelectionChip'
import { useAppContext } from '../context/AppContext'

type Props = {
  /** Markdown body (without frontmatter) to render. */
  body: string
  /** Fired whenever the user edits content. Receives the new markdown. */
  onChange: (markdown: string) => void
  /** Click handler for `<a>` elements rendered inside the editor. */
  onLinkClick: (href: string, modifier: 'replace' | 'newTab') => void
  /** Absolute path of the file being edited — base for relative image resolution. */
  filePath: string
  /** Palette index used to resolve `![[name]]` embed wikilinks. */
  paletteItems: PaletteItem[]
  /**
   * A key that changes when we want to fully remount the editor and reset
   * its content (e.g., switching files or external file change while open).
   */
  remountKey: string | number
  /**
   * Opens the parent-rendered find bar in the requested mode. Wired so
   * Cmd+F / Cmd+Alt+F inside the PM contentDOM surface the bar in the
   * editor header instead of rendering a panel locally.
   */
  onOpenFind?: (mode: 'find' | 'replace') => void
  /**
   * Fires whenever the live EditorView reference becomes available
   * (or null on unmount), so the parent can drive search commands.
   */
  onViewReady?: (view: EditorView | null) => void
  /** Surfaces drag-drop import outcomes (success / error / partial). */
  onImportToast?: (toast: { state: ImportToastState; message: string }) => void
  /** Click handler for the floating selection chip. Receives the formatted
   * selection text ready to send to the focused agent. */
  onSendSelection?: (formatted: string) => void
  /** Agent the formatted selection targets. */
  agentKind?: AgentKind
}

type ParserCtxGetter = { get: (key: typeof parserCtx) => (text: string) => PMNode | null }

// Locates the line range of a rendered selection inside the markdown source.
// Returns "N" or "N-M" if an unambiguous match exists; null otherwise (caller
// falls back to no range). Best-effort: rendered text equals source for plain
// paragraphs, but markdown decorations (bold, headings, emphasis) strip on
// render — those selections fail to match and gracefully degrade.
export function findSelectionLineRange(selectedText: string, source: string): string | null {
  const trimmed = selectedText.replace(/\s+$/, '')
  if (!trimmed || !source) return null
  const idx = source.indexOf(trimmed)
  if (idx === -1) return null
  if (source.indexOf(trimmed, idx + 1) !== -1) return null
  const startLine = source.slice(0, idx).split('\n').length
  const endLine = source.slice(0, idx + trimmed.length).split('\n').length
  return startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`
}

// Resolve the document range of a misspelled word so a suggestion can replace
// it. The native context-menu event positions the caret inside the clicked
// word but the IPC returns no range, so we scan the caret's textblock for the
// occurrence of `word` that contains the cursor offset. Picking the occurrence
// under the caret (rather than the first match) keeps the right word when it
// repeats in the block. Returns null when the caret isn't inside a textblock
// or the word can't be located there.
export function misspelledWordRange(
  state: import('prosemirror-state').EditorState,
  word: string
): { from: number; to: number } | null {
  if (!word) return null
  const $from = state.selection.$from
  const parent = $from.parent
  if (!parent.isTextblock) return null
  const blockStart = $from.start()
  const text = parent.textContent
  const caret = $from.pos - blockStart
  let idx = text.indexOf(word)
  while (idx !== -1) {
    // Strict upper bound: caret at idx + word.length sits in the gap after the
    // word (e.g. on the following space), which is not inside the word.
    if (caret >= idx && caret < idx + word.length) {
      return { from: blockStart + idx, to: blockStart + idx + word.length }
    }
    idx = text.indexOf(word, idx + 1)
  }
  return null
}

// Backspace command: when the cursor is immediately after an atom inline
// node (image), delete it in a single keystroke instead of the default
// two-press select-then-delete. Link/text deletion intentionally falls
// through to default char-by-char behavior so backspace doesn't surprise
// the user by wiping a whole link when they typed adjacent content.
function deleteReferenceBackward(
  state: import('prosemirror-state').EditorState,
  dispatch?: (tr: import('prosemirror-state').Transaction) => void
): boolean {
  if (!state.selection.empty) return false
  const $pos = state.selection.$from
  const before = $pos.nodeBefore
  if (!before) return false
  // Non-text atom inline (image, hard_break, mention) — wipe in one stroke.
  // Text nodes are leaves too (Node.isAtom === true), hence the isText guard.
  if (!before.isText && before.isAtom && before.isInline) {
    if (dispatch) dispatch(state.tr.delete($pos.pos - before.nodeSize, $pos.pos))
    return true
  }
  // Linked text immediately before cursor — but only fire if the cursor
  // sits on the link's RIGHT boundary (nodeAfter has no link mark). When
  // the user has extended the link by typing into it, nodeAfter would
  // still carry the link mark and we let the default char-delete run.
  if (!before.isText) return false
  const linkType = state.schema.marks.link
  if (!linkType) return false
  const link = before.marks.find((m) => m.type === linkType)
  if (!link) return false
  const after = $pos.nodeAfter
  if (after?.marks.some((m) => m.type === linkType && m.eq(link))) {
    return false
  }
  const endPos = $pos.pos
  let start = endPos
  let idx = $pos.index()
  while (idx > 0) {
    const node = $pos.parent.child(idx - 1)
    if (!node.isText) break
    const nodeLink = node.marks.find((m) => m.type === linkType)
    if (!nodeLink || !nodeLink.eq(link)) break
    start -= node.nodeSize
    idx--
  }
  if (start === endPos) return false
  if (dispatch) dispatch(state.tr.delete(start, endPos))
  return true
}

// Parse a markdown snippet through Milkdown's commonmark parser and splice
// it into the doc at the drop coordinates.
//
// Single-block drops (one file → one paragraph from the parser) insert their
// inline content directly so the surrounding paragraph is preserved — drop
// in the middle of "hello | world" produces "hello LINK world" on the same
// line. Multi-block drops (multiple files joined with blank lines) fall back
// to slice-replace which intentionally splits the host paragraph.
//
// After the insert, a cursor sitting inside a `link` mark range would make
// every subsequent keystroke render as a link; we append a plain space and
// position the cursor past it so the user can continue typing in plain text.
function insertMarkdownAt(
  view: EditorView,
  event: DragEvent,
  markdown: string,
  ctx: ParserCtxGetter
): void {
  let parsed: PMNode | null
  try {
    parsed = ctx.get(parserCtx)(markdown)
  } catch {
    return
  }
  if (!parsed) return
  const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
  const pos = coords?.pos ?? view.state.selection.from

  const tr = view.state.tr
  let cursorPos: number

  let highlightFrom = pos
  let highlightTo: number

  if (parsed.childCount === 1 && parsed.firstChild?.isTextblock) {
    // Inline-merge into the surrounding paragraph — keeps image and link
    // drops inline with the host text. The image visually wraps to its own
    // line thanks to `max-width: 100%` CSS, but the markdown source stays
    // a single paragraph (no extra blank line separators).
    const inline = parsed.firstChild.content

    // If the cursor sits immediately after a non-whitespace character,
    // prepend a plain space so the dropped item doesn't glue onto the
    // preceding text (keeps both the markdown source and the rendered
    // output legible). Use the resolved position BEFORE the replaceWith
    // so we read the host content, not the just-inserted node.
    const $beforeInsert = tr.doc.resolve(pos)
    const nodeBefore = $beforeInsert.nodeBefore
    const lastChar = nodeBefore?.isText ? (nodeBefore.text?.slice(-1) ?? '') : ''
    const needsLeadingSpace = lastChar !== '' && !/\s/.test(lastChar)
    let insertPos = pos
    if (needsLeadingSpace) {
      tr.insert(insertPos, view.state.schema.text(' '))
      insertPos += 1
      highlightFrom += 1
    }

    tr.replaceWith(insertPos, insertPos, inline)
    // Use tr.mapping.map(insertPos, 1) to get the actual end of the
    // inserted content in the new doc. `inline.size` undercounts when PM
    // wraps the inline content in a new block (e.g. dropping at a
    // doc-level position where inline content can't live directly).
    const insertedEnd = tr.mapping.map(insertPos, 1)
    cursorPos = insertedEnd
    highlightTo = insertedEnd

    // For link drops (non-image), append a plain space after so the cursor
    // lands outside the link-mark range and the user can continue typing
    // without the link styling bleeding. Checking the inserted fragment
    // directly is more reliable than $end.marks() — the latter returns
    // nothing when PM wraps the inline content in a fresh paragraph.
    let hasLink = false
    inline.descendants((n) => {
      if (n.marks.some((m) => m.type.name === 'link')) hasLink = true
    })
    if (hasLink) {
      tr.insert(cursorPos, view.state.schema.text(' '))
      cursorPos += 1
    }
  } else {
    // Multi-block: keep the original block-fitting behavior.
    const slice = new Slice(parsed.content, 1, 1)
    tr.replace(pos, pos, slice)
    cursorPos = Math.min(pos + slice.size, tr.doc.content.size)
    highlightTo = cursorPos
  }
  tr.setMeta(justInsertedPluginKey, {
    type: 'add',
    ranges: [{ from: highlightFrom, to: highlightTo }],
  })
  tr.setSelection(TextSelection.near(tr.doc.resolve(cursorPos)))
  tr.setStoredMarks([])
  view.dispatch(tr)
  // Clear the decoration after the animation completes so highlights don't
  // accumulate when the user drops multiple files in sequence.
  setTimeout(() => {
    view.dispatch(view.state.tr.setMeta(justInsertedPluginKey, { type: 'clear' }))
  }, 500)
}

export function LiveMarkdown(props: Props) {
  return (
    <MilkdownProvider>
      <LiveMarkdownInner key={String(props.remountKey)} {...props} />
    </MilkdownProvider>
  )
}

function LiveMarkdownInner({
  body,
  onChange,
  onLinkClick,
  filePath,
  paletteItems,
  onOpenFind,
  onViewReady,
  onImportToast,
  onSendSelection,
  agentKind = 'codex',
}: Props) {
  const vaultPath = useAppContext().vaultPath ?? ''
  // Refs avoid re-creating the editor on every change of these props.
  const onChangeRef = useRef(onChange)
  const onLinkClickRef = useRef(onLinkClick)
  // Drop handler refs — captured by the ProseMirror plugin closure, but the
  // plugin is built once per mount so we read the latest prop via these.
  const filePathRef = useRef(filePath)
  const vaultPathRef = useRef(vaultPath)
  const onImportToastRef = useRef(onImportToast)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])
  useEffect(() => {
    onLinkClickRef.current = onLinkClick
  }, [onLinkClick])
  useEffect(() => {
    filePathRef.current = filePath
  }, [filePath])
  useEffect(() => {
    vaultPathRef.current = vaultPath
  }, [vaultPath])
  useEffect(() => {
    onImportToastRef.current = onImportToast
  }, [onImportToast])

  // `@`-mention picker state. The trigger plugin (built once per mount) keeps
  // its TriggerState inside the ProseMirror plugin state and pushes lifecycle
  // updates here through a ref-backed setter — same pattern as the drop /
  // import-toast refs above, so the plugin closure can read the latest
  // setState without rebuilding the plugin on every render.
  const [mention, setMention] = useState<{
    from: number
    query: string
    anchor: { x: number; y: number }
  } | null>(null)
  const setMentionRef = useRef(setMention)
  useEffect(() => {
    setMentionRef.current = setMention
  }, [])

  // Built once per mount alongside the rest of the editor's plugin stack.
  // `useMemo` (rather than module scope) so test contracts asserting
  // `search()` and `keymap()` were invoked during render keep working.
  // `onOpenFind` is expected to be a stable setter from the parent (typically
  // `useState`'s setFindMode), so closing over it inside the keymap callbacks
  // is safe even with an empty dependency list.
  const searchPlugin = useMemo(() => search(), [])
  // Built once per mount. Callbacks dispatch through `setMentionRef` so the
  // plugin closure always sees the latest React state setter even though the
  // plugin itself is referentially stable across renders.
  const mentionPlugin = useMemo(
    () =>
      mentionTrigger({
        onOpen: (from, anchor) => setMentionRef.current({ from, query: '', anchor }),
        onUpdate: (query, anchor) =>
          setMentionRef.current((prev) => (prev ? { ...prev, query, anchor } : prev)),
        onClose: () => setMentionRef.current(null),
      }),
    []
  )
  /* eslint-disable react-hooks/exhaustive-deps -- intentional: keymap is
     registered once per editor mount; onOpenFind from useState is
     referentially stable across renders. */
  const findKeymap = useMemo(
    () =>
      keymap({
        'Mod-f': () => {
          onOpenFind?.('find')
          return true
        },
        'Mod-Alt-f': () => {
          onOpenFind?.('replace')
          return true
        },
        // Cmd+G / Shift+Cmd+G: navigate matches without re-opening the bar.
        // Mirrors the CodeMirror searchKeymap bindings for parity.
        'Mod-g': findNext,
        'Shift-Mod-g': findPrev,
      }),
    []
  )
  /* eslint-enable react-hooks/exhaustive-deps */

  // We freeze the initial value at mount; further updates come from typing.
  // External changes are handled by remountKey causing a full remount.
  // Wikilinks `[[X]]` get pre-processed into a `wikilink:` URI scheme so
  // Milkdown can render them as ordinary `<a>` elements; the click handler
  // recognizes the scheme. The inverse is applied on every emit so the
  // saved file preserves the original `[[X]]` form.
  const initial = useMemo(() => parseWikilinks(body), [])
  // ^ intentional: only first body matters for initialization
  // (eslint-disable-next-line react-hooks/exhaustive-deps)

  // Built once per mount. `remountKey` (the file path) drives remounts on
  // file switches, so the closure here is always for the active file.
  const imageView = useMemo(
    () => imageNodeView({ filePath, vaultPath, paletteItems }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // Render-only mermaid diagrams in Page mode. A `$view` over the existing
  // `code_block` node — renders when the fence language is `mermaid`, falls
  // through to an editable code view otherwise. No schema change, so the fence
  // round-trips losslessly.
  const mermaidView = useMemo(() => mermaidNodeView(), [])

  // Render-only checkbox for GFM task-list items in Page mode. A `$view` over
  // the `list_item` node — renders a real `<input type="checkbox">` when the
  // item carries a `checked` attr, falls through to a plain `<li>` otherwise.
  // No schema change, so `- [ ]` / `- [x]` round-trips losslessly.
  const taskListView = useMemo(() => taskListNodeView(), [])

  const editorInfo = useEditor((root) => {
    return MilkdownEditor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, initial)
        ctx.update(editorViewOptionsCtx, (prev) => ({
          ...prev,
          attributes: { class: 'milkdown-host' },
        }))

        // Drop plugin — accepts files from Finder/OS and internal drags from
        // the Marvinz file tree, mirroring Editor.tsx's CodeMirror handler.
        // Inserting markdown goes through Milkdown's commonmark parser so the
        // image / link nodes render immediately instead of appearing as
        // literal text. Refs let the plugin closure read the latest props
        // even though it's built once per mount.
        const dropPlugin = new Plugin({
          props: {
            handleDOMEvents: {
              dragover(_view, event) {
                const types = event.dataTransfer?.types ?? []
                if (
                  !types.includes('Files') &&
                  !types.includes(MARVIN_PATH_MIME) &&
                  !types.includes(MARVIN_PATHS_MIME)
                )
                  return false
                event.preventDefault()
                // 'move' suppresses the macOS green-plus copy badge while
                // staying compatible with the file tree's effectAllowed.
                if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
                return true
              },
              drop(view, event) {
                const dt = event.dataTransfer
                if (!dt) return false
                const internalPaths = readDraggedPaths(dt)
                const files = collectFiles(dt)
                if (internalPaths.length > 0) {
                  event.preventDefault()
                  event.stopPropagation()
                  // Multi-drag: one markdown line per path joined by '\n' so
                  // the parser produces N successive blocks and the whole
                  // drop lands in a single PM transaction (undo-atomic).
                  const md = internalPaths
                    .map((p) => internalDragMarkdown(filePathRef.current, p))
                    .join('\n')
                  insertMarkdownAt(view, event, md, ctx)
                  return true
                }
                if (files.length > 0) {
                  event.preventDefault()
                  event.stopPropagation()
                  void (async () => {
                    const outcome = await persistDroppedFiles({
                      files,
                      vaultPath: vaultPathRef.current,
                      notePath: filePathRef.current,
                      writeBinary: (p) => window.marvin.file.writeBinary(p),
                      onToast: onImportToastRef.current,
                    })
                    if (outcome.inserts.length > 0) {
                      insertMarkdownAt(view, event, outcome.inserts.join('\n\n'), ctx)
                    }
                    emitSummaryToast(outcome, onImportToastRef.current)
                  })()
                  return true
                }
                return false
              },
            },
          },
        })

        // Use prosemirror-history directly via prosePluginsCtx. Avoids the
        // @milkdown/plugin-history path that broke the editor's SchemaReady
        // timer in our setup. Keymap registers Cmd/Ctrl+Z + Shift+Cmd/Ctrl+Z.
        ctx.update(prosePluginsCtx, (prev) => [
          ...prev,
          pmHistory(),
          keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo }),
          // Find / Replace: prosemirror-search owns the highlights + commands;
          // the parent-rendered find bar drives the search query and navigates
          // matches. Cmd+F / Cmd+Alt+F bubble up via `onOpenFind` and the
          // parent then drives the PM view through `onViewReady`.
          searchPlugin,
          findKeymap,
          // Smart Backspace — when the cursor sits on the right boundary of
          // a dropped reference (image atom or linked text), wipe the whole
          // reference in one stroke. Plain text typed past the boundary
          // (escaped by the trailing space we insert on drop) deletes
          // char-by-char via the default.
          keymap({ Backspace: deleteReferenceBackward }),
          justReplacedPlugin(),
          justInsertedPlugin(),
          // Visual caret that follows the cursor during a drag, so the user
          // sees exactly where the attachment will land.
          dropCursor({ color: 'var(--accent)', width: 2 }),
          dropPlugin,
          // `@`-mention trigger — emits lifecycle callbacks; the picker is
          // rendered conditionally below from React state.
          mentionPlugin,
        ])
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown, prevMarkdown) => {
          if (markdown !== prevMarkdown) onChangeRef.current(unparseWikilinks(markdown))
        })
      })
      .use(commonmark)
      .use(gfm)
      .use(listener)
      .use(imageView)
      .use(mermaidView)
      .use(taskListView)
      .use(taskListBracketInputRule)
  }, [])

  // Single delegated click handler for the editor surface — intercepts
  // <a> clicks so internal .md links open in a tab and external URLs go
  // through Electron's shell.openExternal handler.
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest?.('a') as HTMLAnchorElement | null
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href) return
      e.preventDefault()
      e.stopPropagation()
      // Default click navigates in-place (notes-app convention); Cmd/Ctrl
      // opens in a new tab.
      const openInNewTab = e.metaKey || e.ctrlKey
      onLinkClickRef.current(href, openInNewTab ? 'newTab' : 'replace')
    }
    el.addEventListener('click', onClick)
    return () => el.removeEventListener('click', onClick)
  }, [])

  const handleContextMenu = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      const editor = editorInfo.get()
      if (!editor) return
      let view
      try {
        view = editor.ctx.get(editorViewCtx)
      } catch {
        return
      }
      e.preventDefault()
      const state = view.state
      const hasSelection = !state.selection.empty
      // Native spellcheck context — main caches the last context-menu params
      // (misspelled word + dictionary suggestions). No range comes back, so we
      // resolve the word boundary around the caret below before replacing.
      // Both IPCs run in parallel to keep the menu round-trip snappy.
      // A rejected spellcheck IPC must not abort the whole menu — fall back to empty.
      const [canPaste, spell] = await Promise.all([
        window.marvin.app.canPaste(),
        window.marvin.editor
          .getSpellcheckContext()
          .catch(() => ({ misspelledWord: '', suggestions: [] as string[] })),
      ])
      const items: MenuItemSpec[] = []
      if (spell.misspelledWord && spell.suggestions.length > 0) {
        spell.suggestions.slice(0, 5).forEach((s, i) => {
          items.push({ kind: 'item', id: `spell:${i}`, label: s })
        })
        items.push({ kind: 'separator' })
      }
      items.push(
        {
          kind: 'item',
          id: 'cut',
          label: 'Cut',
          accelerator: 'CmdOrCtrl+X',
          enabled: hasSelection,
        },
        {
          kind: 'item',
          id: 'copy',
          label: 'Copy',
          accelerator: 'CmdOrCtrl+C',
          enabled: hasSelection,
        },
        {
          kind: 'item',
          id: 'paste',
          label: 'Paste',
          accelerator: 'CmdOrCtrl+V',
          enabled: canPaste,
        },
        { kind: 'separator' },
        { kind: 'item', id: 'selectAll', label: 'Select All', accelerator: 'CmdOrCtrl+A' },
        { kind: 'separator' },
        {
          kind: 'item',
          id: 'undo',
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          enabled: undoDepth(state) > 0,
        },
        {
          kind: 'item',
          id: 'redo',
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          enabled: redoDepth(state) > 0,
        }
      )
      const action = await window.marvin.app.showContextMenu(items)
      if (!action) return
      if (action.startsWith('spell:')) {
        const replacement = spell.suggestions[Number(action.slice(6))]
        if (replacement) {
          // Snapshot state once: range offsets and the transaction must share
          // the same document, or a dispatch between the two reads shifts them.
          const currentState = view.state
          const range = misspelledWordRange(currentState, spell.misspelledWord)
          // insertText replaces the range and inherits its marks, so adjacent
          // bold/link formatting on the word survives the correction.
          if (range) view.dispatch(currentState.tr.insertText(replacement, range.from, range.to))
        }
        view.focus()
        return
      }
      switch (action) {
        case 'selectAll':
          selectAll(view.state, view.dispatch, view)
          break
        case 'undo':
          undo(view.state, view.dispatch)
          break
        case 'redo':
          redo(view.state, view.dispatch)
          break
        case 'copy':
        case 'cut': {
          // Serialize the selected slice through Milkdown's clipboardSerializer
          // so formatting (bold, links, lists) survives cross-app paste via the
          // HTML clipboard channel. Text fallback is preserved for non-rich
          // targets and trims block separators so a single-paragraph copy
          // never forces a paragraph split on paste.
          const selection = view.state.selection
          if (selection.empty) break
          const slice = view.state.doc.slice(selection.from, selection.to)
          const serializer = view.someProp('clipboardSerializer')
          let html = ''
          if (serializer) {
            const dom = serializer.serializeFragment(slice.content)
            const wrapper = document.createElement('div')
            wrapper.appendChild(dom)
            html = wrapper.innerHTML
          }
          const text = view.state.doc
            .textBetween(selection.from, selection.to, '\n', '\n')
            .replace(/^\n+|\n+$/g, '')
          await window.marvin.editor.writeClipboardRich({ html, text })
          if (action === 'cut') view.dispatch(view.state.tr.deleteSelection())
          break
        }
        case 'paste': {
          // Prefer HTML so formatting survives — clipboardParser sanitizes by
          // dropping marks/nodes unsupported by the schema. Fall back to plain
          // text when no HTML payload is present (cross-app text-only sources).
          const { html, text } = await window.marvin.editor.readClipboardRich()
          if (html) {
            const dom = new DOMParser().parseFromString(html, 'text/html').body
            const parser = view.someProp('clipboardParser')
            if (parser) {
              const slice = parser.parseSlice(dom, { preserveWhitespace: 'full' })
              view.dispatch(view.state.tr.replaceSelection(slice))
              break
            }
          }
          if (text) view.dispatch(view.state.tr.insertText(text))
          break
        }
      }
      view.focus()
    },
    [editorInfo]
  )

  // Uses the live selection head as the upper bound because PM state lags
  // React state by one render tick — `mention.query` may be one keystroke
  // behind by the time the user clicks.
  const handleMentionSelect = useCallback(
    (item: PaletteItem) => {
      const editor = editorInfo.get()
      if (!editor || !mention) {
        setMention(null)
        return
      }
      let view: EditorView
      try {
        view = editor.ctx.get(editorViewCtx) as EditorView
      } catch {
        setMention(null)
        return
      }
      const to = view.state.selection.from
      const insertText = mentionInsertText(item, filePathRef.current)
      const wikiMarkdown = parseWikilinks(insertText)
      let parsed: PMNode | null
      try {
        parsed = editor.ctx.get(parserCtx)(wikiMarkdown)
      } catch {
        parsed = null
      }
      // Expected shape: paragraph > inline node (link, image, or text).
      // Anything else means the parser couldn't produce that node — fall
      // back to a literal-text insert so the user at least sees the raw
      // markdown and can recover via mode-switch round-trip.
      const inlineNode = parsed?.firstChild?.firstChild
      let tr = view.state.tr
      let cursorAdvance: number
      if (inlineNode) {
        tr = tr.replaceWith(mention.from, to, inlineNode)
        cursorAdvance = inlineNode.nodeSize
      } else {
        console.warn(
          '[mention] parserCtx returned an unexpected shape; falling back to literal text insert',
          { wikiMarkdown }
        )
        tr = tr.replaceWith(mention.from, to, view.state.schema.text(insertText))
        cursorAdvance = insertText.length
      }
      tr.setSelection(TextSelection.near(tr.doc.resolve(mention.from + cursorAdvance)))
      tr.setStoredMarks([])
      view.dispatch(tr)
      setMention(null)
      view.focus()
    },
    [editorInfo, mention]
  )
  const handleMentionDismiss = useCallback(() => setMention(null), [])

  // Push the live EditorView to the parent so it can drive search commands
  // from the header-mounted find bar. Fires whenever the editor info resolves
  // a view (typically once per mount) and clears on unmount.
  const onViewReadyRef = useRef(onViewReady)
  useEffect(() => {
    onViewReadyRef.current = onViewReady
  }, [onViewReady])
  useEffect(() => {
    const editor = editorInfo.get()
    if (!editor) return
    try {
      const view = editor.ctx.get(editorViewCtx) as EditorView
      onViewReadyRef.current?.(view)
    } catch {
      // View not ready yet — useEditor will re-run and we'll catch it next pass.
    }
    return () => {
      onViewReadyRef.current?.(null)
    }
  }, [editorInfo])

  // Selection chip — pinned to viewport coords from Range.getBoundingClientRect.
  const [selectionRect, setSelectionRect] = useState<{
    left: number
    right: number
    top: number
    bottom: number
  } | null>(null)
  useEffect(() => {
    if (!onSendSelection) return
    let debounceId: number | null = null
    const evaluate = () => {
      debounceId = null
      const root = containerRef.current
      if (!root) {
        setSelectionRect(null)
        return
      }
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.toString() === '') {
        setSelectionRect(null)
        return
      }
      const anchor = sel.anchorNode
      if (!anchor || !root.contains(anchor)) {
        setSelectionRect(null)
        return
      }
      const range = sel.getRangeAt(0)
      // Pick the last non-empty client rect (trailing edge of selection on its final line).
      // Skips zero-width caret rects ProseMirror emits at paragraph boundaries — those
      // collapse to the right edge of the formatting context, pulling the chip far off.
      // Bounding rect would be the union of all lines, placing the chip past the longest line.
      const rects = range.getClientRects()
      let rect: DOMRect | null = null
      for (let i = rects.length - 1; i >= 0; i--) {
        if (rects[i].width > 0 && rects[i].height > 0) {
          rect = rects[i]
          break
        }
      }
      if (!rect) rect = range.getBoundingClientRect()
      setSelectionRect(
        clampToViewport({
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        })
      )
    }
    const onSelectionChange = () => {
      if (debounceId !== null) window.clearTimeout(debounceId)
      // ~50ms debounce keeps the chip steady during drag-to-extend selections.
      debounceId = window.setTimeout(evaluate, 50)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      if (debounceId !== null) window.clearTimeout(debounceId)
    }
  }, [onSendSelection])

  const handleChipClick = useCallback(() => {
    if (!onSendSelection) return
    const text = window.getSelection()?.toString()
    if (!text) return
    const formatted = formatSelectionForAgent(text, agentKind)
    if (formatted === '') return
    // Best-effort: locate the rendered selection in the markdown source by substring
    // match. Works for plain text; fails (gracefully → no range) for selections that
    // include markdown decorations stripped during render (bold, headings, etc.).
    const range = findSelectionLineRange(text, body)
    const pathRef = range ? `${filePath}:${range}` : filePath
    const prefix = agentKind === 'codex' ? `@${pathRef}` : pathRef
    onSendSelection(`${prefix}\n\n${formatted}`)
  }, [onSendSelection, agentKind, filePath, body])

  return (
    <div ref={containerRef} className="live-md" onContextMenu={handleContextMenu}>
      <Milkdown />
      {mention && (
        <MentionPicker
          query={mention.query}
          items={paletteItems}
          anchor={mention.anchor}
          onSelect={handleMentionSelect}
          onDismiss={handleMentionDismiss}
        />
      )}
      {selectionRect && onSendSelection && (
        <EditorSelectionChip coords={selectionRect} onClick={handleChipClick} />
      )}
    </div>
  )
}
