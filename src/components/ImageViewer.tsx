type Props = {
  path: string
  /** Open in the system default app (Preview, etc.) via Reveal in Finder. */
  onRevealInFinder?: (path: string) => void
}

function imageUrl(path: string): string {
  // Custom protocol registered in main.ts. We use `localhost` as a
  // placeholder hostname because Chromium's standard URL parser refuses
  // an empty hostname for schemes registered as standard, and would
  // otherwise misinterpret the first path segment (e.g. "Users") as
  // the host. URL-encode each path segment so spaces and unicode
  // survive.
  const encoded = path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
  return `marvin://localhost${encoded}`
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
            Reveal
          </button>
        )}
      </div>
      <div className="image-viewer-host">
        <img src={imageUrl(path)} alt={basename(path)} />
      </div>
    </div>
  )
}
