"use client";
import { useState } from "react";
import type { Screen } from "@/app/page";
import { Icon, IconName } from "@/components/icons";

// ────────────────────────────────────────────────────────────────────────
// Two kinds of sidebar rows, matching the reference layout:
//   - "leaf"    → a single item with its own icon, no children, no
//                 chevron. When active it gets a solid filled pill
//                 (like "Home" in the reference screenshot).
//   - "section" → a labelled group with an icon + chevron. Expanding it
//                 reveals plain-text children (no icons on children —
//                 that's deliberate, matches the reference). When the
//                 section contains the active screen, the header row
//                 gets a translucent pill + border (like "Sales" in the
//                 reference, shown expanded and highlighted).
// ────────────────────────────────────────────────────────────────────────
interface LeafItem {
  kind: "leaf";
  id: Screen;
  label: string;
  icon: IconName;
}
interface SectionItem {
  kind: "section";
  key: string;
  label: string;
  icon: IconName;
  children: Array<{ id: Screen; label: string; badge?: "IN" | "OUT" }>;
}
type NavRow = LeafItem | SectionItem;

const NAV: NavRow[] = [
  { kind: "leaf", id: "dashboard", label: "Home", icon: "dashboard" },
  { kind: "leaf", id: "additem", label: "Items", icon: "box" },

  {
    kind: "section",
    key: "crm",
    label: "CRM",
    icon: "users",
    children: [
      { id: "leads", label: "Leads" },
      { id: "contacts", label: "Contacts" },
      { id: "customers", label: "Customers" },
      { id: "opportunities", label: "Opportunities" },
      { id: "vendors", label: "Vendors" },
      { id: "projects", label: "Projects" },
    ],
  },
  {
    kind: "section",
    key: "inventory",
    label: "Inventory",
    icon: "list",
    children: [
      { id: "stock", label: "View Stock" },
      { id: "transfers", label: "Stock Transfer" },
      { id: "stock_serials", label: "Stock & Serials" },
    ],
  },
  {
    kind: "section",
    key: "sales",
    label: "Sales",
    icon: "receipt",
    children: [
      { id: "quotation", label: "Quotation" },
      { id: "proforma", label: "Proforma Invoice" },
      { id: "sale", label: "New Sale / Dispatch", badge: "OUT" },
      { id: "invoices", label: "All Invoices" },
      { id: "challan", label: "Delivery Challan" },
      { id: "packing_list", label: "Packing List" },
      { id: "credit_note", label: "Credit Note" },
    ],
  },
  {
    kind: "section",
    key: "purchases",
    label: "Purchases",
    icon: "box",
    children: [
      { id: "purchase", label: "New Purchase", badge: "IN" },
      { id: "debit_note", label: "Debit Note" },
    ],
  },
  {
    kind: "section",
    key: "expenses",
    label: "Expenses",
    icon: "wallet",
    children: [
      { id: "expenses", label: "Company Expenses" },
      { id: "proj_expenses", label: "Project Expenses" },
    ],
  },
  {
    kind: "section",
    key: "admin",
    label: "Admin",
    icon: "settings",
    children: [
      { id: "employees", label: "Employees" },
      { id: "ledger", label: "Ledger" },
      { id: "downloads", label: "Downloads" },
      { id: "bin", label: "Bin" },
      { id: "audit_log", label: "Audit Log" },
      { id: "settings", label: "Settings" },
    ],
  },
];

const sectionOf = (screen: Screen): string | null => {
  for (const row of NAV) {
    if (row.kind === "section" && row.children.some((c) => c.id === screen)) {
      return row.key;
    }
  }
  return null;
};

export default function Sidebar({
  current,
  onChange,
}: {
  current: Screen;
  onChange: (s: Screen) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() => {
    const active = sectionOf(current);
    return new Set(active ? ["sales", active] : ["sales"]);
  });

  const toggle = (key: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleChildClick = (id: Screen, sectionKey: string) => {
    setOpen((prev) => new Set([...prev, sectionKey]));
    onChange(id);
  };

  return (
    <div
      style={{
        width: 216,
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

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px 8px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {NAV.map((row) => {
          if (row.kind === "leaf") {
            const isActive = row.id === current;
            return (
              <div
                key={row.id}
                onClick={() => onChange(row.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "8px 10px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? "#fff" : "var(--text-dim)",
                  background: isActive ? "var(--accent)" : "transparent",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => {
                  if (!isActive)
                    e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive)
                    e.currentTarget.style.background = "transparent";
                }}
              >
                <Icon name={row.icon} size={15} />
                {row.label}
              </div>
            );
          }

          const isOpen = open.has(row.key);
          const hasActive = row.children.some((c) => c.id === current);

          return (
            <div key={row.key}>
              <div
                onClick={() => toggle(row.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: hasActive ? 600 : 400,
                  color: hasActive ? "var(--accent)" : "var(--text-dim)",
                  background: hasActive
                    ? "rgba(59,130,246,0.12)"
                    : "transparent",
                  border: hasActive
                    ? "1px solid rgba(59,130,246,0.35)"
                    : "1px solid transparent",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => {
                  if (!hasActive)
                    e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                }}
                onMouseLeave={(e) => {
                  if (!hasActive)
                    e.currentTarget.style.background = "transparent";
                }}
              >
                <Icon
                  name="chevron-right"
                  size={11}
                  style={{
                    color: "var(--text-muted)",
                    transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                    transition: "transform 0.15s ease",
                    flexShrink: 0,
                  }}
                />
                <Icon name={row.icon} size={15} />
                <span style={{ flex: 1 }}>{row.label}</span>
              </div>

              {isOpen && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                    marginTop: 2,
                    marginBottom: 4,
                  }}
                >
                  {row.children.map((child) => {
                    const isActive = child.id === current;
                    return (
                      <div
                        key={child.id}
                        onClick={() => handleChildClick(child.id, row.key)}
                        style={{
                          padding: "7px 10px 7px 36px",
                          borderRadius: 7,
                          cursor: "pointer",
                          fontSize: 12.5,
                          color: isActive
                            ? "var(--accent)"
                            : "var(--text-muted)",
                          fontWeight: isActive ? 600 : 400,
                          background: isActive
                            ? "rgba(59,130,246,0.1)"
                            : "transparent",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          transition: "background 0.1s, color 0.1s",
                        }}
                        onMouseEnter={(e) => {
                          if (!isActive) {
                            e.currentTarget.style.background =
                              "rgba(255,255,255,0.04)";
                            e.currentTarget.style.color = "var(--text)";
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive) {
                            e.currentTarget.style.background = "transparent";
                            e.currentTarget.style.color = "var(--text-muted)";
                          }
                        }}
                      >
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {child.label}
                        </span>
                        {child.badge && (
                          <span
                            style={{
                              fontSize: 8,
                              fontWeight: 700,
                              padding: "1px 5px",
                              borderRadius: 99,
                              flexShrink: 0,
                              background:
                                child.badge === "IN"
                                  ? "rgba(34,197,94,0.15)"
                                  : "rgba(239,68,68,0.15)",
                              color:
                                child.badge === "IN"
                                  ? "var(--accent-green)"
                                  : "var(--accent-red)",
                              letterSpacing: "0.03em",
                            }}
                          >
                            {child.badge}
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
