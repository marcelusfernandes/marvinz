import { useSyncExternalStore } from 'react'
import type { Settings } from '../types'

const LS_PREFIX = 'marvin:settings:'

type Listener = () => void

const listeners = new Set<Listener>()
let state: Settings = readFromLocalStorage()

function readFromLocalStorage(): Settings {
  const out: Settings = {}
  try {
    const iconTheme = window.localStorage.getItem(`${LS_PREFIX}iconTheme`)
    if (iconTheme === 'codicon' || iconTheme === 'material') {
      out.iconTheme = iconTheme
    }
    const colorTheme = window.localStorage.getItem(`${LS_PREFIX}colorTheme`)
    if (colorTheme === 'light' || colorTheme === 'dark' || colorTheme === 'system') {
      out.colorTheme = colorTheme
    }
    const visualStyle = window.localStorage.getItem(`${LS_PREFIX}visualStyle`)
    if (visualStyle === 'modern' || visualStyle === 'legacy') {
      out.visualStyle = visualStyle
    }
    const themeFlavor = window.localStorage.getItem(`${LS_PREFIX}themeFlavor`)
    if (themeFlavor === 'default' || themeFlavor === 'pastel') {
      out.themeFlavor = themeFlavor
    }
    const terminalModeEnabled = window.localStorage.getItem(
      `${LS_PREFIX}terminalModeEnabled`,
    )
    if (terminalModeEnabled === 'true' || terminalModeEnabled === 'false') {
      out.terminalModeEnabled = terminalModeEnabled === 'true'
    }
    const agentsPaneTransparent = window.localStorage.getItem(
      `${LS_PREFIX}agentsPaneTransparent`,
    )
    if (agentsPaneTransparent === 'true' || agentsPaneTransparent === 'false') {
      out.agentsPaneTransparent = agentsPaneTransparent === 'true'
    }
    const saveMode = window.localStorage.getItem(`${LS_PREFIX}saveMode`)
    if (saveMode === 'auto' || saveMode === 'manual') {
      out.saveMode = saveMode
    }
  } catch {
    // ignore
  }
  return out
}

function notify() {
  for (const l of listeners) l()
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSettings(): Settings {
  return state
}

/**
 * Seed the store from the main-process settings.json. Called once at app
 * bootstrap. Reconciles with localStorage cache silently.
 */
export function seedFromMain(next: Settings): void {
  state = { ...state, ...next }
  notify()
}

/**
 * Update one key. Writes through to localStorage immediately (cache for
 * first paint on next launch) AND to main-process settings.json via IPC.
 * Notifies subscribers synchronously.
 */
export async function setSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): Promise<void> {
  state = { ...state, [key]: value }
  notify()
  try {
    window.localStorage.setItem(`${LS_PREFIX}${key}`, String(value))
  } catch {
    // ignore quota / disabled storage
  }
  await window.marvin.settings.set({ [key]: value })
}

export function useSetting<K extends keyof Settings>(key: K): Settings[K] {
  return useSyncExternalStore(
    subscribe,
    () => state[key],
    () => state[key],
  )
}
