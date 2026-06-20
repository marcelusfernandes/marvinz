import { Icon } from './Icon'
import type { IconName } from './Icon'

type Props = {
  onOpenBrowser: () => void
  onCreateNote: () => void
  onChooseFile: () => void
  /** Disables vault-scoped cards when there is no vault open. */
  isVaultOpen?: boolean
}

type Card = {
  id: 'browser' | 'note' | 'file'
  icon: IconName
  title: string
  description: string
  onClick: () => void
  disabled?: boolean
}

export function EmptyTab({ onOpenBrowser, onCreateNote, onChooseFile, isVaultOpen = true }: Props) {
  const cards: Card[] = [
    {
      id: 'browser',
      icon: 'globe',
      title: 'Browser',
      description: 'Open a site',
      onClick: onOpenBrowser,
    },
    {
      id: 'note',
      icon: 'new-file',
      title: 'New note',
      description: isVaultOpen ? 'Create markdown note' : 'Open a folder first',
      onClick: onCreateNote,
      disabled: !isVaultOpen,
    },
    {
      id: 'file',
      icon: 'folder-opened',
      title: 'Files',
      description: isVaultOpen ? 'Open a file from the folder' : 'Open a folder first',
      onClick: onChooseFile,
      disabled: !isVaultOpen,
    },
    // 'review' card lands with #361, alongside the git diff source
    // (vault:gitStatus + vault:gitDiff IPCs) that will populate it.
  ]

  return (
    <div className="empty-tab">
      <div className="empty-tab-grid">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            className="empty-tab-card"
            onClick={card.onClick}
            disabled={card.disabled}
            data-card={card.id}
          >
            <Icon name={card.icon} size={24} className="empty-tab-card-icon" />
            <span className="empty-tab-card-title">{card.title}</span>
            <span className="empty-tab-card-description">{card.description}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
