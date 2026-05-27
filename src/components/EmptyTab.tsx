import { Icon } from './Icon'
import type { IconName } from './Icon'

type Props = {
  onOpenBrowser: () => void
  onCreateNote: () => void
}

type Card = {
  id: 'browser' | 'note'
  icon: IconName
  title: string
  description: string
  onClick: () => void
}

export function EmptyTab({ onOpenBrowser, onCreateNote }: Props) {
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
      description: 'Criar nota markdown',
      onClick: onCreateNote,
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
