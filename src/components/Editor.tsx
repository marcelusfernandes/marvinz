import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import { search } from '@codemirror/search'
import { bracketMatching, indentUnit, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { redo, redoDepth, selectAll, undo, undoDepth } from '@codemirror/commands'
import { tags as t } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'
import { languageIdFor, loadLanguage } from '../lib/cmLanguage'
import {
  replaceFrontmatter,
  serializeFrontmatter,
  splitFrontmatter,
  type Frontmatter,
} from '../lib/frontmatter'
import { Properties } from './Properties'
import { LiveMarkdown } from './LiveMarkdown'
import { CsvEditor } from './CsvEditor'
import { HtmlPreview } from './HtmlPreview'
import { PathSuggest } from './PathSuggest'
import type { PaletteItem } from '../lib/paletteRanker'
import { isWikilinkHref, resolveWikilink } from '../lib/wikilinks'
import { Icon } from './Icon'
import { useVisualStyle } from '../lib/visualStyle'

const codeHighlightStyle = HighlightStyle.define([
  // Language tokens (TS/JS/JSON/etc.)
  { tag: t.keyword, color: 'var(--code-keyword)' },
  { tag: [t.controlKeyword, t.moduleKeyword, t.definitionKeyword], color: 'var(--code-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--code-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--code-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--code-function)' },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--code-property)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [t.tagName, t.attributeName], color: 'var(--code-tag)' },
  { tag: t.operator, color: 'var(--code-operator)' },

  // Markdown-specific — heading scale mirrors a typical editor (Obsidian/Bear).
  { tag: t.heading1, fontWeight: '700', fontSize: '1.428em', color: 'var(--text-primary)' },
  { tag: t.heading2, fontWeight: '700', fontSize: '1.143em', color: 'var(--text-primary)' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: '600', color: 'var(--text-primary)' },
  { tag: t.strong, fontWeight: '700', color: 'var(--text-primary)' },
  { tag: t.emphasis, fontStyle: 'italic', color: 'var(--text-primary)' },
  { tag: [t.link, t.url], color: 'var(--accent)' },
  { tag: t.monospace, color: 'var(--code-string)' },
  { tag: t.quote, color: 'var(--text-secondary)', fontStyle: 'italic' },
  // Markup characters (#, **, _, ~, ---) — kept subtle so they fade beside content.
  { tag: t.processingInstruction, color: 'var(--text-tertiary)' },
  { tag: t.contentSeparator, color: 'var(--text-tertiary)' },
  { tag: t.meta, color: 'var(--text-tertiary)' },
])

const legacyCodeHighlightStyle = HighlightStyle.define([
  // Language tokens (TS/JS/JSON/etc.)
  { tag: t.keyword, color: 'var(--code-keyword)' },
  { tag: [t.controlKeyword, t.moduleKeyword, t.definitionKeyword], color: 'var(--code-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--code-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--code-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--code-function)' },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--code-property)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [t.tagName, t.attributeName], color: 'var(--code-tag)' },
  { tag: t.operator, color: 'var(--code-operator)' },

  // Markdown-specific — single t.heading rule (legacy style, no per-level sizes).
  { tag: t.heading, fontWeight: 'bold', color: 'var(--text-primary)' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: [t.link, t.url], color: 'var(--accent)' },
  { tag: t.monospace, color: 'var(--code-string)' },
  { tag: t.quote, color: 'var(--text-secondary)', fontStyle: 'italic' },
  { tag: t.processingInstruction, color: 'var(--text-tertiary)' },
  { tag: t.contentSeparator, color: 'var(--text-tertiary)' },
])

type Props = {
  filePath: string
  vaultPath: string
  initialContent: string
  /** Cache-buster for surfaces that render the file via a URL (HtmlPreview).
   * Bumped by App.tsx whenever the file is saved or changes externally. */
  version: number
  /** Forwarded to HtmlPreview so the embedded WebContentsView re-anchors
   * after pure-position layout shifts. */
  geometryKey: string | number
  paletteItems: PaletteItem[]
  onSave: (content: string) => Promise<void>
  onBufferChange?: (content: string) => void
  onNavigate: (path: string, replaceCurrent: boolean) => void
  canBack: boolean
  canForward: boolean
  onBack: () => void
  onForward: () => void
}

type Mode = 'edit' | 'preview'

const SAVE_DEBOUNCE_MS = 600

