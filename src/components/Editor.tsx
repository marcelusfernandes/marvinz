import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import {
  replaceFrontmatter,
  serializeFrontmatter,
  splitFrontmatter,
  type Frontmatter,
} from '../lib/frontmatter'
import { Properties } from './Properties'
import { LiveMarkdown } from './LiveMarkdown'
import { CsvEditor } from './CsvEditor'
import { PathSuggest } from './PathSuggest'
import type { PaletteItem } from '../lib/paletteRanker'
import { isWikilinkHref, resolveWikilink } from '../lib/wikilinks'
import { Icon } from './Icon'

type Props = {
  filePath: string
  vaultPath: string
  initialContent: string
  paletteItems: PaletteItem[]
  onSave: (content: string) => Promise<void>
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
  paletteItems,
  onSave,
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
  const timer = useRef<number | null>(null)
  const latestValue = useRef(initialContent)

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
    [onSave],
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
  const hasPreview = isMd || isCsv
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
            <Icon name="chevron-left" size={14} />
          </button>
          <button
            type="button"
            className="nav-btn"
            disabled={!canForward}
            onClick={onForward}
            title="Forward"
            aria-label="Forward"
          >
            <Icon name="chevron-right" size={14} />
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
                Edit
              </button>
              <button
                type="button"
                className={`mode-btn${mode === 'preview' ? ' active' : ''}`}
                onClick={() => setMode('preview')}
                title="Preview (rendered)"
              >
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
          extensions={isMd ? [markdown(), EditorView.lineWrapping] : [EditorView.lineWrapping]}
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
