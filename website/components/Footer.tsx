import styles from "./Footer.module.css";

const REPO_URL = "https://github.com/marcelusfernandes/marvinz";
const RELEASES_URL = "https://github.com/marcelusfernandes/marvinz/releases";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brandCol}>
          <p className={styles.wordmark}>
            Marvinz<span className={styles.dot}>.</span>
          </p>
          <p className={styles.tagline}>The visual workspace for Claude Code.</p>
        </div>

        <nav className={styles.links} aria-label="Footer">
          <a href={REPO_URL}>GitHub</a>
          <a href={RELEASES_URL}>Releases</a>
        </nav>
      </div>

      <div className={styles.creditsRow}>
        <small className={styles.credits}>
          Geist · Geist Mono · Inter (SIL OFL) · Codicons © Microsoft (CC-BY-4.0)
        </small>
      </div>
    </footer>
  );
}
