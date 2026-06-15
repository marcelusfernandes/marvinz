"use client";

import { useEffect, useState } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { ProgressiveBlur } from "./magicui/progressive-blur";
import styles from "./TopBar.module.css";

const NAV_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#see-it", label: "See it" },
];

export function TopBar({
  solid = false,
  hideToggle = false,
}: {
  solid?: boolean;
  /* Dark mode is implemented but disabled on /v2 by user decision — re-enable
     by passing hideToggle={false} (or removing the prop) to restore the toggle. */
  hideToggle?: boolean;
}) {
  // Progressive blur is tied directly to scroll position: it ramps from 0 to
  // full over the first ~160px of scroll, so it grows smoothly as you scroll
  // instead of popping in at a threshold.
  const [blurOpacity, setBlurOpacity] = useState(0);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      setBlurOpacity(Math.min(1, Math.max(0, window.scrollY / 160)));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <header className={styles.topbar + (solid ? " " + styles.solid : "")}>
      {solid && (
        <div
          className={styles.blurScroll}
          style={{ opacity: blurOpacity }}
          aria-hidden="true"
        >
          <ProgressiveBlur position="top" height="132px" />
        </div>
      )}
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

        {hideToggle ? <span aria-hidden="true" /> : <ThemeToggle />}
      </div>
    </header>
  );
}
