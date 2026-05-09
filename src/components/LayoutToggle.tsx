export type LayoutMode = 'editor-center' | 'claude-center'

type Props = {
  mode: LayoutMode
  onChange: (mode: LayoutMode) => void
}

export function LayoutToggle({ mode, onChange }: Props) {
  return (
    <div className="layout-toggle" role="group" aria-label="Layout">
      <button
        type="button"
        className={`layout-btn${mode === 'editor-center' ? ' active' : ''}`}
        onClick={() => onChange('editor-center')}
        title="Editor in center · Claude on right"
        aria-label="Editor in center"
        aria-pressed={mode === 'editor-center'}
      >
        <EditorCenterIcon />
      </button>
      <button
        type="button"
        className={`layout-btn${mode === 'claude-center' ? ' active' : ''}`}
        onClick={() => onChange('claude-center')}
        title="Claude in center · Editor on right"
        aria-label="Claude in center"
        aria-pressed={mode === 'claude-center'}
      >
        <ClaudeCenterIcon />
      </button>
    </div>
  )
}

// 24×16 viewBox. Three columns: narrow sidebar · wide editor (highlighted) · medium claude.
function EditorCenterIcon() {
  return (
    <svg width="22" height="14" viewBox="0 0 24 16" aria-hidden>
      <rect x="1" y="2" width="3.5" height="12" rx="0.5" className="layout-icon-thin" />
      <rect x="5.5" y="2" width="11" height="12" rx="0.5" className="layout-icon-fill" />
      <rect x="17.5" y="2" width="5.5" height="12" rx="0.5" className="layout-icon-thin" />
    </svg>
  )
}

// 24×16 viewBox. Three columns: narrow sidebar · medium claude · wide editor (highlighted).
function ClaudeCenterIcon() {
  return (
    <svg width="22" height="14" viewBox="0 0 24 16" aria-hidden>
      <rect x="1" y="2" width="3.5" height="12" rx="0.5" className="layout-icon-thin" />
      <rect x="5.5" y="2" width="5.5" height="12" rx="0.5" className="layout-icon-thin" />
      <rect x="12" y="2" width="11" height="12" rx="0.5" className="layout-icon-fill" />
    </svg>
  )
}
