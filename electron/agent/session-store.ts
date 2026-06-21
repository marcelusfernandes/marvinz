// JSONL session persistence — scaffold for Sprint 6.
// In v1 the store appends events/requests to a per-session JSONL file and
// maintains a lightweight index.json for the session list sidebar.
// Full GC, rotation (200 sessions / 50 MB per session), and rebuild logic
// land in Sprint 6.

import fs from 'node:fs/promises'
import path from 'node:path'
import type { AgentEvent, AgentRequest, SessionMeta } from './protocol.js'

const SESSIONS_DIR = path.join('.marvin', 'sessions')
const INDEX_FILE = 'index.json'
const MAX_SESSIONS = 200
const MAX_BYTES_PER_SESSION = 50 * 1024 * 1024

function sessionsRoot(vaultRoot: string): string {
  return path.join(vaultRoot, SESSIONS_DIR)
}

function sessionFile(vaultRoot: string, sessionId: string): string {
  return path.join(sessionsRoot(vaultRoot), `${sessionId}.jsonl`)
}

function metaFile(vaultRoot: string, sessionId: string): string {
  return path.join(sessionsRoot(vaultRoot), `${sessionId}.meta.json`)
}

function indexFile(vaultRoot: string): string {
  return path.join(sessionsRoot(vaultRoot), INDEX_FILE)
}

export async function ensureSessionsDir(vaultRoot: string): Promise<void> {
  await fs.mkdir(sessionsRoot(vaultRoot), { recursive: true })
}

// Append an event or request line to the session JSONL.
export async function appendLine(
  vaultRoot: string,
  sessionId: string,
  record: AgentEvent | AgentRequest
): Promise<void> {
  const line = JSON.stringify(record) + '\n'
  await fs.appendFile(sessionFile(vaultRoot, sessionId), line, 'utf8')
}

// Read all lines from a session JSONL and parse them.
export async function readSession(
  vaultRoot: string,
  sessionId: string
): Promise<Array<AgentEvent | AgentRequest>> {
  let raw: string
  try {
    raw = await fs.readFile(sessionFile(vaultRoot, sessionId), 'utf8')
  } catch {
    return []
  }
  const results: Array<AgentEvent | AgentRequest> = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      results.push(JSON.parse(trimmed) as AgentEvent | AgentRequest)
    } catch {
      // skip malformed lines — corruption-tolerant
    }
  }
  return results
}

export async function writeMeta(vaultRoot: string, meta: SessionMeta): Promise<void> {
  await fs.writeFile(metaFile(vaultRoot, meta.id), JSON.stringify(meta, null, 2), 'utf8')
}

export async function readMeta(vaultRoot: string, sessionId: string): Promise<SessionMeta | null> {
  try {
    const raw = await fs.readFile(metaFile(vaultRoot, sessionId), 'utf8')
    return JSON.parse(raw) as SessionMeta
  } catch {
    return null
  }
}

// Read the index file (sorted desc by updatedAt). Falls back to empty on parse failure.
export async function readIndex(vaultRoot: string): Promise<SessionMeta[]> {
  try {
    const raw = await fs.readFile(indexFile(vaultRoot), 'utf8')
    return JSON.parse(raw) as SessionMeta[]
  } catch {
    return []
  }
}

// Upsert a session into the index and persist it. Trims to MAX_SESSIONS.
export async function updateIndex(vaultRoot: string, meta: SessionMeta): Promise<void> {
  const index = await readIndex(vaultRoot)
  const filtered = index.filter((s) => s.id !== meta.id)
  const updated = [meta, ...filtered]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS)
  await fs.writeFile(indexFile(vaultRoot), JSON.stringify(updated, null, 2), 'utf8')
}

// Delete a session (JSONL + meta). Caller must also remove from index.
export async function deleteSession(vaultRoot: string, sessionId: string): Promise<void> {
  await Promise.allSettled([
    fs.rm(sessionFile(vaultRoot, sessionId), { force: true }),
    fs.rm(metaFile(vaultRoot, sessionId), { force: true }),
  ])
}

// Remove a session from the index without deleting its data.
export async function removeFromIndex(vaultRoot: string, sessionId: string): Promise<void> {
  const index = await readIndex(vaultRoot)
  const updated = index.filter((s) => s.id !== sessionId)
  await fs.writeFile(indexFile(vaultRoot), JSON.stringify(updated, null, 2), 'utf8')
}

// Sprint 6: GC — trim sessions beyond MAX_SESSIONS or MAX_BYTES_PER_SESSION.
// Exported for future use; body is a no-op stub in v1.
export async function runGC(vaultRoot: string): Promise<void> {
  // TODO Sprint 6: scan sessionsRoot, stat each .jsonl, delete oldest beyond limits.
  void vaultRoot
  void MAX_BYTES_PER_SESSION
}
