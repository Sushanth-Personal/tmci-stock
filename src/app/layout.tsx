import type { Metadata, Viewport } from "next";
import "./globals.css";
import { createClient } from "@supabase/supabase-js";
import { THEMES, DEFAULT_THEME, themeToCssVars } from "@/lib/theme";
import ThemeProvider from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "TMCI Stock · Fluke Products",
  description: "Live inventory management — Google Sheets backend",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

// Resolves the company's configured theme SERVER-SIDE, per request, so
// the correct theme is already in the HTML before the browser paints
// anything — this is what avoids a "flash of wrong theme" entirely,
// rather than just minimizing it. Falls back to the default theme on
// any error (missing env vars, network hiccup, row not found yet) —
// this must never be the reason the app fails to render.
async function getServerTheme(): Promise<string> {
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return DEFAULT_THEME;
    const supabase = createClient(url, key);
    const { data } = await supabase
      .from("company_settings")
      .select("theme")
      .eq("id", 1)
      .single();
    return (data?.theme as string) || DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const themeKey = await getServerTheme();
  const theme = THEMES[themeKey] ?? THEMES[DEFAULT_THEME];
  const vars = themeToCssVars(theme);
  const cssVarsBlock = Object.entries(vars)
    .map(([name, value]) => `${name}: ${value};`)
    .join(" ");

  return (
    <html lang="en" data-theme={theme.key}>
      <head>
        {/* Overrides globals.css's static defaults with whatever theme is
            actually configured, before anything else paints. */}
        <style
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: `:root { ${cssVarsBlock} }` }}
        />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
