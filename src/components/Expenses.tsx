"use client";
// src/components/Expenses.tsx
//
// Shared screen for BOTH "Company Expenses" and "Project Expenses"
// (src/app/page.tsx passes `type="company"` or `type="project"`).
//
// Design goals, in priority order:
//   1. Someone with no accounting background can log an expense in
//      under 10 seconds: date (defaults to today), amount, tap a
//      category, done.
//   2. The ~50 categories never appear as one long dropdown. They're
//      grouped into ~9-10 big, obvious buckets; picking a bucket reveals
//      only that bucket's categories. This is the CategoryPicker below.
//   3. Bulk entry: paste a chunk of a bank statement (or just a list of
//      "date  description  amount" lines) and the app extracts draft
//      rows with amounts pre-filled, so the person only has to tap a
//      category on each row instead of retyping every number by hand.

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  COMPANY_EXPENSE_GROUPS,
  PROJECT_EXPENSE_GROUPS,
  PAYMENT_METHODS,
  ExpenseGroup,
  findCategoryGroup,
} from "@/lib/expenseCategories";

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────
interface Expense {
  id: string;
  expense_type: "company" | "project";
  date: string;
  category_group: string;
  category: string;
  description: string | null;
  vendor: string | null;
  payment_method: string | null;
  reference_no: string | null;
  amount: number;
  project_name: string | null;
  created_at: string;
}

interface DraftRow {
  key: string;
  date: string;
  description: string;
  amount: number | "";
  vendor: string;
  category_group: string;
  category: string;
  project_name: string;
  include: boolean;
}

const fmtRs = (n: number) =>
  "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const todayISO = () => new Date().toISOString().split("T")[0];

// ────────────────────────────────────────────────────────────────────────
// Category picker — a modal with big tappable group tiles, then
// categories within the chosen group. Also has a plain search box so
// power users can just type "fuel" and jump straight there.
// ────────────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────────────
// Group icons — plain-stroke SVGs instead of emoji. Emoji render as full-
// color, differently-styled OS glyphs (an entirely different visual
// language than the rest of this app), which is what read as "cheap" —
// a monochrome icon in a tinted circle matches every other icon treatment
// already used across the app (Sidebar, buttons, etc).
// ────────────────────────────────────────────────────────────────────────
function GroupIconGlyph({ name }: { name: string }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "Employee Expenses":
    case "Manpower Costs":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
          <circle cx="17" cy="8" r="2.4" />
          <path d="M15.5 14.2c2.6.4 4.5 2.7 4.5 5.8" />
        </svg>
      );
    case "Office & Administrative":
      return (
        <svg {...common}>
          <rect x="5" y="3" width="14" height="18" rx="1" />
          <path d="M9 8h.01M9 12h.01M9 16h.01M15 8h.01M15 12h.01M15 16h.01" />
        </svg>
      );
    case "Utilities":
      return (
        <svg {...common}>
          <path d="M9 18h6" />
          <path d="M10 21h4" />
          <path d="M12 3a6 6 0 0 0-3.7 10.7c.6.5 1 1.2 1 2.3h5.4c0-1.1.4-1.8 1-2.3A6 6 0 0 0 12 3Z" />
        </svg>
      );
    case "Travel & Conveyance":
    case "Site-Related Expenses":
      return (
        <svg {...common}>
          <path d="M4 16V9a1 1 0 0 1 1-1h9l3.5 4H20a1 1 0 0 1 1 1v3" />
          <path d="M4 16h16" />
          <circle cx="7.5" cy="16.5" r="1.8" />
          <circle cx="17.5" cy="16.5" r="1.8" />
        </svg>
      );
    case "Professional & Legal":
    case "Documentation & Compliance":
      return (
        <svg {...common}>
          <path d="M12 3v18" />
          <path d="M5 7h14" />
          <path d="M5 7 2.5 12a2.5 2.5 0 0 0 5 0L5 7Z" />
          <path d="M19 7l-2.5 5a2.5 2.5 0 0 0 5 0L19 7Z" />
        </svg>
      );
    case "IT & Software":
    case "Design & Engineering":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="12" rx="1.2" />
          <path d="M2 20h20" />
          <path d="M9 20l1-4h4l1 4" />
        </svg>
      );
    case "Marketing & Sales":
      return (
        <svg {...common}>
          <path d="M3 10v4a1 1 0 0 0 1 1h2l4 4V5L6 9H4a1 1 0 0 0-1 1Z" />
          <path d="M15 8.5a4 4 0 0 1 0 7" />
          <path d="M18 6a7.5 7.5 0 0 1 0 12" />
        </svg>
      );
    case "Financial":
      return (
        <svg {...common}>
          <rect x="2.5" y="6" width="19" height="13" rx="1.5" />
          <path d="M2.5 10.5h19" />
          <path d="M6 14.5h4" />
        </svg>
      );
    case "Factory & Manufacturing":
    case "Manufacturing & Assembly":
      return (
        <svg {...common}>
          <path d="M3 21V10l5 3.5V10l5 3.5V10l5 3.5V6h3v15Z" />
          <path d="M3 21h18" />
        </svg>
      );
    case "Other General":
    case "Material Costs":
      return (
        <svg {...common}>
          <path d="M12 3 3 7.5 12 12l9-4.5Z" />
          <path d="M3 7.5V16l9 4.5 9-4.5V7.5" />
          <path d="M12 12v8.5" />
        </svg>
      );
    case "Vendor & Subcontracting":
      return (
        <svg {...common}>
          <path d="M14.5 3.5 20.5 9.5 9.5 20.5 3.5 14.5Z" />
          <path d="M8 16l-1.5 5L11.5 19" />
          <circle cx="17.5" cy="6.5" r="1.4" />
        </svg>
      );
    case "Logistics":
      return (
        <svg {...common}>
          <rect x="2" y="7" width="12" height="9" rx="1" />
          <path d="M14 10h4l3.5 3.5V16H14Z" />
          <circle cx="6.5" cy="17.5" r="1.7" />
          <circle cx="17" cy="17.5" r="1.7" />
        </svg>
      );
    case "Miscellaneous":
      return (
        <svg {...common}>
          <circle cx="6" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="18" cy="12" r="1.6" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
  }
}

