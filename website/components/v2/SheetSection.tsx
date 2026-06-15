import type { ReactNode } from "react";
import styles from "./SheetSection.module.css";

type SheetSectionProps = {
  id?: string;
  tone?: "1" | "2";
  ariaLabel: string;
  children: ReactNode;
};

/**
 * Light "sheet" that rises from the dark canvas with a large rounded top.
 * data-sheet="light" forces the light token set inside (spec §13.6), so the
 * sheet stays light regardless of the page's dark default theme.
 */
export function SheetSection({ id, tone = "1", ariaLabel, children }: SheetSectionProps) {
  return (
    <section
      id={id}
      data-sheet="light"
      data-reveal-target
      aria-label={ariaLabel}
      className={styles.sheet + " " + (tone === "2" ? styles.tone2 : styles.tone1)}
    >
      <div className={styles.inner}>{children}</div>
    </section>
  );
}
