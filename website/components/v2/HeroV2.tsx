import styles from "./HeroV2.module.css";
import { DemoFrame } from "../DemoFrame";

const RELEASES_URL = "https://github.com/marcelusfernandes/marvinz/releases";

export function HeroV2() {
  return (
    <section className={styles.hero} aria-labelledby="v2-hero-headline" data-animate="hero">
      <div className={styles.inner}>
        <div className={styles.col}>
          <h1 id="v2-hero-headline" className={styles.headline} data-step="0">
            Where AI output
            <br />
            becomes knowledge
            <br />
            you can navigate<span className={styles.dot}>.</span>
          </h1>

          <p className={styles.subdesc} data-step="1">
            The visual workspace for Claude Code &amp; Codex. Point it at your markdown
            vault and read, validate, and restore what the agent writes.
          </p>

          <div className={styles.actions} data-step="2">
            <a className={styles.ctaPrimary} href={RELEASES_URL}>
              <span className={styles.ctaChip} aria-hidden="true">
                ↓
              </span>
              Download
            </a>
            <a className={styles.ctaSecondary} href="#how-it-works">
              See how it works
            </a>
          </div>

          <p className={styles.openSource} data-step="2">
            Open source and local-first — your vault never leaves your machine.
          </p>
        </div>

        {/* Product window inset on a solid accent plate that bleeds into the
            hero fold (cutthecode pattern). The plate is a full-width filled
            rounded-rect, radius on the top corners only; the window's top rises
            clear of the plate. The hero's overflow:hidden crops both at the
            fold. */}
        <div className={styles.frameWrap} data-step="3">
          <div className={styles.shape} aria-hidden="true" />
          <div className={styles.window}>
            <DemoFrame size="hero" />
          </div>
        </div>
      </div>
    </section>
  );
}
