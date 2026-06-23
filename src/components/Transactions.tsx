// src/components/Transactions.tsx
"use client";
import { useState, useMemo } from "react";

interface Props {
  sales: any[];
  purchases: any[];
}

function fmt(n: number) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${Math.round(n || 0).toLocaleString("en-IN")}`;
}

const MONTHS: Record<string, number> = {
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

const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);

function fromSheetsSerial(n: number): Date {
  return new Date(SHEETS_EPOCH_MS + n * 86400000);
}

function parseDate(raw: string | number | undefined | null): Date | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") {
    if (raw > 20000 && raw < 80000) return fromSheetsSerial(raw);
  } else {
    const s = String(raw).trim();
    if (/^\d{4,5}$/.test(s)) {
      const n = Number(s);
      if (n > 20000 && n < 80000) return fromSheetsSerial(n);
    }
    const ddmmm = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    if (ddmmm) {
      const day = Number(ddmmm[1]);
      const mon = MONTHS[ddmmm[2].toLowerCase()];
      const year = Number(ddmmm[3]);
      if (mon === undefined) return null;
      return new Date(year, mon, day);
    }
    const isoTry = new Date(s.split("T")[0]);
    if (!isNaN(isoTry.getTime())) return isoTry;
    const fallback = new Date(s);
    if (!isNaN(fallback.getTime())) return fallback;
  }
  return null;
}

function toISODateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function displayDate(raw: string | number | undefined | null): string {
  const d = parseDate(raw);
  if (!d) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function buildCostLookup(purchases: any[]) {
  const byModel = new Map<string, Array<{ date: Date; price: number }>>();
  for (const p of purchases) {
    const model = p.model;
    const price = p.unitPrice ?? p.unitPurchasePrice ?? 0;
    const d = parseDate(p.date);
    if (!model || !price || !d) continue;
    if (!byModel.has(model)) byModel.set(model, []);
    byModel.get(model)!.push({ date: d, price });
  }
  for (const entries of byModel.values()) {
    entries.sort((a, b) => a.date.getTime() - b.date.getTime());
  }
  return byModel;
}

function lookupCost(
  costLookup: Map<string, Array<{ date: Date; price: number }>>,
  model: string,
  saleDate: Date | null,
): number {
  const entries = costLookup.get(model);
  if (!entries || entries.length === 0) return 0;
  if (!saleDate) return entries[entries.length - 1].price;
  let best: number | null = null;
  for (const e of entries) {
    if (e.date.getTime() <= saleDate.getTime()) best = e.price;
    else break;
  }
  return best ?? entries[0].price;
}

// ─── Sort helpers ────────────────────────────────────────────────────────────
type SortDir = "asc" | "desc";

function SortIcon({ dir, active }: { dir: SortDir; active: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: 1,
        marginLeft: 4,
        opacity: active ? 1 : 0.3,
        verticalAlign: "middle",
        lineHeight: 1,
      }}
    >
      <span
        style={{
          fontSize: 8,
          lineHeight: 1,
          color: active && dir === "asc" ? "var(--accent)" : "currentColor",
        }}
      >
        ▲
      </span>
      <span
        style={{
          fontSize: 8,
          lineHeight: 1,
          color: active && dir === "desc" ? "var(--accent)" : "currentColor",
        }}
      >
        ▼
      </span>
    </span>
  );
}

export default function Transactions({ sales, purchases }: Props) {
  const [tab, setTab] = useState<"sales" | "purchases">("sales");

  // ── filter state ──────────────────────────────────────────────────────────
  const [itemSearch, setItemSearch] = useState("");
  const [partySearch, setPartySearch] = useState("");

  const today = new Date().toISOString().split("T")[0];
  const monthStart = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
  )
    .toISOString()
    .split("T")[0];
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [allTime, setAllTime] = useState(true);

  // ── sort state ────────────────────────────────────────────────────────────
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = () => setSortDir((d) => (d === "desc" ? "asc" : "desc"));

  // ── helpers ───────────────────────────────────────────────────────────────
  const inRange = (rawDate: string | number | undefined | null) => {
    if (allTime) return true;
    const d = parseDate(rawDate);
    if (!d) return false;
    const iso = toISODateString(d);
    if (from && iso < from) return false;
    if (to && iso > to) return false;
    return true;
  };

  const hasContent = (row: any) => !!(row.model || row.itemCode);

  const sortByDate = (rows: any[]) => {
    return [...rows].sort((a, b) => {
      const da = parseDate(a.date)?.getTime() ?? 0;
      const db = parseDate(b.date)?.getTime() ?? 0;
      return sortDir === "desc" ? db - da : da - db;
    });
  };

  // ── derived lists ─────────────────────────────────────────────────────────
  const filteredSales = useMemo(() => {
    let rows = sales.filter((s) => hasContent(s) && inRange(s.date));
    if (itemSearch) {
      const q = itemSearch.toLowerCase();
      rows = rows.filter(
        (s) =>
          s.model?.toLowerCase().includes(q) ||
          String(s.itemCode ?? "")
            .toLowerCase()
            .includes(q),
      );
    }
    if (partySearch) {
      const q = partySearch.toLowerCase();
      rows = rows.filter(
        (s) =>
          s.party?.toLowerCase().includes(q) ||
          s.customer?.toLowerCase().includes(q),
      );
    }
    return sortByDate(rows);
  }, [sales, itemSearch, partySearch, from, to, allTime, sortDir]);

  const filteredPurchases = useMemo(() => {
    let rows = purchases.filter((p) => hasContent(p) && inRange(p.date));
    if (itemSearch) {
      const q = itemSearch.toLowerCase();
      rows = rows.filter(
        (p) =>
          p.model?.toLowerCase().includes(q) ||
          String(p.itemCode ?? "")
            .toLowerCase()
            .includes(q),
      );
    }
    if (partySearch) {
      const q = partySearch.toLowerCase();
      rows = rows.filter(
        (p) =>
          p.party?.toLowerCase().includes(q) ||
          p.vendor?.toLowerCase().includes(q) ||
          p.supplier?.toLowerCase().includes(q),
      );
    }
    return sortByDate(rows);
  }, [purchases, itemSearch, partySearch, from, to, allTime, sortDir]);

  const salesTotal = filteredSales.reduce(
    (s, x) => s + (x.total || x.totalSaleValue || 0),
    0,
  );
  const purchasesTotal = filteredPurchases.reduce(
    (s, x) => s + (x.total || x.totalPurchaseValue || 0),
    0,
  );

  const costLookup = useMemo(() => buildCostLookup(purchases), [purchases]);

  const hasActiveFilters = itemSearch || partySearch || !allTime;
  const clearFilters = () => {
    setItemSearch("");
    setPartySearch("");
    setAllTime(true);
  };

  // ── sub-components ────────────────────────────────────────────────────────
  const Tab = ({
    id,
    label,
    count,
  }: {
    id: "sales" | "purchases";
    label: string;
    count: number;
  }) => (
    <div
      onClick={() => setTab(id)}
      style={{
        padding: "8px 14px",
        fontSize: 12,
        cursor: "pointer",
        color: tab === id ? "var(--text)" : "var(--text-muted)",
        borderBottom:
          tab === id ? "2px solid var(--accent)" : "2px solid transparent",
        fontWeight: tab === id ? 500 : 400,
        marginBottom: -1,
        whiteSpace: "nowrap",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      {label}
      <span
        style={{
          fontSize: 10,
          padding: "1px 6px",
          borderRadius: 99,
          background: tab === id ? "rgba(59,130,246,0.15)" : "var(--bg-input)",
          color: tab === id ? "var(--accent)" : "var(--text-muted)",
        }}
      >
        {count}
      </span>
    </div>
  );

  // Clickable "Date" column header
  const DateHeader = () => (
    <th
      onClick={toggleSort}
      style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
      title={`Sort ${sortDir === "desc" ? "oldest first" : "newest first"}`}
    >
      Date
      <SortIcon dir={sortDir} active />
    </th>
  );

  return (
    <div
      className="txn-wrap"
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <style>{`
        .txn-wrap input[type="text"],
        .txn-wrap input[type="search"] {
          font-size: 13px;
          padding: 9px 12px;
        }
        .txn-filter-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .txn-filter-row input[type="date"] { width: 140px; }
        .txn-filter-input {
          flex: 1;
          min-width: 160px;
        }
        .txn-table-scroll {
          overflow-x: auto;
          border: 1px solid var(--border);
          border-radius: 8px;
        }
        .txn-table-scroll table { min-width: 640px; }
        .txn-table-scroll th { white-space: nowrap; }
        .txn-summary {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .txn-alltime-toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: var(--text-dim);
          white-space: nowrap;
        }
        .txn-alltime-toggle input { width: auto; }
        .txn-clear-btn {
          font-size: 11px;
          padding: 4px 10px;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--bg-input);
          color: var(--text-muted);
          cursor: pointer;
          white-space: nowrap;
        }
        .txn-clear-btn:hover { color: var(--text); border-color: var(--text-muted); }
        @media (max-width: 720px) {
          .txn-filter-row { flex-direction: column; align-items: stretch; }
          .txn-filter-row input[type="date"] { width: 100%; }
          .txn-filter-input { min-width: 0; width: 100%; }
          .txn-summary { flex-direction: column; }
        }
      `}</style>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "1px solid var(--border)",
          overflowX: "auto",
        }}
      >
        <Tab id="sales" label="Sales" count={filteredSales.length} />
        <Tab
          id="purchases"
          label="Purchases"
          count={filteredPurchases.length}
        />
      </div>

      {/* Filter panel */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {/* Row 1: item + party filters */}
        <div className="txn-filter-row">
          <input
            className="txn-filter-input"
            type="text"
            placeholder="Filter by item / model…"
            value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)}
          />
          <input
            className="txn-filter-input"
            type="text"
            placeholder={
              tab === "sales" ? "Filter by customer…" : "Filter by vendor…"
            }
            value={partySearch}
            onChange={(e) => setPartySearch(e.target.value)}
          />
        </div>

        {/* Row 2: date range + clear */}
        <div className="txn-filter-row">
          <label className="txn-alltime-toggle">
            <input
              type="checkbox"
              checked={allTime}
              onChange={(e) => setAllTime(e.target.checked)}
            />
            All time
          </label>
          {!allTime && (
            <>
              <label
                style={{ marginBottom: 0, whiteSpace: "nowrap", fontSize: 12 }}
              >
                From
              </label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <label
                style={{ marginBottom: 0, whiteSpace: "nowrap", fontSize: 12 }}
              >
                To
              </label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </>
          )}
          {hasActiveFilters && (
            <button className="txn-clear-btn" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>

        {/* Summary chips */}
        <div className="txn-summary">
          <div
            style={{
              background: "var(--bg-input)",
              borderRadius: 8,
              padding: "8px 12px",
              flex: 1,
            }}
          >
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
              {tab === "sales" ? "Total sales value" : "Total purchase value"}
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                color:
                  tab === "sales" ? "var(--accent-green)" : "var(--accent)",
              }}
            >
              {fmt(tab === "sales" ? salesTotal : purchasesTotal)}
            </div>
          </div>
          <div
            style={{
              background: "var(--bg-input)",
              borderRadius: 8,
              padding: "8px 12px",
              flex: 1,
            }}
          >
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
              Entries shown
            </div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              {tab === "sales"
                ? filteredSales.length
                : filteredPurchases.length}
            </div>
          </div>
        </div>
      </div>

      {/* ── Sales table ─────────────────────────────────────────────────────── */}
      {tab === "sales" ? (
        <div className="txn-table-scroll">
          <table>
            <thead>
              <tr>
                <DateHeader />
                <th>Txn ID</th>
                <th>Model</th>
                <th>Location</th>
                <th>Qty</th>
                <th>Sale price</th>
                <th>Total</th>
                <th>Cost price</th>
                <th>Margin</th>
                <th>Customer</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredSales.length === 0 ? (
                <tr>
                  <td
                    colSpan={11}
                    style={{
                      textAlign: "center",
                      color: "var(--text-muted)",
                      padding: 24,
                    }}
                  >
                    No sales match these filters.
                  </td>
                </tr>
              ) : (
                filteredSales.map((s, i) => {
                  const unitPrice = s.unitPrice ?? s.unitSalePrice ?? 0;
                  const fifoCost = s.costPrice ?? s.suggestedCostPrice ?? 0;
                  const total = s.total ?? s.totalSaleValue ?? 0;
                  const isEstimated = !fifoCost;
                  const cost =
                    fifoCost ||
                    lookupCost(costLookup, s.model, parseDate(s.date));
                  const margin =
                    unitPrice > 0 && cost > 0
                      ? ((unitPrice - cost) / unitPrice) * 100
                      : null;
                  return (
                    <tr key={s.txnId ?? i}>
                      <td style={{ color: "var(--text-muted)" }}>
                        {displayDate(s.date)}
                      </td>
                      <td style={{ color: "var(--text-muted)" }}>
                        {s.txnId ?? "—"}
                      </td>
                      <td style={{ fontWeight: 500 }}>{s.model || "—"}</td>
                      <td>{s.location || "—"}</td>
                      <td>{s.qty ?? s.qtySold ?? "—"}</td>
                      <td>
                        {unitPrice
                          ? `₹${unitPrice.toLocaleString("en-IN")}`
                          : "—"}
                      </td>
                      <td style={{ fontWeight: 500 }}>
                        {total ? `₹${total.toLocaleString("en-IN")}` : "—"}
                      </td>
                      <td>
                        {cost ? `₹${cost.toLocaleString("en-IN")}` : "—"}
                        {cost > 0 && isEstimated && (
                          <span
                            style={{
                              color: "var(--text-muted)",
                              fontSize: 10,
                              marginLeft: 4,
                            }}
                            title="Estimated from last purchase price — no FIFO lot recorded for this sale"
                          >
                            est.
                          </span>
                        )}
                      </td>
                      <td
                        style={{
                          color:
                            margin === null
                              ? "var(--text-muted)"
                              : margin > 0
                                ? "var(--accent-green)"
                                : "var(--accent-red)",
                        }}
                      >
                        {margin === null ? "—" : `${margin.toFixed(1)}%`}
                      </td>
                      <td style={{ color: "var(--text-muted)" }}>
                        {s.party ?? s.customer ?? "—"}
                      </td>
                      <td style={{ color: "var(--text-muted)" }}>
                        {s.status ?? "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* ── Purchases table ──────────────────────────────────────────────── */
        <div className="txn-table-scroll">
          <table>
            <thead>
              <tr>
                <DateHeader />
                <th>Txn ID</th>
                <th>Model</th>
                <th>Location</th>
                <th>Qty</th>
                <th>Unit price</th>
                <th>Total</th>
                <th>Vendor</th>
                <th>PO / Invoice</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredPurchases.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    style={{
                      textAlign: "center",
                      color: "var(--text-muted)",
                      padding: 24,
                    }}
                  >
                    No purchases match these filters.
                  </td>
                </tr>
              ) : (
                filteredPurchases.map((p, i) => {
                  const unitPrice = p.unitPrice ?? p.unitPurchasePrice ?? 0;
                  const total = p.total ?? p.totalPurchaseValue ?? 0;
                  return (
                    <tr key={p.txnId ?? i}>
                      <td style={{ color: "var(--text-muted)" }}>
                        {displayDate(p.date)}
                      </td>
                      <td style={{ color: "var(--text-muted)" }}>
                        {p.txnId ?? "—"}
                      </td>
                      <td style={{ fontWeight: 500 }}>{p.model || "—"}</td>
                      <td>{p.location || "—"}</td>
                      <td>{p.qty ?? p.qtyPurchased ?? "—"}</td>
                      <td>
                        {unitPrice
                          ? `₹${unitPrice.toLocaleString("en-IN")}`
                          : "—"}
                      </td>
                      <td style={{ fontWeight: 500 }}>
                        {total ? `₹${total.toLocaleString("en-IN")}` : "—"}
                      </td>
                      <td style={{ color: "var(--text-muted)" }}>
                        {p.party ?? p.vendor ?? p.supplier ?? "—"}
                      </td>
                      <td style={{ color: "var(--text-muted)" }}>
                        {p.poOrInvoice ?? "—"}
                      </td>
                      <td style={{ color: "var(--text-muted)" }}>
                        {p.status ?? "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
