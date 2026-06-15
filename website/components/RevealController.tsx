"use client";

import { useReveal } from "./useReveal";

/**
 * Renders nothing — only runs the scroll-reveal observer once on mount.
 * Keeps page.tsx a Server Component while isolating the client boundary.
 */
export function RevealController() {
  useReveal();
  return null;
}
