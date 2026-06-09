import { Section } from "./Section";
import styles from "./Features.module.css";

const FEATURES = [
  {
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
    body: "Side-by-side editor and rendered preview. Tables, wikilinks, code blocks — all rendered as you write or as the agent writes.",
  },
  {
    kicker: "Tabs",
    title: "Multi-tab workspace",
    body: "Open multiple files at once, switch between agent output and your own notes, build the context you need.",
  },
  {
    kicker: "Control",
    title: "Approvable tool calls",
    body: "Every filesystem action the agent wants to take surfaces for your approval. You decide what runs — nothing happens without your review.",
  },
];

export function Features() {
  return (
    <Section
      id="features"
      eyebrow="02 · Features"
      title="The workspace native to the Claude Code + vault workflow."
      lead="Built for engineers and PMs who already run Claude Code alongside a markdown vault and want to read, navigate and validate what the AI generates — to trust it and build on it, instead of losing it in a terminal scroll."
    >
      <ul className={styles.grid}>
        {FEATURES.map((feature) => (
          <li key={feature.kicker} className={styles.card}>
            <span className={styles.kicker}>{feature.kicker}</span>
            <h3 className={styles.cardTitle}>{feature.title}</h3>
            <p className={styles.cardBody}>{feature.body}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
