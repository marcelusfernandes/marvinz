import { Icon } from './Icon'

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
        <Icon name="layout-sidebar-right" size={16} />
      </button>
      <button
        type="button"
        className={`layout-btn${mode === 'claude-center' ? ' active' : ''}`}
        onClick={() => onChange('claude-center')}
        title="Claude in center · Editor on right"
        aria-label="Claude in center"
        aria-pressed={mode === 'claude-center'}
      >
        <Icon name="layout-sidebar-left" size={16} />
      </button>
    </div>
  )
}
