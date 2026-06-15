import styles from "./BentoGrid.module.css";

const CARDS = [
  {
    span: true,
    kicker: "Vault",
    title: "Markdown vault as the agent's canvas",
    body: "Point Marvinz at any local folder. The agent reads and writes markdown directly — no sync, no upload, your files stay on your machine.",
  },
  {
    kicker: "Agent",
    title: "Claude Code sidebar",
    body: "Chat with the agent, approve tool calls before they run, and watch edits land in the editor in real time.",
  },
  {
    kicker: "Snapshots",
    title: "Every edit is snapshotted",
    body: "Marvinz saves a snapshot on every agent turn. Restore any earlier version from the history panel in one click.",
  },
  {
    kicker: "Preview",
    title: "Live markdown preview",
    body: "Side-by-side editor and rendered preview. Tables, wikilinks, code blocks — rendered as you write.",
  },
  {
    kicker: "Tabs",
    title: "Multi-tab workspace",
    body: "Open multiple files at once, switch between agent output and your own notes, build the context you need.",
  },
  {
    span: true,
    kicker: "Control",
    title: "Approvable tool calls",
    body: "Every filesystem action the agent wants to take surfaces for your approval. You decide what runs — nothing happens without your review.",
  },
];

export function BentoGrid() {
  return (
    <ul className={styles.bento}>
      {CARDS.map((card) => (
        <li
          key={card.kicker}
          className={styles.item + ("span" in card && card.span ? " " + styles.span : "")}
        >
          <span className={styles.kicker}>{card.kicker}</span>
          <h3 className={styles.title}>{card.title}</h3>
          <p className={styles.body}>{card.body}</p>
        </li>
      ))}
    </ul>
  );
}
