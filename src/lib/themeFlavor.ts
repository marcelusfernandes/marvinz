import { useEffect } from 'react'
import { useSetting } from './settingsStore'

export type ThemeFlavor = 'default' | 'pastel'

function resolve(setting: 'default' | 'pastel' | undefined): ThemeFlavor {
  return setting === 'pastel' ? 'pastel' : 'default'
}

/**
 * Applies `data-flavor` on <html> based on the user's `themeFlavor` setting.
 * Defaults to 'default' when the setting is unset or invalid.
 */
export function useThemeFlavor(): ThemeFlavor {
  const setting = useSetting('themeFlavor')
  const resolved = resolve(setting)

  useEffect(() => {
    document.documentElement.dataset.flavor = resolved
  }, [resolved])

  return resolved
}
