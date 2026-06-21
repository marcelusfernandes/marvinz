import { useEffect, useMemo, useRef, useState } from 'react'
import {
  computeLineDiff,
  diffStats,
  hunkBoundaries,
  pairForSideBySide,
  type DiffLine,
} from '../lib/lineDiff'

export type DiffViewMode = 'unified' | 'split'

type Props = {
  before: string
  after: string
  beforeLabel?: string
  afterLabel?: string
  mode?: DiffViewMode
  onModeChange?: (mode: DiffViewMode) => void
  contextLines?: number
}

const EMPTY_LINE = ' '

export function DiffViewer({
  before,
  after,
  beforeLabel = 'Before',
  afterLabel = 'After',
  mode = 'unified',
  onModeChange,
  contextLines = 3,
}: Props) {
  const [internalMode, setInternalMode] = useState<DiffViewMode>(mode)
  const activeMode = onModeChange ? mode : internalMode
  const containerRef = useRef<HTMLDivElement>(null)
  const [activeHunk, setActiveHunk] = useState(0)

  useEffect(() => {
    setActiveHunk(0)
  }, [before, after])

  const diff = useMemo(() => computeLineDiff(before, after), [before, after])
  const stats = useMemo(() => diffStats(diff), [diff])
  const hunks = useMemo(() => hunkBoundaries(diff, contextLines), [diff, contextLines])
  const visibleLines = useMemo(() => collapseToHunks(diff, hunks), [diff, hunks])

  const setMode = (next: DiffViewMode) => {
    if (onModeChange) onModeChange(next)
    else setInternalMode(next)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!containerRef.current?.contains(document.activeElement)) return
      if (e.key === 'j' || e.key === 'ArrowDown') {
        if (hunks.length === 0) return
        e.preventDefault()
        const next = Math.min(hunks.length - 1, activeHunk + 1)
        setActiveHunk(next)
        scrollToHunk(containerRef.current, next)
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        if (hunks.length === 0) return
        e.preventDefault()
        const next = Math.max(0, activeHunk - 1)
        setActiveHunk(next)
        scrollToHunk(containerRef.current, next)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeHunk, hunks.length])

  const noChanges = stats.added === 0 && stats.removed === 0

  return (
    <div
      className="diff-viewer"
      ref={containerRef}
      role="region"
      aria-label="Versions comparison"
      tabIndex={0}
    >
      <header className="diff-toolbar" role="toolbar" aria-label="Diff toolbar">
        <div className="diff-stats" aria-live="polite">
          <span className="diff-stat-added" aria-label={`${stats.added} lines added`}>
            +{stats.added}
          </span>
          <span className="diff-stat-removed" aria-label={`${stats.removed} lines removed`}>
            −{stats.removed}
          </span>
          {hunks.length > 0 && (
            <span className="diff-stat-hunks" aria-label={`${hunks.length} change blocks`}>
              {hunks.length} {hunks.length === 1 ? 'block' : 'blocks'}
            </span>
          )}
        </div>
        <div className="diff-mode-toggle" role="group" aria-label="View mode">
          <button
            type="button"
            className={`diff-mode-btn${activeMode === 'unified' ? ' active' : ''}`}
            onClick={() => setMode('unified')}
            aria-pressed={activeMode === 'unified'}
          >
            Unified
          </button>
          <button
            type="button"
            className={`diff-mode-btn${activeMode === 'split' ? ' active' : ''}`}
            onClick={() => setMode('split')}
            aria-pressed={activeMode === 'split'}
          >
            Side by side
          </button>
        </div>
      </header>

      {noChanges ? (
        <div className="diff-empty" role="status">
          No differences between versions.
        </div>
      ) : activeMode === 'unified' ? (
        <UnifiedView lines={visibleLines} beforeLabel={beforeLabel} afterLabel={afterLabel} />
      ) : (
        <SplitView lines={visibleLines} beforeLabel={beforeLabel} afterLabel={afterLabel} />
      )}
    </div>
  )
}

type CollapsedRun = { kind: 'gap'; count: number } | { kind: 'line'; line: DiffLine }

function collapseToHunks(
  diff: DiffLine[],
  hunks: Array<{ start: number; end: number }>
): CollapsedRun[] {
  if (hunks.length === 0) {
    return diff.map((line) => ({ kind: 'line', line }))
  }
  const out: CollapsedRun[] = []
  let cursor = 0
  for (const hunk of hunks) {
    if (hunk.start > cursor) {
      out.push({ kind: 'gap', count: hunk.start - cursor })
    }
    for (let k = hunk.start; k <= hunk.end; k++) {
      out.push({ kind: 'line', line: diff[k] })
    }
    cursor = hunk.end + 1
  }
  if (cursor < diff.length) {
    out.push({ kind: 'gap', count: diff.length - cursor })
  }
  return out
}

