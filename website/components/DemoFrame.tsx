"use client";

import { useEffect, useRef, useState } from "react";
import { ProductMockup } from "./ProductMockup";
import styles from "./DemoFrame.module.css";

type DemoFrameProps = {
  size?: "hero" | "spread";
};

/**
 * Live product demo. Renders the static ProductMockup as the loading fallback,
 * then lazily mounts an iframe of the real renderer (built from src/demo) once
 * the frame nears the viewport. The iframe is sandboxed read-only: scripts run
 * (the app needs them) but popups, top-navigation, modals and forms are denied,
 * so no interaction can navigate away, open a dialog, or submit anything. The
 * demo's window.marvin mock already makes every write an in-memory no-op.
 */
export function DemoFrame({ size = "hero" }: DemoFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [src, setSrc] = useState("/demo/index.html");

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Respect reduced-data / keep it lazy: only mount the iframe near view.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          // The embedded demo follows the host page's theme.
          const theme =
            document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
          setSrc(`/demo/index.html?theme=${theme}`);
          setShow(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className={styles.frame + " " + styles[size]}>
      {/* Static mockup — the loading fallback; stays behind the iframe.
          fill mode makes its primary window fill the frame, matching the
          iframe's footprint so there's no size jump when the demo loads. */}
      <div className={styles.fallback} aria-hidden={loaded || undefined}>
        <ProductMockup size="spread" fill />
      </div>

      {show ? (
        <iframe
          className={styles.iframe + (loaded ? " " + styles.iframeLoaded : "")}
          src={src}
          title="Marvinz live demo"
          loading="lazy"
          sandbox="allow-scripts allow-same-origin"
          onLoad={() => setLoaded(true)}
        />
      ) : null}
    </div>
  );
}
