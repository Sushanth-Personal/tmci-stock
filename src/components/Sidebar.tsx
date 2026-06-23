"use client";
import type { Screen } from "@/app/page";

const NAV: Array<{
  id: Screen;
  label: string;
  icon: string;
  section?: string;
}> = [
  { id: "dashboard", label: "Dashboard", icon: "▦", section: "Overview" },
  { id: "stock", label: "Stock View", icon: "≡" },
  { id: "sale", label: "Record Sale", icon: "⊕", section: "Transactions" },
  { id: "purchase", label: "Record Purchase", icon: "↓" },
  { id: "transfer", label: "Stock Transfer", icon: "⇄" },
  { id: "transactions", label: "Transaction History", icon: "🕘" },
  { id: "additem", label: "Add New Item", icon: "+", section: "Catalogue" },
  { id: "downloads", label: "Downloads", icon: "↧", section: "Reports" },
];

export default function Sidebar({
  current,
  onChange,
}: {
  current: Screen;
  onChange: (s: Screen) => void;
}) {
  return (
    <div
      style={{
        width: 176,
        background: "var(--bg-card)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        overflow: "hidden",
        height: "100%",
      }}
    >
      {/* Logo */}
      <div style={{ padding: "14px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>
          TMCI Stock
        </div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
          Fluke Products · Live Sheet
        </div>
      </div>

      {/* Nav */}
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
        {NAV.map((item) => (
          <div key={item.id}>
            {item.section && (
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 500,
                  color: "var(--text-muted)",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  padding: "10px 14px 4px",
                }}
              >
                {item.section}
              </div>
            )}
            <div
              onClick={() => onChange(item.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 14px",
                fontSize: 12,
                cursor: "pointer",
                color:
                  current === item.id ? "var(--accent)" : "var(--text-dim)",
                background:
                  current === item.id ? "rgba(59,130,246,0.1)" : "transparent",
                fontWeight: current === item.id ? 500 : 400,
                borderLeft:
                  current === item.id
                    ? "2px solid var(--accent)"
                    : "2px solid transparent",
                transition: "all 0.1s",
              }}
            >
              <span style={{ fontSize: 14, width: 16, textAlign: "center" }}>
                {item.icon}
              </span>
              {item.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
