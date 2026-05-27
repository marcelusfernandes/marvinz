import { Icon } from './Icon'
import type { IconName } from './Icon'

type Props = {
  onOpenBrowser: () => void
  onCreateNote: () => void
  onChooseFile: () => void
  onChooseReview: () => void
  /** Disables vault-scoped cards when there is no vault open. */
  isVaultOpen?: boolean
}

type Card = {
  id: 'browser' | 'note' | 'file' | 'review'
  icon: IconName
  title: string
  description: string
  onClick: () => void
  disabled?: boolean
}

export function EmptyTab({
  onOpenBrowser,
  onCreateNote,
  onChooseFile,
  onChooseReview,
  isVaultOpen = true,
}: Props) {
  const cards: Card[] = [
    {
      id: 'browser',
      icon: 'globe',
      title: 'Navegador',
      description: 'Abrir um site',
      onClick: onOpenBrowser,
    },
    {
      id: 'note',
      icon: 'new-file',
      title: 'Nova nota',
      description: isVaultOpen ? 'Criar nota markdown' : 'Abra um vault primeiro',
      onClick: onCreateNote,
      disabled: !isVaultOpen,
    },
    {
      id: 'file',
      icon: 'folder-opened',
      title: 'Arquivos',
      description: isVaultOpen ? 'Abrir um arquivo do vault' : 'Abra um vault primeiro',
      onClick: onChooseFile,
      disabled: !isVaultOpen,
    },
    {
      id: 'review',
      icon: 'git-compare',
      title: 'Revisão',
      description: isVaultOpen ? 'Ver mudanças do projeto' : 'Abra um vault primeiro',
      onClick: onChooseReview,
      disabled: !isVaultOpen,
    },
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
