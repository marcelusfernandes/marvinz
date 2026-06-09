import { ThemeToggle } from "./ThemeToggle";
import styles from "./TopBar.module.css";

const NAV_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#see-it", label: "See it" },
];

export function TopBar() {
  return (
    <header className={styles.topbar}>
      <div className={styles.inner}>
        <a href="#top" className={styles.brand}>
          Marvinz<span className={styles.dot}>.</span>
        </a>

        <nav className={styles.nav} aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        <ThemeToggle />
      </div>
    </header>
  );
}
