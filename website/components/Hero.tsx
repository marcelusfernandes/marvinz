import styles from "./Hero.module.css";

const RELEASES_URL = "https://github.com/marcelusfernandes/marvinz/releases";

const OS_LINKS = [
  { label: "macOS", href: RELEASES_URL },
  { label: "Windows", href: RELEASES_URL },
  { label: "Linux", href: RELEASES_URL },
];

export function Hero() {
  return (
    <section className={styles.hero} aria-labelledby="hero-tagline">
      <div className={styles.glow} aria-hidden="true" />

      <div className={styles.inner}>
        <ul className={styles.meta}>
          <li>
            <span className={styles.metaKey}>Platform</span> macOS · Windows · Linux
          </li>
          <li>
            <span className={styles.metaKey}>Category</span> Visual workspace for Claude Code
          </li>
          <li>
            <span className={styles.metaKey}>License</span> Open source
          </li>
        </ul>

        <p className={styles.wordmark}>
          Marvinz<span className={styles.dot}>.</span>
        </p>

        <h1 id="hero-tagline" className={styles.tagline}>
          Where AI output becomes knowledge you can navigate.
        </h1>

        <p className={styles.subdesc}>
          The visual workspace for <b>Claude Code</b>.
        </p>

        <div className={styles.actions}>
          <a className={styles.cta} href={RELEASES_URL}>
            Download
          </a>
          <p className={styles.osLinks}>
            {OS_LINKS.map((os, i) => (
              <span key={os.label}>
                <a href={os.href}>{os.label}</a>
                {i < OS_LINKS.length - 1 ? <span className={styles.sep}>·</span> : null}
              </span>
            ))}
          </p>
        </div>
      </div>
    </section>
  );
}
