import styles from "./ServiceCards.module.css";

const CARDS = [
  {
    title: "Point at your vault.",
    body: "Your files stay where they are. Nothing uploaded, nothing moved. Marvinz reads your local markdown directly.",
  },
  {
    title: "The agent works.",
    body: "Claude Code edits your files. Output lands as linked, readable notes — snapshotted on every turn so you can roll back.",
  },
  {
    title: "Read, navigate, validate.",
    body: "Review agent work side-by-side with your own notes. Approve tool calls. Restore any earlier version in one click.",
  },
];

export function ServiceCards() {
  return (
    <section className={styles.section} aria-label="How Marvinz works">
      <div className={styles.inner}>
        <ul className={styles.grid}>
          {CARDS.map((card) => (
            <li key={card.title} className={styles.card}>
              <span className={styles.arrow} aria-hidden="true">
                →
              </span>
              <h3 className={styles.title}>{card.title}</h3>
              <p className={styles.body}>{card.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
