import styles from "./Footer.module.css";

const REPO_URL = "https://github.com/marcelusfernandes/marvinz";
const RELEASES_URL = `${REPO_URL}/releases`;
const ISSUES_URL = `${REPO_URL}/issues`;
const FEEDBACK_URL = `${REPO_URL}/issues/new`;
const FEATURE_URL = `${REPO_URL}/issues/new?labels=enhancement`;

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div>
          <p className={styles.wordmark}>
            Marvinz<span className={styles.dot}>.</span>
          </p>
          <p className={styles.tagline}>The visual workspace for Claude Code &amp; Codex.</p>
        </div>

        <div className={styles.linkGroups}>
          <nav className={styles.group} aria-label="Product">
            <span className={styles.groupTitle}>Product</span>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
              Releases
            </a>
            <a href="/changelog">Changelog</a>
          </nav>

          <nav className={styles.group} aria-label="Feedback">
            <span className={styles.groupTitle}>Feedback</span>
            <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer">
              Issues
            </a>
            <a href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">
              Send feedback
            </a>
            <a href={FEATURE_URL} target="_blank" rel="noopener noreferrer">
              Request a feature
            </a>
          </nav>
        </div>
      </div>

      <div className={styles.creditsRow}>
        <small className={styles.credits}>
          Geist · Geist Mono · Inter (SIL OFL) · Codicons © Microsoft (CC-BY-4.0)
        </small>
      </div>
    </footer>
  );
}
