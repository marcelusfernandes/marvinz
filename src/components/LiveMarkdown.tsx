import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Editor as MilkdownEditor,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  rootCtx,
} from '@milkdown/core'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import { history } from '@milkdown/plugin-history'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import { selectAll } from 'prosemirror-commands'
import { redo, redoDepth, undo, undoDepth } from 'prosemirror-history'
import { imageNodeView } from '../lib/imageNodeView'
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
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown, prevMarkdown) => {
          if (markdown !== prevMarkdown) onChangeRef.current(unparseWikilinks(markdown))
        })
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
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
      // Only intercept right-clicks on the ProseMirror content surface.
      if (!view.dom.contains(e.target as Node)) return
      e.preventDefault()
      const state = view.state
      const action = await window.marvin.editor.showContextMenu({
        hasSelection: !state.selection.empty,
        canUndo: undoDepth(state) > 0,
        canRedo: redoDepth(state) > 0,
      })
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
          // clipboard module via IPC instead.
          const selection = view.state.selection
          if (selection.empty) break
          const text = view.state.doc.textBetween(selection.from, selection.to, '\n', '\n')
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

  return (
    <div ref={containerRef} className="live-md" onContextMenu={handleContextMenu}>
      <Milkdown />
    </div>
  )
}