function UnifiedView({
  lines,
  beforeLabel,
  afterLabel,
}: {
  lines: CollapsedRun[]
  beforeLabel: string
  afterLabel: string
}) {
  return (
    <div
      className="diff-table diff-table-unified"
      role="table"
      aria-label={`Unified diff between ${beforeLabel} and ${afterLabel}`}
    >
      <div className="diff-headrow" role="row">
        <div className="diff-gutter" role="columnheader" aria-label={beforeLabel}>
          {abbrev(beforeLabel)}
        </div>
        <div className="diff-gutter" role="columnheader" aria-label={afterLabel}>
          {abbrev(afterLabel)}
        </div>
        <div className="diff-text-header" role="columnheader">
          Content
        </div>
      </div>
      {lines.map((run, i) => {
        if (run.kind === 'gap') {
          return (
            <div key={`gap-${i}`} className="diff-row diff-row-gap" role="row" aria-hidden>
              <div className="diff-gutter" />
              <div className="diff-gutter" />
              <div className="diff-gap-text">
                {run.count} unchanged {run.count === 1 ? 'line' : 'lines'}…
              </div>
            </div>
          )
        }
        const { line } = run
        return (
          <div
            key={`u-${i}`}
            className={`diff-row diff-row-${line.op}`}
            role="row"
            data-hunk-edge={isHunkEdge(lines, i) ? 'true' : undefined}
          >
            <div className="diff-gutter" role="cell" aria-hidden>
              {line.beforeLine ?? ''}
            </div>
            <div className="diff-gutter" role="cell" aria-hidden>
              {line.afterLine ?? ''}
            </div>
            <div
              className="diff-line"
              role="cell"
              aria-label={ariaForLine(line, beforeLabel, afterLabel)}
            >
              <span className="diff-sign" aria-hidden>
                {signFor(line.op)}
              </span>
              <span className="diff-text">{line.text === '' ? EMPTY_LINE : line.text}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SplitView({
  lines,
  beforeLabel,
  afterLabel,
}: {
  lines: CollapsedRun[]
  beforeLabel: string
  afterLabel: string
}) {
  const pairs = useMemo(() => {
    const flat: DiffLine[] = []
    for (const run of lines) if (run.kind === 'line') flat.push(run.line)
    return pairForSideBySide(flat)
  }, [lines])

  return (
    <div
      className="diff-table diff-table-split"
      role="table"
      aria-label={`Side-by-side diff between ${beforeLabel} and ${afterLabel}`}
    >
      <div className="diff-headrow" role="row">
        <div className="diff-gutter" role="columnheader" aria-hidden>
          #
        </div>
        <div className="diff-text-header" role="columnheader">
          {beforeLabel}
        </div>
        <div className="diff-gutter" role="columnheader" aria-hidden>
          #
        </div>
        <div className="diff-text-header" role="columnheader">
          {afterLabel}
        </div>
      </div>
      {pairs.map((pair, i) => (
        <div key={`s-${i}`} className="diff-row diff-row-split" role="row">
          <div className="diff-gutter" role="cell" aria-hidden>
            {pair.before?.beforeLine ?? ''}
          </div>
          <div
            className={`diff-line diff-side ${classForSide(pair.before)}`}
            role="cell"
            aria-label={
              pair.before
                ? ariaForLine(pair.before, beforeLabel, afterLabel)
                : `${beforeLabel}: empty line`
            }
          >
            <span className="diff-text">
              {pair.before ? (pair.before.text === '' ? EMPTY_LINE : pair.before.text) : ''}
            </span>
          </div>
          <div className="diff-gutter" role="cell" aria-hidden>
            {pair.after?.afterLine ?? ''}
          </div>
          <div
            className={`diff-line diff-side ${classForSide(pair.after)}`}
            role="cell"
            aria-label={
              pair.after
                ? ariaForLine(pair.after, beforeLabel, afterLabel)
                : `${afterLabel}: empty line`
            }
          >
            <span className="diff-text">
              {pair.after ? (pair.after.text === '' ? EMPTY_LINE : pair.after.text) : ''}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

function signFor(op: 'equal' | 'insert' | 'delete'): string {
  if (op === 'insert') return '+'
  if (op === 'delete') return '−'
  return ' '
}

function classForSide(line?: DiffLine): string {
  if (!line) return 'diff-side-empty'
  if (line.op === 'insert') return 'diff-row-insert'
  if (line.op === 'delete') return 'diff-row-delete'
  return 'diff-row-equal'
}

function ariaForLine(line: DiffLine, beforeLabel: string, afterLabel: string): string {
  const text = line.text || '(empty)'
  if (line.op === 'insert') return `Added in ${afterLabel}, line ${line.afterLine}: ${text}`
  if (line.op === 'delete') return `Removed from ${beforeLabel}, line ${line.beforeLine}: ${text}`
  return `Unchanged, line ${line.beforeLine}: ${text}`
}

function abbrev(label: string): string {
  return label.slice(0, 1).toUpperCase()
}

function isHunkEdge(lines: CollapsedRun[], i: number): boolean {
  const prev = lines[i - 1]
  return !prev || prev.kind === 'gap'
}

function scrollToHunk(container: HTMLDivElement | null, hunkIndex: number) {
  if (!container) return
  const edges = container.querySelectorAll('[data-hunk-edge="true"]')
  const target = edges[hunkIndex] as HTMLElement | undefined
  if (target) {
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
}
