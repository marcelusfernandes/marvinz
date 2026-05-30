import { useCallback, useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import { OFFICE_EDIT_ENABLED } from '../lib/featureFlags'
import { Icon } from './Icon'

type Props = {
  path: string
  /** Open in the system default app (Word, etc.) via Reveal in Finder. */
  onRevealInFinder?: (path: string) => void
}

function basename(p: string): string {
  return p.split('/').pop() ?? p
}

// DOMPurify URI allowlist: http(s), mailto, tel + safe raster data URIs from mammoth.
// data:image/svg+xml is intentionally excluded — SVG can embed <script> and event handlers.
const ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp):|data:image\/(?:png|jpeg|gif|webp);base64,|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i

function sanitizeHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_URI_REGEXP,
  })
  // DOMPurify may not strip data:image/svg+xml in all DOM environments
  // (notably jsdom). SVG data URIs can embed <script> — strip explicitly.
  return clean.replace(
    /(\s(?:src|xlink:href)\s*=\s*['"])\s*data:image\/svg[^'"]*(?=['"])/gi,
    '$1#',
  )
}

/**
 * Convert mammoth HTML to plain text for the edit textarea. Preserves paragraph
 * breaks via \n\n on block-level tags and single \n on <br>. writeDocx will
 * rebuild paragraphs from the blank-line split.
 */
function htmlToPlainText(html: string): string {
  let out = html
  // Replace <img> with a placeholder before stripping tags.
  out = out.replace(/<img\b[^>]*\balt\s*=\s*"([^"]*)"[^>]*\/?>/gi, (_, alt) =>
    alt.trim() ? `[Image: ${alt.trim()}]` : '[Image]',
  )
  out = out.replace(/<img\b[^>]*\balt\s*=\s*'([^']*)'[^>]*\/?>/gi, (_, alt) =>
    alt.trim() ? `[Image: ${alt.trim()}]` : '[Image]',
  )
  out = out.replace(/<img\b[^>]*\/?>/gi, '[Image]')
  out = out.replace(/<br\s*\/?>/gi, '\n')
  out = out.replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n\n')
  out = out.replace(/<[^>]+>/g, '')
  // Decode the handful of entities mammoth actually emits.
  out = out
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  // Collapse 3+ blank lines into one and trim trailing whitespace per line.
  out = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
  return out.trim()
}

export function DocxViewer({ path, onRevealInFinder }: Props) {
  const [html, setHtml] = useState<string | null>(null)
  const [originalText, setOriginalText] = useState<string>('')
  const [editedText, setEditedText] = useState<string>('')
  const [editingRequested, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setHtml(null)
    window.marvin.office
      .readDocx(path)
      .then((res) => {
        if (cancelled) return
        const safe = sanitizeHtml(res.html)
        const text = htmlToPlainText(safe)
        setHtml(safe)
        setOriginalText(text)
        setEditedText(text)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [path])

  // Editing is gated behind a build flag (#429). When off, the viewer is
  // read-only: the mammoth HTML preview renders, but edit/save are hidden.
  const editing = OFFICE_EDIT_ENABLED && editingRequested

  const dirty = editing && editedText !== originalText

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaveError(null)
    try {
      await window.marvin.office.writeDocx(path, editedText)
      setOriginalText(editedText)
      setEditing(false)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [path, editedText])

  const handleCancel = useCallback(() => {
    setEditedText(originalText)
    setEditing(false)
  }, [originalText])

  return (
    <div className="docx-viewer">
      <div className="docx-viewer-toolbar">
        <span className="docx-viewer-name">
          {basename(path)}
          {dirty && <span className="docx-viewer-dirty" aria-label="Unsaved changes"> *</span>}
        </span>
        <div className="docx-viewer-actions">
          {OFFICE_EDIT_ENABLED && !editing && !loading && !loadError && (
            <button
              type="button"
              className="docx-viewer-action docx-viewer-edit"
              onClick={() => setEditing(true)}
              title="Edit document text"
            >
              <Icon name="edit" size={14} />
              Edit
            </button>
          )}
          {editing && (
            <>
              <button
                type="button"
                className="docx-viewer-action docx-viewer-cancel"
                onClick={handleCancel}
                disabled={saving}
                title="Discard changes"
              >
                <Icon name="close" size={14} />
                Cancel
              </button>
              <button
                type="button"
                className="docx-viewer-action docx-viewer-action-primary docx-viewer-save"
                onClick={handleSave}
                disabled={saving || !dirty}
                title="Save changes to .docx"
              >
                <Icon name="save" size={14} />
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
          {onRevealInFinder && (
            <button
              type="button"
              className="docx-viewer-action docx-viewer-reveal"
              onClick={() => onRevealInFinder(path)}
              title="Reveal in Finder"
            >
              <Icon name="link-external" size={14} />
              Reveal
            </button>
          )}
        </div>
      </div>
      <div className="docx-viewer-host">
        {loading && <div className="docx-viewer-loading">Loading document…</div>}
        {loadError && !loading && (
          <div className="docx-viewer-error">Failed to read document: {loadError}</div>
        )}
        {!loading && !loadError && editing && (
          <>
            {saveError && (
              <div className="docx-viewer-error">{saveError}</div>
            )}
            <textarea
              className="docx-viewer-textarea"
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              spellCheck={false}
              autoFocus
            />
          </>
        )}
        {!loading && !loadError && !editing && html != null && (
          <div
            className="docx-viewer-content"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  )
}
