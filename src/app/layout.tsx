import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TMCI Stock · Fluke Products",
  description: "Live inventory management — Google Sheets backend",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
