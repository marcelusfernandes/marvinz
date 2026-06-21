"use client";

import { useCallback, useState } from "react";
import styles from "./DemoFrame.module.css";

type DemoFrameProps = {
  /* Kept for call-site compatibility (hero/spread). */
  size?: "hero" | "spread";
};

/**
 * Product window for the hero and "See it" spread. Renders a real screenshot of
 * the Marvinz app (captured from the running Electron build) — a pixel-faithful
 * copy: file tree, a rendered markdown note with an embedded diagram, and the
 * Claude Code / Codex terminal. A neutral skeleton holds the footprint until the
 * image decodes, then it fades in (no layout shift).
 */
export function DemoFrame(_props: DemoFrameProps = {}) {
  const [loaded, setLoaded] = useState(false);

  // A cached image can finish loading before React attaches onLoad, so the
  // event never fires and the fade-in is stuck at opacity 0. Catch that case
  // on mount via the ref (img.complete) so the screenshot always appears.
  const imgRef = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete) setLoaded(true);
  }, []);

  return (
    <div className={styles.frame}>
      <div className={styles.skeleton} aria-hidden={loaded || undefined} />
      <picture className={styles.picture}>
        {/* On phones the full 3-pane desktop window is illegible, so serve a
            crop of the editor pane (the rendered note) instead. */}
        <source media="(max-width: 760px)" srcSet="/hero-app-mobile.png" />
        <img
          ref={imgRef}
          className={styles.img + (loaded ? " " + styles.imgLoaded : "")}
          src="/hero-app.png"
          alt="Marvinz workspace — file tree, a rendered markdown note with an embedded diagram, and the Claude Code and Codex terminal"
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
        />
      </picture>
    </div>
  );
}
