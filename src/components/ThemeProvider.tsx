"use client";
// src/components/ThemeProvider.tsx
//
// Wraps the app (see layout.tsx). On mount:
//   1. Immediately applies whatever theme is cached in localStorage, so
//      there's no flash of the wrong theme while the network request
//      below is in flight.
//   2. Fetches /api/settings to get the company's actual configured
//      theme (source of truth) and re-applies if it differs from the
//      cached one — this is what makes the theme a shared, company-wide
//      setting instead of a per-browser preference.
//
// Doesn't render any DOM of its own beyond its children — all the actual
// work is writing CSS variables onto <html> via applyTheme().

import { useEffect } from "react";
import { applyTheme, getCachedTheme, DEFAULT_THEME } from "@/lib/theme";

export default function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    // Step 1 — instant, from local cache (or default if none yet).
    applyTheme(getCachedTheme());

    // Step 2 — reconcile with the server's canonical setting.
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        const serverTheme = d?.settings?.theme;
        if (serverTheme) applyTheme(serverTheme);
      })
      .catch(() => {
        // If settings can't be reached, just stay on the cached/default
        // theme — never block rendering on this.
      });
  }, []);

  return <>{children}</>;
}
