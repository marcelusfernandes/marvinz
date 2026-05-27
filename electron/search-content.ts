import path from 'node:path'
import { spawn } from 'node:child_process'
import { assertCwdInsideVaultAsync } from './vault-boundary.js'

export type ContentHit = {
  path: string
  rel: string
  name: string
  line: number
  lineText: string
  matchRanges: Array<{ start: number; end: number }>
}

export type SearchResult =
  | ContentHit[]
  | { unavailable: true }

type RgSubmatch = { match: { text: string }; start: number; end: number }
type RgMatchEvent = {
  type: 'match'
  data: {
    path: { text: string }
    line_number: number
    lines: { text: string }
    submatches: RgSubmatch[]
  }
}

// rg reports byte offsets; convert to JS char offset for UTF-8 multibyte safety.
function byteOffsetToCharOffset(str: string, byteOffset: number): number {
  return Buffer.from(str, 'utf8').slice(0, byteOffset).toString('utf8').length
}

export function searchContent(vaultPath: string, query: string): Promise<SearchResult> {
  const q = query.trim()
  // Null bytes in query would throw in spawn; reject early and return empty.
  if (q.length < 2 || q.includes('\0')) return Promise.resolve([])

  return new Promise(resolve => {
    let rg: ReturnType<typeof spawn>
    try {
      rg = spawn('rg', ['--json', '--max-count=1', '-i', '--no-heading', q, vaultPath])
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return resolve({ unavailable: true })
      throw e
    }

    const hits: ContentHit[] = []
    let buf = ''

    rg.stdout?.on('data', (chunk: Buffer) => {
      if (hits.length >= 50) return
      buf += chunk.toString('utf-8')
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line || hits.length >= 50) continue
        let parsed: RgMatchEvent
        try { parsed = JSON.parse(line) } catch { continue }
        if (parsed.type !== 'match') continue

        const absPath = parsed.data.path.text
        const original = parsed.data?.lines?.text ?? ''
        const trimStart = original.length - original.trimStart().length
        const rawText = original.trim()
        const truncated = rawText.length > 200
        const lineText = truncated ? rawText.slice(0, 200) + '…' : rawText

        const matchRanges: Array<{ start: number; end: number }> = []
        for (const sub of parsed.data.submatches ?? []) {
          const start = byteOffsetToCharOffset(original, sub.start) - trimStart
          const end = byteOffsetToCharOffset(original, sub.end) - trimStart
          if (start < 0 || end < 0) continue
          if (truncated && start >= 200) continue
          matchRanges.push({ start, end: Math.min(end, 200) })
        }

        hits.push({
          path: absPath,
          rel: path.relative(vaultPath, absPath),
          name: path.basename(absPath),
          line: parsed.data.line_number,
          lineText,
          matchRanges,
        })
      }
    })

    rg.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') resolve({ unavailable: true })
      else resolve(hits)
    })

    rg.on('close', async () => {
      const validated: ContentHit[] = []
      for (const hit of hits) {
        try {
          await assertCwdInsideVaultAsync(vaultPath, hit.path)
          validated.push(hit)
        } catch {
          // path escaped vault boundary — silently drop
        }
      }
      resolve(validated)
    })
  })
}
