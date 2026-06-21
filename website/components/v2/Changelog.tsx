import styles from "./Changelog.module.css";

type Entry = { title: string; desc: string };
type Tone = "shipped" | "progress" | "planned";
type Group = { status: string; tone: Tone; entries: Entry[] };

const GROUPS: Group[] = [
  {
    status: "Shipped",
    tone: "shipped",
    entries: [
      { title: "Live markdown preview", desc: "Rendered view with wikilinks, embeds, tables, task lists and code blocks." },
      { title: "File tree & drag-and-drop", desc: "Browse the vault and move files — internal links rewrite themselves." },
      { title: "Claude Code & Codex in the workspace", desc: "Run either agent in a terminal scoped to your vault, beside your files." },
      { title: "Snapshots on every turn", desc: "Each agent turn is captured under .marvin/snapshots so nothing is lost." },
      { title: "Command palette & search", desc: "Fuzzy-find any file or search the full text of the vault, then jump to the line." },
      { title: "Multi-format viewers", desc: "Open PDF, DOCX, XLSX and CSV inline, as tabs." },
      { title: "In-app browser", desc: "Open web pages in tabs without leaving the workspace." },
      { title: "Themes", desc: "Light and dark, color flavors and visual styles." },
    ],
  },
  {
    status: "In progress",
    tone: "progress",
    entries: [
      { title: "One-click restore", desc: "A versions panel with side-by-side diff to roll any file back to an earlier turn." },
      { title: "Approvable tool calls", desc: "Review and Allow or Deny every action the agent takes, inline in the workspace." },
      { title: "Send selection to the agent", desc: "Highlight a passage in any note and hand it to the agent as context." },
    ],
  },
  {
    status: "Planned",
    tone: "planned",
    entries: [
      { title: "Binary-safe snapshots", desc: "Snapshot and restore non-text files, not just markdown." },
      { title: "Conflict resolution", desc: "Clear UX for when the agent and you edit the same file at once." },
      { title: "More agents", desc: "Bring additional coding agents into the workspace, beyond Claude Code and Codex." },
    ],
  },
];

const DOT: Record<Tone, string> = {
  shipped: styles.dotShipped,
  progress: styles.dotProgress,
  planned: styles.dotPlanned,
};

/**
 * Roadmap-style changelog: what's shipped, what's being built now, and what's
 * next. The status label sticks beside its entries as you scroll.
 */
export function Changelog() {
  return (
    <div className={styles.log}>
      {GROUPS.map((group) => (
        <section key={group.status} className={styles.group} aria-label={group.status}>
          <div className={styles.statusWrap}>
            <span className={styles.status}>
              <span className={styles.dot + " " + DOT[group.tone]} aria-hidden="true" />
              {group.status}
            </span>
          </div>
          <div className={styles.entries}>
            {group.entries.map((entry) => (
              <article key={entry.title} className={styles.entry}>
                <h3 className={styles.entryTitle}>{entry.title}</h3>
                <p className={styles.entryDesc}>{entry.desc}</p>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
