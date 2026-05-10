import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  type PaletteItem,
  rankPaletteItems,
  stripBasename,
} from '../lib/paletteRanker'
import { HighlightedMatch } from './HighlightedMatch'

type Props = {
  /** Vault-relative path currently committed (the open file's location). */
  value: string
  /** All vault files available for fuzzy matching. */
  items: PaletteItem[]
  /** Called when the user commits a path.
   *  `replaceCurrent` true = replace active tab; false = open in a new tab. */
  onCommit: (path: string, replaceCurrent: boolean) => void
  /** Optional placeholder for the input. */
  placeholder?: string
}

const ERROR_FLASH_MS = 1400
const MAX_DROPDOWN_WIDTH = 520
const MAX_DROPDOWN_HEIGHT = 320
const DROPDOWN_LIMIT = 12

export function PathSuggest({ value, items, onCommit, placeholder }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(value)
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const [errorFlash, setErrorFlash] = useState(false)
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(null)
  // Suppress the "blur reverts" behaviour for the click that selects a row,
  // since onMouseDown on the row fires before onBlur on the input.
  const committingRef = useRef(false)

  // Reset draft whenever the committed value changes (e.g. tab switch, file
  // watcher, navigation). This intentionally clobbers any in-flight edit
  // because external changes win.
  useEffect(() => {
    setDraft(value)
    setOpen(false)
  }, [value])

  const results = useMemo(
    () => rankPaletteItems(items, draft, DROPDOWN_LIMIT),
    [items, draft],
  )

  useEffect(() => {
    setActiveIdx(0)
  }, [draft])

  const positionDropdown = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const width = Math.min(Math.max(rect.width, 280), MAX_DROPDOWN_WIDTH)
    setAnchor({ left: rect.left, top: rect.bottom + 4, width })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    positionDropdown()
    const onScroll = () => positionDropdown()
    const onResize = () => positionDropdown()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, positionDropdown])

  const flashError = useCallback(() => {
    setErrorFlash(true)
    window.setTimeout(() => setErrorFlash(false), ERROR_FLASH_MS)
  }, [])

  const commit = useCallback(
    (path: string, replaceCurrent: boolean) => {
      committingRef.current = true
      setOpen(false)
      onCommit(path, replaceCurrent)
      window.setTimeout(() => {
        committingRef.current = false
      }, 0)
    },
    [onCommit],
  )

  const tryCommit = useCallback(
    (replaceCurrent: boolean) => {
      const sel = results[activeIdx]
      if (sel) {
        commit(sel.item.path, replaceCurrent)
        return
      }
      // No suggestion highlighted — try exact match against the typed string.
      const trimmed = draft.trim()
      if (trimmed) {
        const exact = items.find(
          (it) => it.rel.toLowerCase() === trimmed.toLowerCase(),
        )
        if (exact) {
          commit(exact.path, replaceCurrent)
          return
        }
      }
      flashError()
    },
    [results, activeIdx, draft, items, commit, flashError],
  )

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) setOpen(true)
      setActiveIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) setOpen(true)
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      tryCommit(!(e.metaKey || e.ctrlKey))
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setDraft(value)
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.select()
    setOpen(true)
  }

  const handleBlur = () => {
    if (committingRef.current) return
    setDraft(value)
    setOpen(false)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraft(e.target.value)
    if (!open) setOpen(true)
  }

  return (
    <>
      <input
        ref={inputRef}
        className={`path-input${errorFlash ? ' error' : ''}`}
        value={draft}
        onChange={handleChange}
        onKeyDown={handleKey}
        onFocus={handleFocus}
        onBlur={handleBlur}
        spellCheck={false}
        autoComplete="off"
        placeholder={placeholder}
        aria-label="File path"
      />
      {open && anchor && results.length > 0 &&
        createPortal(
          <div
            className="path-suggest-dropdown"
            style={{
              left: anchor.left,
              top: anchor.top,
              width: anchor.width,
              maxHeight: MAX_DROPDOWN_HEIGHT,
            }}
          >
            {results.map((r, i) => (
              <button
                type="button"
                key={r.item.path}
                className={`palette-row${i === activeIdx ? ' active' : ''}`}
                onMouseEnter={() => setActiveIdx(i)}
                // mousedown fires before the input's blur — flag the commit
                // so blur doesn't revert the draft before onClick runs.
                onMouseDown={() => {
                  committingRef.current = true
                }}
                onClick={(e) => commit(r.item.path, !(e.metaKey || e.ctrlKey))}
              >
                <span className="palette-name">
                  <HighlightedMatch text={r.item.name} matches={r.nameMatches} />
                  {!r.item.isMarkdown && <span className="palette-ext-tag">file</span>}
                </span>
                <span className="palette-rel">
                  <HighlightedMatch
                    text={stripBasename(r.item.rel, r.item.name)}
                    matches={r.relMatches}
                    bound={r.item.rel.length - r.item.name.length}
                  />
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
