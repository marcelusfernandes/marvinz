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

export function PdfViewer({ path, onRevealInFinder }: Props) {
  return (
    <div className="pdf-viewer">
      <div className="pdf-viewer-toolbar">
        <span className="pdf-viewer-name">{basename(path)}</span>
        {onRevealInFinder && (
          <button
            type="button"
            className="pdf-viewer-action"
            onClick={() => onRevealInFinder(path)}
            title="Reveal in Finder"
          >
            <Icon name="link-external" size={14} />
            Reveal
          </button>
        )}
      </div>
      <div className="pdf-viewer-host">
        <embed src={toMarvinUrl(path)} type="application/pdf" className="pdf-viewer-embed" />
      </div>
    </div>
  )
}
