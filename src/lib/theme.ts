// src/lib/theme.ts
//
// ─────────────────────────────────────────────────────────────────────
//   THE ONE PLACE TO CHANGE THE APP'S COLORS
// ─────────────────────────────────────────────────────────────────────
// Every color used across the app should ultimately trace back to a
// token defined here. Change a hex value in THEMES below (or add a
// whole new theme) and it propagates everywhere that uses the matching
// CSS variable — no hunting through 50 files.
//
// How it plugs in:
//   1. `applyTheme(name)` writes every token as a CSS custom property
//      (`--bg`, `--accent`, `--accent-red-bg`, ...) onto <html>, plus a
//      handful of *derived* alpha-blended variants (e.g. `--accent-red-bg`
//      is `--accent-red` at 8% opacity) so components can stop writing
//      one-off `rgba(239,68,68,0.08)` literals and use `--accent-red-bg`
//      instead.
//   2. `globals.css` still declares the SAME variable names with the
//      "dark" theme's values as static defaults — that's what paints
//      before JS hydrates, so there's no flash of unstyled content.
//      `<ThemeProvider>` (src/components/ThemeProvider.tsx) then applies
//      whatever theme is actually configured, overriding those defaults
//      client-side.
//   3. The active theme is stored server-side, in
//      `company_settings.theme` (via /api/settings), so it's a company-
//      wide setting rather than a per-browser preference — persisted to
//      localStorage too, purely as a fast local cache to avoid a flash
//      of the wrong theme before the settings fetch resolves.
//
// To add a new theme: copy an existing entry in THEMES, rename its key,
// tweak the hex values, and it immediately shows up in the theme picker
// in Settings (src/components/Settings.tsx) — no other code changes.
// ─────────────────────────────────────────────────────────────────────

export interface ThemeColors {
  bg: string;
  bgCard: string;
  bgInput: string;
  border: string;
  text: string;
  textMuted: string;
  textDim: string;
  accent: string;
  accentGreen: string;
  accentAmber: string;
  accentRed: string;
}

export interface ThemeDefinition {
  key: string;
  label: string;
  /** Shown as a little preview swatch in the theme picker. */
  previewBg: string;
  previewAccent: string;
  colors: ThemeColors;
}

export const THEMES: Record<string, ThemeDefinition> = {
  dark: {
    key: "dark",
    label: "Slate (default)",
    previewBg: "#0f1117",
    previewAccent: "#3b82f6",
    colors: {
      bg: "#0f1117",
      bgCard: "#161b27",
      bgInput: "#1d2535",
      border: "#2a3347",
      text: "#e2e8f0",
      textMuted: "#64748b",
      textDim: "#94a3b8",
      accent: "#3b82f6",
      accentGreen: "#22c55e",
      accentAmber: "#f59e0b",
      accentRed: "#ef4444",
    },
  },
  midnight: {
    key: "midnight",
    label: "Midnight Indigo",
    previewBg: "#0d0e1a",
    previewAccent: "#818cf8",
    colors: {
      bg: "#0d0e1a",
      bgCard: "#151726",
      bgInput: "#1c1f33",
      border: "#2a2e4a",
      text: "#e6e6f5",
      textMuted: "#6b6f95",
      textDim: "#9598bd",
      accent: "#818cf8",
      accentGreen: "#34d399",
      accentAmber: "#fbbf24",
      accentRed: "#fb7185",
    },
  },
  charcoal: {
    key: "charcoal",
    label: "Charcoal Amber",
    previewBg: "#141414",
    previewAccent: "#c2761f",
    colors: {
      bg: "#141414",
      bgCard: "#1c1c1c",
      bgInput: "#242424",
      border: "#333333",
      text: "#ededed",
      textMuted: "#7a7a7a",
      textDim: "#a3a3a3",
      accent: "#c2761f",
      accentGreen: "#7cc576",
      accentAmber: "#f0a63a",
      accentRed: "#e05a5a",
    },
  },
  daylight: {
    key: "daylight",
    label: "Daylight (light mode)",
    previewBg: "#f4f5f7",
    previewAccent: "#2563eb",
    colors: {
      bg: "#f4f5f7",
      bgCard: "#ffffff",
      bgInput: "#f0f1f4",
      border: "#dde1e8",
      text: "#1a2035",
      textMuted: "#8896b0",
      textDim: "#5a6478",
      accent: "#2563eb",
      accentGreen: "#16a34a",
      accentAmber: "#d97706",
      accentRed: "#dc2626",
    },
  },
  pepper: {
    key: "pepper",
    label: "Pepper Light",
    previewBg: "#eef3fb",
    previewAccent: "#3b82f6",
    colors: {
      bg: "#eef3fb",
      bgCard: "#ffffff",
      bgInput: "#f4f8fd",
      border: "#dbe6f5",
      text: "#152040",
      textMuted: "#7c8aa8",
      textDim: "#43537a",
      accent: "#3b82f6",
      accentGreen: "#16a34a",
      accentAmber: "#e07f13",
      accentRed: "#dc2626",
    },
  },
};

