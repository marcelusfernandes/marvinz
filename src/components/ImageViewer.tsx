import { toMarvinUrl } from '../lib/marvinUrl'
import { Icon } from './Icon'

type Props = {
  path: string
  /** Open in the system default app (Preview, etc.) via Reveal in Finder. */
  onRevealInFinder?: (path: string) => void
}

function basename(p: string): string {
  return p.split('/').pop() ?? p
}

export function ImageViewer({ path, onRevealInFinder }: Props) {
  return (
    <div className="image-viewer">
      <div className="image-viewer-toolbar">
        <span className="image-viewer-name">{basename(path)}</span>
        {onRevealInFinder && (
          <button
            type="button"
            className="image-viewer-action"
            onClick={() => onRevealInFinder(path)}
            title="Reveal in Finder"
          >
            <Icon name="link-external" size={14} />
            Reveal
          </button>
        )}
      </div>
      <div className="image-viewer-host">
        <img src={toMarvinUrl(path)} alt={basename(path)} />
      </div>
    </div>
  )
}
