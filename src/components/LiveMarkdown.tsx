import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Editor as MilkdownEditor,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
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
import type { EditorView } from 'prosemirror-view'
import { imageNodeView } from '../lib/imageNodeView'
import { justReplacedPlugin } from '../lib/pmJustReplacedHighlight'
import type { PaletteItem } from '../lib/paletteRanker'
import { parseWikilinks, unparseWikilinks } from '../lib/wikilinks'

type Props = {
  /** Markdown body (without frontmatter) to render. */
  body: string
  /** Fired whenever the user edits content. Receives the new markdown. */
  onChange: (markdown: string) => void
  /** Click handler for `<a>` elements rendered inside the editor. */
  onLinkClick: (href: string, modifier: 'replace' | 'newTab') => void
  /** Absolute path of the file being edited — base for relative image resolution. */
  filePath: string
  /** Vault root, used for `/`-prefix image paths and the inside-vault check. */
  vaultPath: string
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
  vaultPath,
  paletteItems,
  onOpenFind,
  onViewReady,
}: Props) {
  // Refs avoid re-creating the editor on every change of these props.
  const onChangeRef = useRef(onChange)
  const onLinkClickRef = useRef(onLinkClick)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])
  useEffect(() => {
    onLinkClickRef.current = onLinkClick
  }, [onLinkClick])

  // Built once per mount alongside the rest of the editor's plugin stack.
  // `useMemo` (rather than module scope) so test contracts asserting
  // `search()` and `keymap()` were invoked during render keep working.
  // `onOpenFind` is expected to be a stable setter from the parent (typically
  // `useState`'s setFindMode), so closing over it inside the keymap callbacks
  // is safe even with an empty dependency list.
  const searchPlugin = useMemo(() => search(), [])
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
    [],
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
    [],
  )

  const editorInfo = useEditor((root) => {
    return MilkdownEditor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, initial)
        ctx.update(editorViewOptionsCtx, (prev) => ({
          ...prev,
          attributes: { class: 'milkdown-host' },
        }))
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
          justReplacedPlugin(),
        ])
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown, prevMarkdown) => {
          if (markdown !== prevMarkdown) onChangeRef.current(unparseWikilinks(markdown))
        })
      })
      .use(commonmark)
      .use(gfm)
      .use(listener)
      .use(imageView)
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
      const canPaste = await window.marvin.app.canPaste()
      const action = await window.marvin.app.showContextMenu([
        { kind: 'item', id: 'cut', label: 'Cut', accelerator: 'CmdOrCtrl+X', enabled: hasSelection },
        { kind: 'item', id: 'copy', label: 'Copy', accelerator: 'CmdOrCtrl+C', enabled: hasSelection },
        { kind: 'item', id: 'paste', label: 'Paste', accelerator: 'CmdOrCtrl+V', enabled: canPaste },
        { kind: 'separator' },
        { kind: 'item', id: 'selectAll', label: 'Select All', accelerator: 'CmdOrCtrl+A' },
        { kind: 'separator' },
        { kind: 'item', id: 'undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z', enabled: undoDepth(state) > 0 },
        { kind: 'item', id: 'redo', label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', enabled: redoDepth(state) > 0 },
      ])
      if (!action) return
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
          // Synthetic ClipboardEvent has isTrusted=false and Chromium blocks
          // access to the system clipboard for such events. Use the Electron
          // clipboard module via IPC instead. Trim leading/trailing newlines so
          // a single-paragraph copy never carries a trailing block separator
          // that would force a paragraph split on paste.
          const selection = view.state.selection
          if (selection.empty) break
          const text = view.state.doc
            .textBetween(selection.from, selection.to, '\n', '\n')
            .replace(/^\n+|\n+$/g, '')
          await window.marvin.editor.writeClipboard(text)
          if (action === 'cut') view.dispatch(view.state.tr.deleteSelection())
          break
        }
        case 'paste': {
          const text = await window.marvin.editor.readClipboard()
          if (text) view.dispatch(view.state.tr.insertText(text))
          break
        }
      }
      view.focus()
    },
    [editorInfo],
  )

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

  return (
    <div ref={containerRef} className="live-md" onContextMenu={handleContextMenu}>
      <Milkdown />
    </div>
  )
}
