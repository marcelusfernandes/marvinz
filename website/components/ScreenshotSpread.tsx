import { Section } from "./Section";
import styles from "./ScreenshotSpread.module.css";

export function ScreenshotSpread() {
  return (
    <Section
      id="see-it"
      eyebrow="03 · See it"
      title="Your vault. Your files. Your terms."
      lead="The agent's output lands as navigable, linked markdown you can read side-by-side with your own notes, validate whenever you need, and restore to any earlier version."
    >
      <figure className={styles.figure}>
        {/* Placeholder frame — replace with a real product screenshot when available. */}
        <div className={styles.frame} role="img" aria-label="Marvinz workspace screenshot — coming soon">
          <div className={styles.placeholder}>
            <span className={styles.wordmark}>
              Marvinz<span className={styles.dot}>.</span>
            </span>
            <span className={styles.caption}>Workspace screenshot — coming soon</span>
          </div>
        </div>
      </figure>
    </Section>
  );
}
