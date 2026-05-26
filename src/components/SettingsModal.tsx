import { useEffect } from 'react'
import { setSetting, useSetting } from '../lib/settingsStore'
import { CHAT_UI_ENABLED, MODERN_UI_ENABLED } from '../lib/featureFlags'
import type { LayoutMode } from './LayoutToggle'

type Props = {
  onClose: () => void
  layoutMode: LayoutMode
  onLayoutChange: (mode: LayoutMode) => void
}

export function SettingsModal({ onClose, layoutMode, onLayoutChange }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const iconTheme = useSetting('iconTheme') ?? 'codicon'
  const colorTheme = useSetting('colorTheme') ?? 'system'
  const visualStyle = useSetting('visualStyle') ?? 'modern'
  const terminalModeEnabled = useSetting('terminalModeEnabled') ?? false
  const saveMode = useSetting('saveMode') ?? 'auto'

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

        {MODERN_UI_ENABLED && (
          <section className="modal-section">
            <div className="modal-section-header">Visual style</div>
            <div className="modal-section-row">
              <div>
                <div className="modal-section-label">Interface style</div>
                <div className="modal-section-hint">
                  Switch between the legacy look and the redesigned interface.
                </div>
              </div>
              <div className="segmented" role="radiogroup" aria-label="Visual style">
                <button
                  type="button"
                  role="radio"
                  aria-checked={visualStyle === 'modern'}
                  className={`segmented-btn${visualStyle === 'modern' ? ' active' : ''}`}
                  onClick={() => void setSetting('visualStyle', 'modern')}
                >
                  Modern
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={visualStyle === 'legacy'}
                  className={`segmented-btn${visualStyle === 'legacy' ? ' active' : ''}`}
                  onClick={() => void setSetting('visualStyle', 'legacy')}
                >
                  Legacy
                </button>
              </div>
            </div>
          </section>
        )}

        <section className="modal-section">
          <div className="modal-section-header">Layout</div>
          <div className="modal-section-row">
            <div>
              <div className="modal-section-label">Panel arrangement</div>
              <div className="modal-section-hint">
                Choose which panel is centered.
              </div>
            </div>
            <div className="segmented" role="radiogroup" aria-label="Panel arrangement">
              <button
                type="button"
                role="radio"
                aria-checked={layoutMode === 'editor-center'}
                className={`segmented-btn${layoutMode === 'editor-center' ? ' active' : ''}`}
                onClick={() => onLayoutChange('editor-center')}
              >
                Editor
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={layoutMode === 'claude-center'}
                className={`segmented-btn${layoutMode === 'claude-center' ? ' active' : ''}`}
                onClick={() => onLayoutChange('claude-center')}
              >
                Claude
              </button>
            </div>
          </div>
        </section>

        <section className="modal-section">
          <div className="modal-section-header">Editor</div>
          <div className="modal-section-row">
            <div>
              <div className="modal-section-label">Save mode</div>
              <div className="modal-section-hint">
                Automatic saves after a short pause. Manual requires Cmd+S.
              </div>
            </div>
            <div className="segmented" role="radiogroup" aria-label="Save mode">
              <button
                type="button"
                role="radio"
                aria-checked={saveMode === 'auto'}
                className={`segmented-btn${saveMode === 'auto' ? ' active' : ''}`}
                onClick={() => void setSetting('saveMode', 'auto')}
              >
                Automatic
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={saveMode === 'manual'}
                className={`segmented-btn${saveMode === 'manual' ? ' active' : ''}`}
                onClick={() => void setSetting('saveMode', 'manual')}
              >
                Manual
              </button>
            </div>
          </div>
        </section>

        {CHAT_UI_ENABLED && (
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
        )}

        <div className="modal-actions">
          <button type="button" className="modal-btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
