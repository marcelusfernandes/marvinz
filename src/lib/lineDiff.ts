export type DiffOp = 'equal' | 'insert' | 'delete'

export type DiffLine = {
  op: DiffOp
  beforeLine?: number
  afterLine?: number
  text: string
}

export type DiffPair = {
  before?: DiffLine
  after?: DiffLine
}

export type DiffStats = {
  added: number
  removed: number
  unchanged: number
}

function splitLines(text: string): string[] {
  if (text === '') return []
  return text.split('\n')
}

function lcsTable(a: string[], b: string[]): number[][] {
  const n = a.length
  const m = b.length
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) table[i][j] = table[i + 1][j + 1] + 1
      else table[i][j] = Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  return table
}

export function computeLineDiff(before: string, after: string): DiffLine[] {
  const a = splitLines(before)
  const b = splitLines(after)
  const table = lcsTable(a, b)
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: 'equal', beforeLine: i + 1, afterLine: j + 1, text: a[i] })
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ op: 'delete', beforeLine: i + 1, text: a[i] })
      i++
    } else {
      out.push({ op: 'insert', afterLine: j + 1, text: b[j] })
      j++
    }
  }
  while (i < a.length) {
    out.push({ op: 'delete', beforeLine: i + 1, text: a[i] })
    i++
  }
  while (j < b.length) {
    out.push({ op: 'insert', afterLine: j + 1, text: b[j] })
    j++
  }
  return out
}

export function pairForSideBySide(lines: DiffLine[]): DiffPair[] {
  const pairs: DiffPair[] = []
  let k = 0
  while (k < lines.length) {
    const cur = lines[k]
    if (cur.op === 'equal') {
      pairs.push({ before: cur, after: cur })
      k++
      continue
    }
    const deletes: DiffLine[] = []
    const inserts: DiffLine[] = []
    while (k < lines.length && lines[k].op !== 'equal') {
      if (lines[k].op === 'delete') deletes.push(lines[k])
      else inserts.push(lines[k])
      k++
    }
    const max = Math.max(deletes.length, inserts.length)
    for (let p = 0; p < max; p++) {
      pairs.push({ before: deletes[p], after: inserts[p] })
    }
  }
  return pairs
}

export function diffStats(lines: DiffLine[]): DiffStats {
  let added = 0
  let removed = 0
  let unchanged = 0
  for (const l of lines) {
    if (l.op === 'insert') added++
    else if (l.op === 'delete') removed++
    else unchanged++
  }
  return { added, removed, unchanged }
}

export function hunkBoundaries(
  lines: DiffLine[],
  context = 3
): Array<{ start: number; end: number }> {
  const changedIdx: number[] = []
  for (let k = 0; k < lines.length; k++) {
    if (lines[k].op !== 'equal') changedIdx.push(k)
  }
  if (changedIdx.length === 0) return []
  const hunks: Array<{ start: number; end: number }> = []
  let start = Math.max(0, changedIdx[0] - context)
  let end = Math.min(lines.length - 1, changedIdx[0] + context)
  for (let h = 1; h < changedIdx.length; h++) {
    const idx = changedIdx[h]
    if (idx - context <= end + 1) {
      end = Math.min(lines.length - 1, idx + context)
    } else {
      hunks.push({ start, end })
      start = Math.max(0, idx - context)
      end = Math.min(lines.length - 1, idx + context)
    }
  }
  hunks.push({ start, end })
  return hunks
}
