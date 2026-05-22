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

        <div className="modal-actions">
          <button type="button" className="modal-btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
