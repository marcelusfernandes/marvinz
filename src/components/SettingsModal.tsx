import { useEffect } from 'react'
import { setSetting, useSetting } from '../lib/settingsStore'

type Props = {
  onClose: () => void
}

export function SettingsModal({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const iconTheme = useSetting('iconTheme') ?? 'codicon'
  const colorTheme = useSetting('colorTheme') ?? 'system'
  const terminalModeEnabled = useSetting('terminalModeEnabled') ?? false

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal modal-settings"
        role="dialog"
        aria-labelledby="settings-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="settings-title" className="modal-title">Settings</h2>

        <section className="modal-section">
          <div className="modal-section-header">Appearance</div>
          <div className="modal-section-row">
            <div>
              <div className="modal-section-label">Color theme</div>
              <div className="modal-section-hint">
                Light, dark, or follow the system preference.
              </div>
            </div>
            <div className="segmented" role="radiogroup" aria-label="Color theme">
              <button
                type="button"
                role="radio"
                aria-checked={colorTheme === 'light'}
                className={`segmented-btn${colorTheme === 'light' ? ' active' : ''}`}
                onClick={() => void setSetting('colorTheme', 'light')}
              >
                Light
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={colorTheme === 'dark'}
                className={`segmented-btn${colorTheme === 'dark' ? ' active' : ''}`}
                onClick={() => void setSetting('colorTheme', 'dark')}
              >
                Dark
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={colorTheme === 'system'}
                className={`segmented-btn${colorTheme === 'system' ? ' active' : ''}`}
                onClick={() => void setSetting('colorTheme', 'system')}
              >
                System
              </button>
            </div>
          </div>
          <div className="modal-section-row">
            <div>
              <div className="modal-section-label">File tree icons</div>
              <div className="modal-section-hint">
                Switch between monochrome and colorful icons.
              </div>
            </div>
            <div className="segmented" role="radiogroup" aria-label="Icon theme">
              <button
                type="button"
                role="radio"
                aria-checked={iconTheme === 'codicon'}
                className={`segmented-btn${iconTheme === 'codicon' ? ' active' : ''}`}
                onClick={() => void setSetting('iconTheme', 'codicon')}
              >
                Codicons
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={iconTheme === 'material'}
                className={`segmented-btn${iconTheme === 'material' ? ' active' : ''}`}
                onClick={() => void setSetting('iconTheme', 'material')}
              >
                Material
              </button>
            </div>
          </div>
        </section>

        <section className="modal-section">
          <div className="modal-section-header">Advanced</div>
          <div className="modal-section-row">
            <div>
              <div className="modal-section-label">Enable terminal mode</div>
              <div className="modal-section-hint">
                New agent tabs open the legacy PTY terminal instead of the native chat panel.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={terminalModeEnabled}
              className={`segmented-btn${terminalModeEnabled ? ' active' : ''}`}
              onClick={() =>
                void setSetting('terminalModeEnabled', !terminalModeEnabled)
              }
            >
              {terminalModeEnabled ? 'On' : 'Off'}
            </button>
          </div>
        </section>

        <div className="modal-actions">
          <button type="button" className="modal-btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
