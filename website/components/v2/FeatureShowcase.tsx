import styles from "./FeatureShowcase.module.css";

type Feature = {
  kicker: string;
  title: string;
  body: string;
  /** Screenshot path under /public, or omitted for a text-only visual. */
  img?: string;
  alt?: string;
  /** Text-only visual (Snapshots): a monospace path shown instead of a shot. */
  note?: string;
  /** object-position for the cover-cropped shot (defaults to top center). */
  pos?: string;
  /** Override the frame aspect-ratio (defaults to 16/10). Used for the wide
      send-to-agent banner so the whole shot shows without cropping. */
  aspect?: string;
  /** Scale the shot up inside its frame (cover crops the overflow). */
  zoom?: number;
};

const FEATURES: Feature[] = [
  {
    kicker: "Vault",
    title: "Your markdown vault, navigable",
    body: "Point Marvinz at any local folder — the agent reads and writes the files in place. Browse them in a tree with folders and drag-and-drop, where links rewrite themselves when you move things.",
    img: "/features/feat-tree.png",
    alt: "Marvinz file tree showing a markdown vault with nested folders and notes",
  },
  {
    kicker: "Agent",
    title: "Claude Code & Codex, right beside your files",
    body: "Run Claude Code or Codex in a terminal scoped to your vault and watch its edits land in the editor in real time — the agent works on the same files you're reading.",
    img: "/features/feat-terminal.png",
    alt: "The Claude Code and Codex terminal pane running inside Marvinz",
  },
  {
    kicker: "Preview",
    title: "Write markdown, watch it render",
    body: "A live, rendered view of every note — headings, tables, task lists, code blocks, [[wikilinks]] and embedded images, all resolved as you read.",
    img: "/features/feat-preview.png",
    alt: "A rendered markdown note in Marvinz with an embedded diagram and a comparison table",
  },
  {
    kicker: "Search",
    title: "Jump to anything",
    body: "Open the command palette to fuzzy-find any file, or search the full text of your vault — then jump straight to the matching line.",
    img: "/features/feat-palette.png",
    alt: "The Marvinz command palette searching across the vault",
  },
  {
    kicker: "Context",
    title: "Send a selection to the agent",
    body: "Highlight a passage in any note and hand it to the agent as context — no copy-paste, no leaving the workspace.",
    img: "/features/feat-send.png",
    alt: "A text selection with a Send to agent action in Marvinz",
    pos: "left center",
    aspect: "1500 / 343",
    zoom: 1.15,
  },
  {
    kicker: "Snapshots",
    title: "Every turn, reversible",
    body: "Marvinz snapshots the files the agent touches on every turn. Restore any earlier version in one click — nothing the agent writes is ever lost.",
    note: ".marvin/snapshots/<turn-id>",
  },
];

/**
 * Zig-zag feature showcase: each row pairs benefit copy with a real, consistently
 * framed screenshot of the app, alternating sides down the page (issue #514).
 * Replaces the scripted-cursor vignettes. Snapshots is a text-only visual.
 */
export function FeatureShowcase() {
  return (
    <div className={styles.showcase}>
      {FEATURES.map(({ kicker, title, body, img, alt, note, pos, aspect, zoom }) => (
        <article key={kicker} className={styles.row} data-reveal-target>
          <div className={styles.copy}>
            <span className={styles.kicker}>{kicker}</span>
            <h3 className={styles.title}>{title}</h3>
            <p className={styles.body}>{body}</p>
          </div>
          <div className={styles.vis}>
            {img ? (
              <div
                className={styles.frame}
                style={aspect ? { aspectRatio: aspect } : undefined}
              >
                <img
                  className={styles.shot}
                  src={img}
                  alt={alt}
                  loading="lazy"
                  decoding="async"
                  style={{
                    objectPosition: pos,
                    transform: zoom ? `scale(${zoom})` : undefined,
                  }}
                />
              </div>
            ) : (
              <div className={styles.note} aria-hidden="true">
                <span className={styles.noteLabel}>Versioned</span>
                <code className={styles.notePath}>{note}</code>
                <span className={styles.noteRestore}>↺ restore any turn</span>
              </div>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
