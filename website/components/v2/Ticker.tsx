import styles from "./Ticker.module.css";

const PHRASES = [
  "Where AI output becomes knowledge",
  "Navigate your vault",
  "Approve every tool call",
  "Restore any version",
  "Read side-by-side",
  "Your files, your terms",
];

function Run() {
  return (
    <>
      {PHRASES.map((phrase, i) => (
        <span key={i}>
          {phrase} <span className={styles.dot}>·</span>{" "}
        </span>
      ))}
    </>
  );
}

export function Ticker() {
  return (
    <div className={styles.ticker} aria-hidden="true">
      <p className={styles.track}>
        {/* Duplicated run so the leftward scroll loops without a visible seam */}
        <Run />
        <Run />
      </p>
    </div>
  );
}
