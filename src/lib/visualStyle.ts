import { useEffect } from 'react'
import { useSetting } from './settingsStore'
import { MODERN_UI_ENABLED } from './featureFlags'

export type VisualStyle = 'modern' | 'legacy'

function resolve(setting: 'modern' | 'legacy' | undefined): VisualStyle {
  return setting === 'legacy' ? 'legacy' : 'modern'
}

/**
 * Applies `data-style` on <html> based on the user's `visualStyle` setting.
 * Defaults to 'modern' when the setting is unset or invalid. When the Modern
 * UI is gated out via MODERN_UI_ENABLED, forces 'legacy' regardless of the
 * persisted setting (the setting itself is left intact on disk).
 */
export function useVisualStyle(): VisualStyle {
  const setting = useSetting('visualStyle')
  const resolved = MODERN_UI_ENABLED ? resolve(setting) : 'legacy'

  useEffect(() => {
    document.documentElement.dataset.style = resolved
  }, [resolved])

  return resolved
}