function GroupBadge({
  name,
  color,
  size = 44,
}: {
  name: string;
  color: string;
  size?: number;
}) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: `${color}22`,
        color,
        flexShrink: 0,
      }}
    >
      <GroupIconGlyph name={name} />
    </span>
  );
}

// Same swatch cycle used by the filter dropdown — defined once here so
// both the picker tiles and the filter stay visually in sync.
const GROUP_SWATCHES = [
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#06b6d4",
  "#eab308",
  "#ec4899",
  "#14b8a6",
  "#6366f1",
];

function CategoryPicker({
  groups,
  onSelect,
  onClose,
  currentGroup,
}: {
  groups: ExpenseGroup[];
  onSelect: (group: string, category: string) => void;
  onClose: () => void;
  currentGroup?: string;
}) {
  const [activeGroup, setActiveGroup] = useState<string | null>(
    currentGroup ?? null,
  );
  const [search, setSearch] = useState("");

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const out: { group: string; category: string }[] = [];
    for (const g of groups) {
      for (const c of g.categories) {
        if (c.toLowerCase().includes(q) || g.group.toLowerCase().includes(q)) {
          out.push({ group: g.group, category: c });
        }
      }
    }
    return out;
  }, [groups, search]);

  const activeGroupObj = groups.find((g) => g.group === activeGroup);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        zIndex: 300,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          width: "100%",
          maxWidth: 520,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 15 }}>
              {activeGroupObj ? (
                <span>
                  <span
                    onClick={() => setActiveGroup(null)}
                    style={{ cursor: "pointer", color: "var(--accent)" }}
                  >
                    ← Categories
                  </span>
                  <span style={{ color: "var(--text-muted)" }}> / </span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      verticalAlign: "middle",
                    }}
                  >
                    <GroupBadge
                      name={activeGroupObj.group}
                      color={
                        GROUP_SWATCHES[
                          groups.indexOf(activeGroupObj) % GROUP_SWATCHES.length
                        ]
                      }
                      size={22}
                    />
                    {activeGroupObj.group}
                  </span>
                </span>
              ) : (
                "Select a category"
              )}
            </div>
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                fontSize: 22,
                lineHeight: 1,
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>
          {!activeGroupObj && (
            <input
              autoFocus
              placeholder="Type to search any category… e.g. fuel, rent, salary"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ fontSize: 14, padding: "10px 12px" }}
            />
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {search.trim() && !activeGroupObj ? (
            searchResults.length === 0 ? (
              <div
                style={{
                  color: "var(--text-muted)",
                  fontSize: 12,
                  textAlign: "center",
                  padding: 20,
                }}
              >
                No categories match "{search}"
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {searchResults.map((r) => (
                  <button
                    key={r.group + r.category}
                    onClick={() => onSelect(r.group, r.category)}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--bg-input)",
                      cursor: "pointer",
                      fontSize: 13,
                      color: "var(--text)",
                    }}
                  >
                    {r.category}
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--text-muted)",
                        marginTop: 2,
                      }}
                    >
                      {r.group}
                    </div>
                  </button>
                ))}
              </div>
            )
          ) : !activeGroupObj ? (
            // Group tiles
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: 10,
              }}
            >
              {groups.map((g, i) => (
                <button
                  key={g.group}
                  onClick={() => setActiveGroup(g.group)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 8,
                    padding: "16px 10px",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "var(--bg-input)",
                    cursor: "pointer",
                    color: "var(--text)",
                  }}
                >
                  <GroupBadge
                    name={g.group}
                    color={GROUP_SWATCHES[i % GROUP_SWATCHES.length]}
                  />
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      textAlign: "center",
                      lineHeight: 1.3,
                    }}
                  >
                    {g.group}
                  </span>
                  <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
                    {g.categories.length} items
                  </span>
                </button>
              ))}
            </div>
          ) : (
            // Category list within chosen group
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {activeGroupObj.categories.map((c) => (
                <button
                  key={c}
                  onClick={() => onSelect(activeGroupObj.group, c)}
                  style={{
                    textAlign: "left",
                    padding: "12px 14px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--bg-input)",
                    cursor: "pointer",
                    fontSize: 13,
                    color: "var(--text)",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.borderColor = "var(--accent)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.borderColor = "var(--border)")
                  }
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// A small button that shows the currently chosen category (or a prompt),
// and opens the CategoryPicker on click. Used both in the add form and
// inline in table rows.
function CategoryButton({
  group,
  category,
  onClick,
  compact,
}: {
  group: string;
  category: string;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      type="button"
      style={{
        textAlign: "left",
        width: "100%",
        padding: compact ? "6px 10px" : "9px 12px",
        borderRadius: 7,
        border: category
          ? "1px solid rgba(59,130,246,0.4)"
          : "1px dashed var(--border)",
        background: category ? "rgba(59,130,246,0.08)" : "var(--bg-input)",
        cursor: "pointer",
        color: category ? "var(--accent)" : "var(--text-muted)",
        fontSize: compact ? 11 : 13,
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
    >
      {category ? (
        <>
          <span style={{ fontWeight: 500 }}>{category}</span>
          {!compact && (
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
              {group}
            </span>
          )}
        </>
      ) : (
        <span>Tap to choose category…</span>
      )}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Add / edit expense form
// ────────────────────────────────────────────────────────────────────────
function ExpenseForm({
  type,
  groups,
  initial,
  onSaved,
  onCancel,
}: {
  type: "company" | "project";
  groups: ExpenseGroup[];
  initial?: Partial<Expense>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [amount, setAmount] = useState<number | "">(initial?.amount ?? "");
  const [group, setGroup] = useState(initial?.category_group ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [vendor, setVendor] = useState(initial?.vendor ?? "");
  const [paymentMethod, setPaymentMethod] = useState(
    initial?.payment_method ?? "Bank Transfer",
  );
  const [referenceNo, setReferenceNo] = useState(initial?.reference_no ?? "");
  const [projectName, setProjectName] = useState(initial?.project_name ?? "");
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    setError("");
    if (!amount || +amount <= 0) {
      setError("Enter an amount greater than 0.");
      return;
    }
    if (!category) {
      setError("Please choose a category.");
      return;
    }
    if (type === "project" && !projectName.trim()) {
      setError("Project name is required for project expenses.");
      return;
    }
    setSaving(true);
    try {
      const isEdit = !!initial?.id;
      const res = await fetch("/api/expenses", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: initial?.id,
          expense_type: type,
          date,
          amount: +amount,
          category_group: group,
          category,
          description: description || null,
          vendor: vendor || null,
          payment_method: paymentMethod || null,
          reference_no: referenceNo || null,
          project_name: type === "project" ? projectName : null,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || "Failed to save.");
        return;
      }
      onSaved();
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {showPicker && (
        <CategoryPicker
          groups={groups}
          currentGroup={group}
          onClose={() => setShowPicker(false)}
          onSelect={(g, c) => {
            setGroup(g);
            setCategory(c);
            setShowPicker(false);
          }}
        />
      )}

      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {initial?.id ? "Edit expense" : "Add new expense"}
      </div>

      {/* Amount + category are the two things that matter most — put
          them first, big, and impossible to miss. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1.4fr",
          gap: 10,
        }}
      >
        <div>
          <label style={{ fontSize: 11, color: "var(--text-dim)" }}>
            Amount (₹)
          </label>
          <input
            type="number"
            inputMode="decimal"
            autoFocus
            value={amount}
            placeholder="0"
            onChange={(e) =>
              setAmount(e.target.value === "" ? "" : +e.target.value)
            }
            style={{ fontSize: 18, fontWeight: 600, padding: "10px 12px" }}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--text-dim)" }}>
            Category
          </label>
          <CategoryButton
            group={group}
            category={category}
            onClick={() => setShowPicker(true)}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={{ fontSize: 11, color: "var(--text-dim)" }}>Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--text-dim)" }}>
            Payment method
          </label>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      {type === "project" && (
        <div>
          <label style={{ fontSize: 11, color: "var(--text-dim)" }}>
            Project / Customer name
          </label>
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="e.g. ONGC Kochi Refinery Panel Job"
          />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={{ fontSize: 11, color: "var(--text-dim)" }}>
            Paid to (vendor / person)
          </label>
          <input
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            placeholder="e.g. KSEB, Amazon, John"
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--text-dim)" }}>
            Reference / Cheque / UTR no.
          </label>
          <input
            value={referenceNo}
            onChange={(e) => setReferenceNo(e.target.value)}
            placeholder="optional"
          />
        </div>
      </div>

      <div>
        <label style={{ fontSize: 11, color: "var(--text-dim)" }}>Notes</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What was this for? (optional)"
        />
      </div>

      {error && (
        <div style={{ fontSize: 12, color: "var(--accent-red)" }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn-ghost" onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          className="btn-primary"
          onClick={handleSave}
          disabled={saving}
          type="button"
        >
          {saving ? "Saving…" : initial?.id ? "Save changes" : "Add expense"}
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Bulk paste importer — parses pasted bank-statement-ish text (or any
// "date  description  amount" list) into draft rows. Doesn't try to be a
// full bank-statement parser (formats vary too much bank to bank); it
// just extracts the last currency-looking number on each line as the
// amount and keeps the rest as the description, then lets the person
// review/edit every row and tap a category before saving.
// ────────────────────────────────────────────────────────────────────────
const DATE_PATTERNS: RegExp[] = [
  /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/, // 12/07/2026 or 12-07-26
  /(\d{1,2})[\-\s]([A-Za-z]{3})[\-\s](\d{2,4})/, // 12-Jul-2026
];

function tryParseDate(line: string): string | null {
  for (const re of DATE_PATTERNS) {
    const m = line.match(re);
    if (!m) continue;
    if (m.length === 4 && /[A-Za-z]/.test(m[2])) {
      const months: Record<string, number> = {
        jan: 0,
        feb: 1,
        mar: 2,
        apr: 3,
        may: 4,
        jun: 5,
        jul: 6,
        aug: 7,
        sep: 8,
        oct: 9,
        nov: 10,
        dec: 11,
      };
      const mon = months[m[2].toLowerCase().slice(0, 3)];
      if (mon === undefined) continue;
      let year = +m[3];
      if (year < 100) year += 2000;
      const d = new Date(year, mon, +m[1]);
      if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    } else {
      let [, a, b, c] = m;
      let year = +c;
      if (year < 100) year += 2000;
      // Assume DD/MM/YYYY (Indian format)
      const d = new Date(year, +b - 1, +a);
      if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    }
  }
  return null;
}

function parseBulkText(text: string): DraftRow[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const rows: DraftRow[] = [];
  let seq = 0;

  for (const line of lines) {
    // Find every currency-looking number: 1,234.56 or 1234 or 1234.00
    const amountMatches = [
      ...line.matchAll(/[\d]{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?/g),
    ]
      .map((m) => m[0])
      .filter((s) => s.replace(/,/g, "").length >= 2 || s.includes("."));

    if (amountMatches.length === 0) continue;

    // Skip obvious date-only tokens (already matched by date regex range)
    const dateStr = tryParseDate(line);

    // Heuristic: the amount is usually the LAST number-looking token on
    // the line for bank statements (balance often comes after debit/credit
    // in some formats, so also try second-to-last if the last looks like
    // a running balance with far more digits than typical).
    const candidateStr = amountMatches[amountMatches.length - 1];
    const amount = parseFloat(candidateStr.replace(/,/g, ""));
    if (!amount || amount <= 0) continue;

    // Skip if the line clearly denotes a credit/deposit — company
    // expense import cares about money OUT, not money IN. Still include
    // it but unchecked, so the person can flip it on if it's relevant.
    const looksLikeCredit = /\bcr\b|credit|deposit|received/i.test(line);

    // Description = line with the date and trailing amount stripped out
    let desc = line;
    if (dateStr) {
      for (const re of DATE_PATTERNS) desc = desc.replace(re, "").trim();
    }
    desc = desc.replace(candidateStr, "").trim();
    desc = desc.replace(/[|,\-–]+$/g, "").trim();
    desc = desc.replace(/\s{2,}/g, " ");

    rows.push({
      key: `draft-${seq++}`,
      date: dateStr ?? todayISO(),
      description: desc || line,
      amount,
      vendor: "",
      category_group: "",
      category: "",
      project_name: "",
      include: !looksLikeCredit,
    });
  }

  return rows;
}

function BulkImportModal({
  type,
  groups,
  onClose,
  onSaved,
}: {
  type: "company" | "project";
  groups: ExpenseGroup[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<DraftRow[] | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const parse = () => {
    const parsed = parseBulkText(text);
    if (parsed.length === 0) {
      setError(
        "Couldn't find any amounts in that text. Paste lines that include a date and an amount, e.g. '12/07/2026 KSEB Electricity 4500.00'.",
      );
      return;
    }
    setError("");
    setDrafts(parsed);
  };

  const updateDraft = (key: string, patch: Partial<DraftRow>) => {
    setDrafts((prev) =>
      prev ? prev.map((d) => (d.key === key ? { ...d, ...patch } : d)) : prev,
    );
  };

  const includedCount = drafts?.filter((d) => d.include).length ?? 0;
  const includedTotal =
    drafts
      ?.filter((d) => d.include)
      .reduce((s, d) => s + (Number(d.amount) || 0), 0) ?? 0;
  const missingCategory = drafts?.some((d) => d.include && !d.category);

  const handleSaveAll = async () => {
    if (!drafts) return;
    const toSave = drafts.filter((d) => d.include);
    if (toSave.length === 0) {
      setError("No rows selected to save.");
      return;
    }
    if (toSave.some((d) => !d.category)) {
      setError("Every included row needs a category before saving.");
      return;
    }
    if (type === "project" && toSave.some((d) => !d.project_name.trim())) {
      setError("Every included row needs a project name.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const body = toSave.map((d) => ({
        expense_type: type,
        date: d.date,
        amount: +d.amount,
        category_group: d.category_group,
        category: d.category,
        description: d.description || null,
        vendor: d.vendor || null,
        payment_method: "Bank Transfer",
        project_name: type === "project" ? d.project_name : null,
      }));
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const dd = await res.json();
      if (!res.ok) {
        setError(dd.error || "Failed to save.");
        return;
      }
      onSaved();
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.8)",
        zIndex: 250,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {pickerFor && (
        <CategoryPicker
          groups={groups}
          onClose={() => setPickerFor(null)}
          onSelect={(g, c) => {
            updateDraft(pickerFor, { category_group: g, category: c });
            setPickerFor(null);
          }}
        />
      )}

      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          width: "100%",
          maxWidth: 900,
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              📋 Bulk import from bank statement / bill list
            </div>
            <div
              style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}
            >
              Paste rows copied from your bank's passbook/statement page or any
              text with dates and amounts — we'll pull out draft entries for you
              to review.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 22,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {!drafts ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <textarea
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  "Paste statement lines here, e.g.\n\n12/07/2026  KSEB ELECTRICITY BILL  4,500.00\n14/07/2026  UPI-JOHN TECHNICIAN WAGES  8,000.00\n15/07/2026  AMAZON OFFICE SUPPLIES  1,240.50"
                }
                style={{
                  width: "100%",
                  minHeight: 220,
                  fontSize: 12,
                  fontFamily: "ui-monospace, monospace",
                  padding: 10,
                  resize: "vertical",
                }}
              />
              {error && (
                <div style={{ fontSize: 12, color: "var(--accent-red)" }}>
                  {error}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="btn-primary" onClick={parse} type="button">
                  Extract rows →
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                  Found {drafts.length} row{drafts.length !== 1 ? "s" : ""} ·{" "}
                  {includedCount} selected · {fmtRs(includedTotal)} total
                </div>
                <button
                  className="btn-ghost"
                  style={{ fontSize: 11 }}
                  onClick={() => {
                    setDrafts(null);
                    setError("");
                  }}
                >
                  ← Start over
                </button>
              </div>

              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                <div style={{ overflowX: "auto" }}>
                  <table style={{ minWidth: 900 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 28 }}></th>
                        <th style={{ width: 110 }}>Date</th>
                        <th style={{ minWidth: 220 }}>Description</th>
                        <th style={{ width: 110, textAlign: "right" }}>
                          Amount ₹
                        </th>
                        <th style={{ minWidth: 200 }}>Category</th>
                        {type === "project" && (
                          <th style={{ minWidth: 160 }}>Project</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {drafts.map((d) => (
                        <tr
                          key={d.key}
                          style={{ opacity: d.include ? 1 : 0.45 }}
                        >
                          <td>
                            <input
                              type="checkbox"
                              checked={d.include}
                              onChange={(e) =>
                                updateDraft(d.key, {
                                  include: e.target.checked,
                                })
                              }
                              style={{ width: "auto" }}
                            />
                          </td>
                          <td>
                            <input
                              type="date"
                              value={d.date}
                              onChange={(e) =>
                                updateDraft(d.key, { date: e.target.value })
                              }
                              style={{ fontSize: 11, padding: "4px 6px" }}
                            />
                          </td>
                          <td>
                            <input
                              value={d.description}
                              onChange={(e) =>
                                updateDraft(d.key, {
                                  description: e.target.value,
                                })
                              }
                              style={{ fontSize: 11, padding: "4px 6px" }}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              value={d.amount}
                              onChange={(e) =>
                                updateDraft(d.key, {
                                  amount:
                                    e.target.value === ""
                                      ? ""
                                      : +e.target.value,
                                })
                              }
                              style={{
                                fontSize: 11,
                                padding: "4px 6px",
                                textAlign: "right",
                              }}
                            />
                          </td>
                          <td>
                            <CategoryButton
                              group={d.category_group}
                              category={d.category}
                              compact
                              onClick={() => setPickerFor(d.key)}
                            />
                          </td>
                          {type === "project" && (
                            <td>
                              <input
                                value={d.project_name}
                                onChange={(e) =>
                                  updateDraft(d.key, {
                                    project_name: e.target.value,
                                  })
                                }
                                placeholder="Project name"
                                style={{ fontSize: 11, padding: "4px 6px" }}
                              />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {missingCategory && (
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--accent-amber)",
                    background: "rgba(245,158,11,0.08)",
                    border: "1px solid rgba(245,158,11,0.25)",
                    borderRadius: 6,
                    padding: "6px 10px",
                  }}
                >
                  ⚠ Some selected rows still need a category — tap the category
                  cell to pick one.
                </div>
              )}
              {error && (
                <div style={{ fontSize: 12, color: "var(--accent-red)" }}>
                  {error}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  className="btn-primary"
                  style={{ background: "var(--accent-green)" }}
                  onClick={handleSaveAll}
                  disabled={saving}
                  type="button"
                >
                  {saving
                    ? "Saving…"
                    : `✓ Save ${includedCount} expense${includedCount !== 1 ? "s" : ""}`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Custom, app-rendered category-group filter dropdown. Deliberately NOT a
// native <select> — native selects render with the OS's own popup styling
// (system font, white background on most platforms) which breaks out of
// the app's dark theme no matter what CSS is applied to the <select>
// itself. This follows the same pattern as the sort-menu dropdown in
// Invoices.tsx: a button that toggles a positioned panel we fully own.
function GroupFilterDropdown({
  groups,
  value,
  onChange,
}: {
  groups: ExpenseGroup[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = groups.find((g) => g.group === value);

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          padding: "7px 12px",
          borderRadius: 7,
          border: "1px solid var(--border)",
          background: "var(--bg-input)",
          color: value ? "var(--text)" : "var(--text-dim)",
          cursor: "pointer",
          whiteSpace: "nowrap",
          minWidth: 150,
          justifyContent: "space-between",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              flexShrink: 0,
              background: selected
                ? GROUP_SWATCHES[
                    groups.indexOf(selected) % GROUP_SWATCHES.length
                  ]
                : "var(--text-muted)",
            }}
          />
          {selected ? selected.group : "All categories"}
        </span>
        <span style={{ fontSize: 9, color: "var(--text-muted)" }}>▾</span>
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 90 }}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              zIndex: 91,
              minWidth: 220,
              background: "var(--bg-input)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
              overflow: "hidden",
              maxHeight: 320,
              overflowY: "auto",
            }}
          >
            <div
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              style={{
                padding: "8px 12px",
                fontSize: 12,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                color: !value ? "var(--accent)" : "var(--text)",
                fontWeight: !value ? 600 : 400,
                background: !value ? "rgba(59,130,246,0.1)" : "transparent",
              }}
            >
              All categories
              {!value && <span>✓</span>}
            </div>
            {groups.map((g, i) => {
              const active = value === g.group;
              return (
                <div
                  key={g.group}
                  onClick={() => {
                    onChange(g.group);
                    setOpen(false);
                  }}
                  style={{
                    padding: "8px 12px",
                    fontSize: 12,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    justifyContent: "space-between",
                    color: active ? "var(--accent)" : "var(--text)",
                    fontWeight: active ? 600 : 400,
                    background: active ? "rgba(59,130,246,0.1)" : "transparent",
                    borderTop: "1px solid var(--border)",
                  }}
                  onMouseEnter={(e) => {
                    if (!active)
                      e.currentTarget.style.background =
                        "rgba(255,255,255,0.03)";
                  }}
                  onMouseLeave={(e) => {
                    if (!active)
                      e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 9 }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: GROUP_SWATCHES[i % GROUP_SWATCHES.length],
                      }}
                    />
                    {g.group}
                  </span>
                  {active && <span>✓</span>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Main screen
// ────────────────────────────────────────────────────────────────────────
export default function Expenses({ type }: { type: "company" | "project" }) {
  const groups =
    type === "company" ? COMPANY_EXPENSE_GROUPS : PROJECT_EXPENSE_GROUPS;
  const title = type === "company" ? "Company Expenses" : "Project Expenses";

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [inlinePickerId, setInlinePickerId] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  // Filters
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const today = todayISO();
  const monthStart = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
  )
    .toISOString()
    .split("T")[0];
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [allTime, setAllTime] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type });
      if (!allTime) {
        if (from) params.set("from", from);
        if (to) params.set("to", to);
      }
      if (groupFilter) params.set("group", groupFilter);
      if (search.trim()) params.set("q", search.trim());
      const r = await fetch(`/api/expenses?${params.toString()}`);
      const d = await r.json();
      setExpenses(d.expenses ?? []);
    } catch {}
    setLoading(false);
  }, [type, from, to, allTime, groupFilter, search]);

  useEffect(() => {
    load();
  }, [load]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Move this expense to bin?")) return;
    try {
      await fetch(`/api/expenses?id=${id}`, { method: "DELETE" });
      setExpenses((prev) => prev.filter((e) => e.id !== id));
      showToast("Moved to bin.");
    } catch {
      showToast("Failed to delete.");
    }
  };

  const inlineCategoryUpdate = async (
    id: string,
    group: string,
    category: string,
  ) => {
    setExpenses((prev) =>
      prev.map((e) =>
        e.id === id ? { ...e, category_group: group, category } : e,
      ),
    );
    setInlinePickerId(null);
    try {
      await fetch("/api/expenses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, category_group: group, category }),
      });
    } catch {
      showToast("Failed to update category — refresh and try again.");
    }
  };

  const total = useMemo(
    () => expenses.reduce((s, e) => s + Number(e.amount), 0),
    [expenses],
  );

  const byGroup = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of expenses) {
      m.set(
        e.category_group,
        (m.get(e.category_group) ?? 0) + Number(e.amount),
      );
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [expenses]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            zIndex: 400,
            padding: "10px 16px",
            borderRadius: 8,
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            fontSize: 12,
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
            fontWeight: 500,
          }}
        >
          {toast}
        </div>
      )}

      {showForm && (
        <ExpenseForm
          type={type}
          groups={groups}
          initial={editing ?? undefined}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSaved={() => {
            setShowForm(false);
            setEditing(null);
            load();
            showToast("Expense saved.");
          }}
        />
      )}

      {showBulk && (
        <BulkImportModal
          type={type}
          groups={groups}
          onClose={() => setShowBulk(false)}
          onSaved={() => {
            setShowBulk(false);
            load();
            showToast("Expenses imported.");
          }}
        />
      )}

      {inlinePickerId && (
        <CategoryPicker
          groups={groups}
          currentGroup={
            expenses.find((e) => e.id === inlinePickerId)?.category_group
          }
          onClose={() => setInlinePickerId(null)}
          onSelect={(g, c) => inlineCategoryUpdate(inlinePickerId, g, c)}
        />
      )}

      {/* Header + actions */}
      {!showForm && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn-ghost"
              onClick={() => setShowBulk(true)}
              style={{ fontSize: 12 }}
            >
              📋 Bulk import (bank statement)
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                setEditing(null);
                setShowForm(true);
              }}
              style={{ fontSize: 12 }}
            >
              + Add expense
            </button>
          </div>
        </div>
      )}

      {/* Summary */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "12px 14px",
        }}
      >
        <div className="date-filter-row" style={{ marginBottom: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={allTime}
              onChange={(e) => setAllTime(e.target.checked)}
              style={{ width: "auto" }}
            />
            All time
          </label>
          {!allTime && (
            <>
              <label>From</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <label>To</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </>
          )}
          <GroupFilterDropdown
            groups={groups}
            value={groupFilter}
            onChange={setGroupFilter}
          />
          <input
            placeholder="Search description / vendor…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 160 }}
          />
        </div>

        <div className="metric-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div
            style={{
              background: "var(--bg-input)",
              borderRadius: 8,
              padding: "10px 12px",
            }}
          >
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
              Total ({expenses.length} entries)
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "var(--accent-amber)",
              }}
            >
              {loading ? "…" : fmtRs(total)}
            </div>
          </div>
          <div
            style={{
              background: "var(--bg-input)",
              borderRadius: 8,
              padding: "10px 12px",
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: "var(--text-muted)",
                marginBottom: 4,
              }}
            >
              Top categories
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {byGroup.slice(0, 3).map(([g, amt]) => (
                <div
                  key={g}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 11,
                  }}
                >
                  <span style={{ color: "var(--text-dim)" }}>{g}</span>
                  <span style={{ fontWeight: 500 }}>{fmtRs(amt)}</span>
                </div>
              ))}
              {byGroup.length === 0 && (
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  —
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Category</th>
              <th>Description</th>
              <th>Paid to</th>
              {type === "project" && <th>Project</th>}
              <th>Payment</th>
              <th style={{ textAlign: "right" }}>Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={8}
                  style={{
                    textAlign: "center",
                    padding: 20,
                    color: "var(--text-muted)",
                  }}
                >
                  Loading…
                </td>
              </tr>
            ) : expenses.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  style={{
                    textAlign: "center",
                    padding: 20,
                    color: "var(--text-muted)",
                  }}
                >
                  No expenses recorded for this period.
                </td>
              </tr>
            ) : (
              expenses.map((e) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDate(e.date)}</td>
                  <td>
                    <span
                      onClick={() => setInlinePickerId(e.id)}
                      style={{ cursor: "pointer" }}
                      title="Click to change category"
                    >
                      <div style={{ fontWeight: 500 }}>{e.category}</div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                        {e.category_group}
                      </div>
                    </span>
                  </td>
                  <td style={{ color: "var(--text-muted)", maxWidth: 220 }}>
                    {e.description || "—"}
                  </td>
                  <td style={{ color: "var(--text-muted)" }}>
                    {e.vendor || "—"}
                  </td>
                  {type === "project" && (
                    <td style={{ color: "var(--text-dim)" }}>
                      {e.project_name || "—"}
                    </td>
                  )}
                  <td style={{ color: "var(--text-muted)" }}>
                    {e.payment_method || "—"}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>
                    {fmtRs(e.amount)}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        className="btn-ghost"
                        style={{ fontSize: 10, padding: "3px 8px" }}
                        onClick={() => {
                          setEditing(e);
                          setShowForm(true);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="btn-ghost"
                        style={{
                          fontSize: 10,
                          padding: "3px 8px",
                          color: "var(--accent-red)",
                        }}
                        onClick={() => handleDelete(e.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
