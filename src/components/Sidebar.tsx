"use client";
import { useState } from "react";
import type { Screen } from "@/app/page";

interface NavItem {
  id: Screen;
  label: string;
  icon: string;
  badge?: string;
}

interface NavSection {
  key: string;
  label: string;
  icon: string;
  items: NavItem[];
}

const NAV: NavSection[] = [
  {
    key: "overview",
    label: "Overview",
    icon: "▦",
    items: [{ id: "dashboard", label: "Dashboard", icon: "▦" }],
  },
  {
    key: "crm",
    label: "CRM",
    icon: "👥",
    items: [
      { id: "customers", label: "Customers", icon: "👥" },
      { id: "vendors", label: "Vendors", icon: "🏭" },
      { id: "projects", label: "Projects", icon: "📁" },
    ],
  },
  {
    key: "sales",
    label: "Sales",
    icon: "🧾",
    items: [
      { id: "quotation", label: "Quotation", icon: "📄" },
      { id: "proforma", label: "Proforma Invoice", icon: "📋" },
      {
        id: "sale",
        label: "New Sale / Dispatch",
        icon: "⬆",
        badge: "STOCK OUT",
      },
      { id: "invoices", label: "All Invoices", icon: "🧾" },
      { id: "credit_note", label: "Credit Note", icon: "↩" },
      { id: "challan", label: "Delivery Challan", icon: "🚚" },
      { id: "packing_list", label: "Packing List", icon: "📦" },
      { id: "eway_bill", label: "E-Way Bill", icon: "🛣" },
    ],
  },
  {
    key: "inventory",
    label: "Inventory",
    icon: "📦",
    items: [
      { id: "purchase", label: "New Purchase", icon: "⬇", badge: "STOCK IN" },
      { id: "stock", label: "View Stock", icon: "≡" },
      { id: "transfers", label: "Stock Transfer", icon: "⇄" },
      { id: "debit_note", label: "Debit Note", icon: "📝" },
    ],
  },
  {
    key: "expenses",
    label: "Expenses",
    icon: "💸",
    items: [
      { id: "expenses", label: "Company Expenses", icon: "💸" },
      { id: "proj_expenses", label: "Project Expenses", icon: "🧾" },
    ],
  },
  {
    key: "people",
    label: "People",
    icon: "👤",
    items: [{ id: "employees", label: "Employees", icon: "👤" }],
  },
  {
    key: "admin",
    label: "Admin",
    icon: "⚙",
    items: [
      { id: "stock_serials", label: "Stock & Serials", icon: "🔢" },
      { id: "audit_log", label: "Audit Log", icon: "🔍" },
      { id: "ledger", label: "Ledger", icon: "📒" },
      { id: "downloads", label: "Downloads", icon: "↧" },
      { id: "settings", label: "Settings", icon: "⚙" },
    ],
  },
];

const DEFAULT_OPEN = new Set(["overview", "sales", "inventory"]);

export default function Sidebar({
  current,
  onChange,
}: {
  current: Screen;
  onChange: (s: Screen) => void;
}) {
  const currentSection =
    NAV.find((s) => s.items.some((i) => i.id === current))?.key ?? "";

  const [open, setOpen] = useState<Set<string>>(
    () => new Set([...DEFAULT_OPEN, currentSection]),
  );

  const toggle = (key: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleItemClick = (id: Screen, sectionKey: string) => {
    setOpen((prev) => new Set([...prev, sectionKey]));
    onChange(id);
  };

  return (
    <div
      style={{
        width: 210,
        background: "var(--bg-card)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        height: "100%",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "14px 14px 12px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontWeight: 700,
            fontSize: 13,
            color: "var(--text)",
            letterSpacing: "-0.01em",
          }}
        >
          TMCI Desk
        </div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
          Fluke Products · Live
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "6px 0 12px" }}>
        {NAV.map((section) => {
          const isOpen = open.has(section.key);
          const hasActive = section.items.some((i) => i.id === current);

          return (
            <div key={section.key}>
              <div
                onClick={() => toggle(section.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px 5px",
                  cursor: "pointer",
                  userSelect: "none",
                  marginTop: 2,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11 }}>{section.icon}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: hasActive ? "var(--accent)" : "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {section.label}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: 9,
                    color: "var(--text-muted)",
                    transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                    transition: "transform 0.15s ease",
                    display: "inline-block",
                  }}
                >
                  ▶
                </span>
              </div>

              {isOpen && (
                <div style={{ paddingBottom: 2 }}>
                  {section.items.map((item) => {
                    const isActive = item.id === current;
                    return (
                      <div
                        key={item.id}
                        onClick={() => handleItemClick(item.id, section.key)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 7,
                          padding: "6px 10px 6px 26px",
                          fontSize: 12,
                          cursor: "pointer",
                          color: isActive ? "var(--accent)" : "var(--text-dim)",
                          background: isActive
                            ? "rgba(59,130,246,0.1)"
                            : "transparent",
                          fontWeight: isActive ? 500 : 400,
                          borderLeft: isActive
                            ? "2px solid var(--accent)"
                            : "2px solid transparent",
                          transition: "background 0.1s",
                          borderRadius: "0 6px 6px 0",
                          marginRight: 6,
                        }}
                        onMouseEnter={(e) => {
                          if (!isActive)
                            (
                              e.currentTarget as HTMLDivElement
                            ).style.background = "rgba(255,255,255,0.04)";
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive)
                            (
                              e.currentTarget as HTMLDivElement
                            ).style.background = "transparent";
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            width: 16,
                            textAlign: "center",
                            flexShrink: 0,
                          }}
                        >
                          {item.icon}
                        </span>
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            flex: 1,
                          }}
                        >
                          {item.label}
                        </span>
                        {item.badge && (
                          <span
                            style={{
                              fontSize: 8,
                              fontWeight: 700,
                              padding: "1px 5px",
                              borderRadius: 99,
                              flexShrink: 0,
                              background:
                                item.badge === "STOCK IN"
                                  ? "rgba(34,197,94,0.15)"
                                  : "rgba(239,68,68,0.15)",
                              color:
                                item.badge === "STOCK IN"
                                  ? "var(--accent-green)"
                                  : "var(--accent-red)",
                              letterSpacing: "0.03em",
                            }}
                          >
                            {item.badge}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