export const DEFAULT_THEME = "dark";

/** Given a hex color like "#3b82f6", returns "59, 130, 246" for use in rgba(). */
function hexToRgbTriplet(hex: string): string {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

/**
 * Builds the full set of CSS custom properties for a theme, including
 * derived alpha-blended "-bg" variants for each accent color. This is
 * the single function that decides what variable names exist — add a
 * token here once and it's available to every component immediately.
 */
export function themeToCssVars(theme: ThemeDefinition): Record<string, string> {
  const c = theme.colors;
  return {
    "--bg": c.bg,
    "--bg-card": c.bgCard,
    "--bg-input": c.bgInput,
    "--border": c.border,
    "--text": c.text,
    "--text-muted": c.textMuted,
    "--text-dim": c.textDim,
    "--accent": c.accent,
    "--accent-green": c.accentGreen,
    "--accent-amber": c.accentAmber,
    "--accent-red": c.accentRed,

    // RGB triplets, so components can build custom-opacity rgba() without
    // hardcoding the hex — e.g. `rgba(var(--accent-rgb), 0.15)`.
    "--accent-rgb": hexToRgbTriplet(c.accent),
    "--accent-green-rgb": hexToRgbTriplet(c.accentGreen),
    "--accent-amber-rgb": hexToRgbTriplet(c.accentAmber),
    "--accent-red-rgb": hexToRgbTriplet(c.accentRed),

    // Pre-mixed translucent backgrounds — the replacement for the
    // `rgba(59,130,246,0.1)` / `rgba(239,68,68,0.08)` literals scattered
    // through the app. Same opacities as what's already used everywhere
    // (0.08 for subtle banners, 0.12 for active-row highlights), so
    // swapping a literal for the matching var is a drop-in change.
    "--accent-bg-subtle": `rgba(${hexToRgbTriplet(c.accent)}, 0.08)`,
    "--accent-bg": `rgba(${hexToRgbTriplet(c.accent)}, 0.12)`,
    "--accent-border": `rgba(${hexToRgbTriplet(c.accent)}, 0.35)`,
    "--accent-green-bg-subtle": `rgba(${hexToRgbTriplet(c.accentGreen)}, 0.08)`,
    "--accent-green-bg": `rgba(${hexToRgbTriplet(c.accentGreen)}, 0.12)`,
    "--accent-green-border": `rgba(${hexToRgbTriplet(c.accentGreen)}, 0.3)`,
    "--accent-amber-bg-subtle": `rgba(${hexToRgbTriplet(c.accentAmber)}, 0.08)`,
    "--accent-amber-bg": `rgba(${hexToRgbTriplet(c.accentAmber)}, 0.12)`,
    "--accent-amber-border": `rgba(${hexToRgbTriplet(c.accentAmber)}, 0.3)`,
    "--accent-red-bg-subtle": `rgba(${hexToRgbTriplet(c.accentRed)}, 0.08)`,
    "--accent-red-bg": `rgba(${hexToRgbTriplet(c.accentRed)}, 0.12)`,
    "--accent-red-border": `rgba(${hexToRgbTriplet(c.accentRed)}, 0.3)`,
  };
}

const STORAGE_KEY = "tmci-theme";

/** Applies a theme by writing its CSS variables onto <html>. Client-only. */
export function applyTheme(themeKey: string) {
  if (typeof document === "undefined") return;
  const theme = THEMES[themeKey] ?? THEMES[DEFAULT_THEME];
  const vars = themeToCssVars(theme);
  const root = document.documentElement;
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
  root.setAttribute("data-theme", theme.key);
  try {
    localStorage.setItem(STORAGE_KEY, theme.key);
  } catch {
    // localStorage unavailable (private mode, etc.) — fine, just skip caching
  }
}

/** Fast local cache read, used before the server settings fetch resolves. */
export function getCachedTheme(): string {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}
