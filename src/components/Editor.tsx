import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import { search } from '@codemirror/search'
import { bracketMatching, indentUnit } from '@codemirror/language'
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
  const [value, setValue] = useState(initialContent)
  const [mode, setMode] = useState<Mode>('preview')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [langExt, setLangExt] = useState<Extension | null>(null)
  const timer = useRef<number | null>(null)
  const latestValue = useRef(initialContent)

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
    const base = [search(), bracketMatching(), indentUnit.of('  '), EditorView.lineWrapping]
    return langExt ? [...base, langExt] : base
  }, [langExt])

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
            <Icon name="chevron-left"/>
          </button>
          <button
            type="button"
            className="nav-btn"
            disabled={!canForward}
            onClick={onForward}
            title="Forward"
            aria-label="Forward"
          >
            <Icon name="chevron-right"/>
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
          theme="dark"
          extensions={extensions}
          onChange={handleSourceChange}
          basicSetup={{
            lineNumbers: true,
            foldGutter: false,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
          }}
          className="cm-host"
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
              remountKey={liveKey}
            />
          </div>
        </div>
      )}
    </div>
  )
}
