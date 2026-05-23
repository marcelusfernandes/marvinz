const STORAGE_KEY = 'marvin.tabLabels'

function getStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function readTabLabels(): Record<string, string> {
  const storage = getStorage()
  if (!storage) return {}
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === 'string' && typeof v === 'string') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

export function writeTabLabels(labels: Record<string, string>): void {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(labels))
  } catch {
    // ignore quota / serialization errors
  }
}

export function clearTabLabel(tabId: string): void {
  const current = readTabLabels()
  if (!(tabId in current)) return
  delete current[tabId]
  writeTabLabels(current)
}
