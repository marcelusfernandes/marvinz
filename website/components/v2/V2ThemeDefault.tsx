"use client";

import { useEffect } from "react";

/**
 * v2 currently ships LIGHT only (user decision). The full dark implementation
 * still exists in the code (tokens, [data-theme='dark'] overrides, sheet
 * overrides) but is DISABLED on /v2: this component forces light and the theme
 * toggle is hidden on this route. To re-enable dark mode on /v2, restore the
 * toggle in the TopBar and drop the forced light default below.
 */
export function V2ThemeDefault() {
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
  }, []);

  return null;
}
