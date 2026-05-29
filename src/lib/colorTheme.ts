import { useEffect } from 'react'
import { useSetting } from './settingsStore'

export type ResolvedTheme = 'light' | 'dark'

function resolve(setting: 'light' | 'dark' | 'system' | undefined): ResolvedTheme {
  if (setting === 'light' || setting === 'dark') return setting
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Applies `data-theme` on <html> based on the user's `colorTheme` setting.
 * When the setting is 'system' (or unset), follows `prefers-color-scheme`
 * and updates live when the OS preference changes.
 */
export function useColorTheme(): ResolvedTheme {
  const setting = useSetting('colorTheme')
  const resolved = resolve(setting)

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])

  useEffect(() => {
    if (setting && setting !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      document.documentElement.dataset.theme = mq.matches ? 'dark' : 'light'
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [setting])

  return resolved
}

/**
 * Applies `data-agents-pane-transparent` on <html> based on the user's
 * `agentsPaneTransparent` setting. Removes the attribute when off so the pane
 * stays opaque.
 */
export function useAgentsPaneTransparent(): boolean {
  const setting = useSetting('agentsPaneTransparent') ?? false

  useEffect(() => {
    if (setting) {
      document.documentElement.dataset.agentsPaneTransparent = 'true'
    } else {
      delete document.documentElement.dataset.agentsPaneTransparent
    }
  }, [setting])

  return setting
}
