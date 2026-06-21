import styles from "./StepsRow.module.css";

const STEPS = [
  {
    kicker: "01",
    title: "Point Marvinz at your vault.",
    body: "Your files stay where they are. Marvinz reads the vault — nothing is uploaded, nothing is moved.",
  },
  {
    kicker: "02",
    title: "The agent works — output lands as navigable markdown.",
    body: "Claude Code and Codex edit your local files. Every change lands as a linked, readable note in your vault, snapshotted so you can roll back any turn.",
  },
  {
    kicker: "03",
    title: "Read, navigate, validate — and restore any earlier version.",
    body: "Review the agent's work side-by-side with your own notes. Approve tool calls before they run. Restore any snapshot from one click.",
  },
];

export function StepsRow() {
  return (
    <ol className={styles.steps}>
      {STEPS.map((step) => (
        <li key={step.kicker} className={styles.step}>
          <span className={styles.kicker} aria-hidden="true">
            {step.kicker}
          </span>
          <h3 className={styles.title}>{step.title}</h3>
          <p className={styles.body}>{step.body}</p>
        </li>
      ))}
    </ol>
  );
}