function resolveLink(href: string, currentFile: string, vaultPath: string): string | null {
  if (!href) return null
  // `/`-prefix → vault-root-relative; else → file-relative.
  const baseDir = href.startsWith('/') ? vaultPath : currentFile.replace(/\/[^/]+$/, '')
  const segments = href.split('/')
  const stack = baseDir.split('/')
  for (const seg of segments) {
    if (seg === '..') stack.pop()
    else if (seg !== '.' && seg !== '') stack.push(seg)
  }
  const resolved = stack.join('/')
  return resolved.startsWith(vaultPath) ? resolved : null
}

export function Editor({
  filePath,
  vaultPath,
  initialContent,
  version,
  geometryKey,
  paletteItems,
  onSave,
  onBufferChange,
  onNavigate,
  canBack,
  canForward,
  onBack,
  onForward,
}: Props) {
  const visualStyle = useVisualStyle()
  const [value, setValue] = useState(initialContent)
  const [mode, setMode] = useState<Mode>('preview')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [langExt, setLangExt] = useState<Extension | null>(null)
  const timer = useRef<number | null>(null)
  const latestValue = useRef(initialContent)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    setLangExt(null)
    const id = languageIdFor(filePath)
    if (!id) return
    let cancelled = false
    loadLanguage(id).then((ext) => {
      if (!cancelled) setLangExt(ext)
    })
    return () => {
      cancelled = true
    }
  }, [filePath])

  const extensions = useMemo(() => {
    const style = visualStyle === 'legacy' ? legacyCodeHighlightStyle : codeHighlightStyle
    const base = [
      search(),
      bracketMatching(),
      indentUnit.of('  '),
      EditorView.lineWrapping,
      syntaxHighlighting(style),
    ]
    return langExt ? [...base, langExt] : base
  }, [langExt, visualStyle])

  useEffect(() => {
    setValue(initialContent)
    latestValue.current = initialContent
    setSavedAt(null)
  }, [filePath, initialContent])

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [])

  const scheduleSave = useCallback(
    (next: string) => {
      setValue(next)
      latestValue.current = next
      onBufferChange?.(next)
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(async () => {
        setSaving(true)
        try {
          await onSave(latestValue.current)
          setSavedAt(Date.now())
        } finally {
          setSaving(false)
        }
      }, SAVE_DEBOUNCE_MS)
    },
    [onSave, onBufferChange],
  )

  const handleSourceChange = useCallback(
    (next: string) => {
      scheduleSave(next)
    },
    [scheduleSave],
  )

  // Live-preview body changes: keep the current frontmatter, replace the body.
  const handleBodyChange = useCallback(
    (newBody: string) => {
      const { data } = splitFrontmatter(latestValue.current)
      if (!data) {
        scheduleSave(newBody)
        return
      }
      const yaml = serializeFrontmatter(data)
      scheduleSave(`---\n${yaml}\n---\n\n${newBody}`)
    },
    [scheduleSave],
  )

  // Properties changes: replace the frontmatter, keep the body untouched.
  const handlePropertiesChange = useCallback(
    (nextData: Frontmatter | null) => {
      const next = replaceFrontmatter(latestValue.current, nextData)
      scheduleSave(next)
    },
    [scheduleSave],
  )

  const handleLinkClick = useCallback(
    (href: string, modifier: 'replace' | 'newTab') => {
      if (/^(https?|mailto):/i.test(href)) {
        void window.marvin.shell.openExternal(href)
        return
      }
      const wikilink = isWikilinkHref(href)
      if (wikilink) {
        const target = resolveWikilink(wikilink.name, filePath, vaultPath, paletteItems)
        if (target) onNavigate(target, modifier === 'replace')
        return
      }
      const cleanHref = href.split(/[?#]/)[0]
      if (!cleanHref) return
      const resolved = resolveLink(cleanHref, filePath, vaultPath)
      if (resolved) {
        onNavigate(resolved, modifier === 'replace')
      }
    },
    [filePath, vaultPath, paletteItems, onNavigate],
  )

  const handleContextMenu = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    const view = viewRef.current
    if (!view) return
    // Only handle right-clicks inside the editor's content surface; let the
    // browser show its default menu for clicks on gutters or other chrome.
    if (!view.contentDOM.contains(e.target as Node)) return
    e.preventDefault()
    const state = view.state
    const hasSelection = state.selection.ranges.some((r) => !r.empty)
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
        selectAll(view)
        break
      case 'undo':
        undo(view)
        break
      case 'redo':
        redo(view)
        break
      case 'copy':
      case 'cut': {
        // Synthetic ClipboardEvent has isTrusted=false and Chromium blocks
        // access to the system clipboard for such events. Use the Electron
        // clipboard module via IPC instead.
        const { from, to } = view.state.selection.main
        if (from === to) break
        const text = view.state.sliceDoc(from, to)
        await window.marvin.editor.writeClipboard(text)
        if (action === 'cut') view.dispatch(view.state.replaceSelection(''))
        break
      }
      case 'paste': {
        const text = await window.marvin.editor.readClipboard()
        if (text) view.dispatch(view.state.replaceSelection(text))
        break
      }
    }
    view.focus()
  }, [])

  const isMd = /\.(md|markdown)$/i.test(filePath)
  const isCsv = /\.(csv|tsv)$/i.test(filePath)
  const isHtml = /\.(html|htm)$/i.test(filePath)
  const hasPreview = isMd || isCsv || isHtml
  const effectiveMode: Mode = hasPreview ? mode : 'edit'

  const relativePath = filePath.startsWith(vaultPath + '/')
    ? filePath.slice(vaultPath.length + 1)
    : filePath

  const { data: frontmatter, body: previewBody } = useMemo(
    () =>
      isMd && effectiveMode === 'preview'
        ? splitFrontmatter(value)
        : { data: null, body: value },
    [isMd, effectiveMode, value],
  )

  // Remount Milkdown only when the file changes (not on every keystroke);
  // typing edits are propagated through onChange and re-applied via React
  // state without forcing a re-init of the editor.
  const liveKey = filePath

  return (
    <div className="editor">
      <div className="editor-header">
        <div className="editor-header-left">
          <button
            type="button"
            className="nav-btn"
            disabled={!canBack}
            onClick={onBack}
            title="Back"
            aria-label="Back"
          >
            <Icon name="chevron-left" />
          </button>
          <button
            type="button"
            className="nav-btn"
            disabled={!canForward}
            onClick={onForward}
            title="Forward"
            aria-label="Forward"
          >
            <Icon name="chevron-right" />
          </button>
          <PathSuggest
            value={relativePath}
            items={paletteItems}
            onCommit={onNavigate}
          />
        </div>
        <div className="editor-header-right">
          <span className="editor-status">
            {saving ? 'Saving…' : savedAt ? 'Saved' : ''}
          </span>
          {isMd && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void window.marvin.file.exportPdf(filePath)}
              title="Export as PDF"
              aria-label="Export as PDF"
            >
              <Icon name="file-pdf" size={14} />
              Export PDF
            </button>
          )}
          {hasPreview && (
            <div className="mode-toggle" role="tablist">
              <button
                type="button"
                className={`mode-btn${mode === 'edit' ? ' active' : ''}`}
                onClick={() => setMode('edit')}
                title="Edit (raw)"
              >
                <Icon name="edit" size={14} />
                Edit
              </button>
              <button
                type="button"
                className={`mode-btn${mode === 'preview' ? ' active' : ''}`}
                onClick={() => setMode('preview')}
                title="Preview (rendered)"
              >
                <Icon name="eye" size={14} />
                Preview
              </button>
            </div>
          )}
        </div>
      </div>
      {effectiveMode === 'edit' ? (
        <CodeMirror
          value={value}
          height="100%"
          theme="none"
          extensions={extensions}
          onChange={handleSourceChange}
          onContextMenu={handleContextMenu}
          onCreateEditor={(view) => {
            viewRef.current = view
          }}
          basicSetup={{
            lineNumbers: true,
            foldGutter: false,
            highlightActiveLine: true,
            highlightActiveLineGutter: true,
          }}
          className={
            visualStyle === 'legacy'
              ? 'cm-host'
              : `cm-host ${isMd ? 'cm-host-prose' : 'cm-host-code'}`
          }
        />
      ) : isCsv ? (
        <CsvEditor
          filePath={filePath}
          initialContent={value}
          onChange={scheduleSave}
        />
      ) : isHtml ? (
        <HtmlPreview filePath={filePath} version={version} geometryKey={geometryKey} />
      ) : (
        <div className="md-preview">
          <div className="md-preview-inner">
            {frontmatter && (
              <Properties data={frontmatter} onChange={handlePropertiesChange} />
            )}
            <LiveMarkdown
              body={previewBody}
              onChange={handleBodyChange}
              onLinkClick={handleLinkClick}
              filePath={filePath}
              vaultPath={vaultPath}
              paletteItems={paletteItems}
              remountKey={liveKey}
            />
          </div>
        </div>
      )}
    </div>
  )
}
