import styles from "./MockupSpreadV2.module.css";
import { DemoFrame } from "../DemoFrame";

export function MockupSpreadV2() {
  return (
    <section
      id="see-it"
      className={styles.section}
      aria-labelledby="v2-spread-title"
      data-reveal-target
    >
      <div className={styles.inner}>
        <p className={styles.eyebrow}>03 · See it</p>
        <h2 id="v2-spread-title" className={styles.title}>
          Your vault. Your files. Your terms.
        </h2>
        <p className={styles.lead}>
          The agent&apos;s output lands as navigable, linked markdown you can read side-by-side with your
          own notes, validate whenever you need, and restore to any earlier version.
        </p>
        <DemoFrame size="spread" />
      </div>
    </section>
  );
}
