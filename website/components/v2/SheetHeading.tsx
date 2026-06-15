import type { ReactNode } from "react";
import styles from "./SheetHeading.module.css";

type SheetHeadingProps = {
  eyebrow: string;
  title: string;
  titleId?: string;
  lead?: ReactNode;
};

export function SheetHeading({ eyebrow, title, titleId, lead }: SheetHeadingProps) {
  return (
    <div className={styles.heading}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>
      {lead ? <p className={styles.lead}>{lead}</p> : null}
    </div>
  );
}
