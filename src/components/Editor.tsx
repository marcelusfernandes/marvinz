import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

type Props = {
  filePath: string
  vaultPath: string
  initialContent: string
  onSave: (content: string) => Promise<void>
  onOpenNote: (path: string) => void
  canBack: boolean
  canForward: boolean
  onBack: () => void
  onForward: () => void
}

type Mode = 'edit' | 'preview'

const SAVE_DEBOUNCE_MS = 600

function resolveLink(href: string, currentFile: string, vaultPath: string): string | null {
  if (!href) return null
  if (href.startsWith('/')) {
    return href.startsWith(vaultPath) ? href : null
  }
  const currentDir = currentFile.replace(/\/[^/]+$/, '')
  const segments = href.split('/')
  const stack = currentDir.split('/')
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
  onSave,
  onOpenNote,
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

  const mdComponents = useMemo<Components>(
    () => ({
      a({ href, children, ...rest }) {
        const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
          e.preventDefault()
          if (!href) return
          if (/^(https?|mailto):/i.test(href)) {
            void window.marvin.shell.openExternal(href)
            return
          }
          const cleanHref = href.split(/[?#]/)[0]
          if (!cleanHref) return
          const resolved = resolveLink(cleanHref, filePath, vaultPath)
          if (resolved && resolved.endsWith('.md')) {
            onOpenNote(resolved)
          }
        }
        return (
          <a href={href} onClick={handleClick} {...rest}>
            {children}
          </a>
        )
      },
    }),
    [filePath, vaultPath, onOpenNote],
  )

  const handleChange = (next: string) => {
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
  }

  const fileName = filePath.split('/').pop()?.replace(/\.(md|markdown)$/i, '') ?? ''

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
            ‹
          </button>
          <button
            type="button"
            className="nav-btn"
            disabled={!canForward}
            onClick={onForward}
            title="Forward"
            aria-label="Forward"
          >
            ›
          </button>
          <span className="editor-title">{fileName}</span>
        </div>
        <div className="editor-header-right">
          <span className="editor-status">
            {saving ? 'Saving…' : savedAt ? 'Saved' : ''}
          </span>
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
        </div>
      </div>
      {mode === 'edit' ? (
        <CodeMirror
          value={value}
          height="100%"
          theme="dark"
          extensions={[markdown(), EditorView.lineWrapping]}
          onChange={handleChange}
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
          }}
          className="cm-host"
        />
      ) : (
        <div className="md-preview">
          <div className="md-preview-inner">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {value}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  )
}
