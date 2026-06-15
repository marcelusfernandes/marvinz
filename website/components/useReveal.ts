"use client";

import { useEffect } from "react";

/**
 * Attaches scroll-triggered reveals to every [data-reveal-target] element.
 * On mount it stamps `data-reveal` (so SSR renders content visible, no FOUC),
 * then an IntersectionObserver flips `data-visible="true"` once each enters view.
 * Under prefers-reduced-motion the observer is skipped entirely and elements
 * stay visible — a second layer of defense beyond the CSS media query.
 */
export function useReveal() {
  useEffect(() => {
    const targets = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal-target]")
    );
    if (targets.length === 0) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      // Leave everything visible; do not register the observer.
      return;
    }

    // Activate the hidden initial state only now that JS is running.
    targets.forEach((el) => el.setAttribute("data-reveal", ""));

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.setAttribute("data-visible", "true");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -60px 0px" }
    );

    targets.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);
}
