import { useEffect } from 'react'
import { useSetting } from './settingsStore'

export type VisualStyle = 'modern' | 'legacy'

function resolve(setting: 'modern' | 'legacy' | undefined): VisualStyle {
  return setting === 'legacy' ? 'legacy' : 'modern'
}

/**
 * Applies `data-style` on <html> based on the user's `visualStyle` setting.
 * Defaults to 'modern' when the setting is unset or invalid.
 */
export function useVisualStyle(): VisualStyle {
  const setting = useSetting('visualStyle')
  const resolved = resolve(setting)

  useEffect(() => {
    document.documentElement.dataset.style = resolved
  }, [resolved])

  return resolved
}
