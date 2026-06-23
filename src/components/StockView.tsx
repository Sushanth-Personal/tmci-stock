// src/components/StockView.tsx
"use client";
import { useState, useMemo, useEffect } from "react";

interface StockEntry {
  itemCode: string;
  model: string;
  description: string;
  location: string;
  category: string;
  openingStock: number;
  ordered: number;
  received: number;
  sold: number;
  currentStock: number;
  listPrice: number;
  costPrice: number;
  stockValue: number;
}

interface DisplayRow {
  itemCode: string;
  model: string;
  description: string;
  category: string;
  listPrice: number;
  costPrice: number;
  stockKochi: number;
  stockBlore: number;
  total: number;
  stockValue: number;
}

type SortCol = "model" | "total" | "stockKochi" | "stockBlore" | "stockValue";
type SortDir = "asc" | "desc";

function fmt(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export default function StockView({ products: _ }: { products: any[] }) {
  const [stock, setStock] = useState<StockEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [sortCol, setSortCol] = useState<SortCol>("model");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    fetch("/api/stock")
      .then((r) => r.json())
      .then((d) => {
        if (d.stock) setStock(d.stock);
      })
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(() => {
    const s = new Set(stock.map((r) => r.category).filter(Boolean));
    return Array.from(s).sort();
  }, [stock]);

  // Merge Kochi + Bangalore into one display row per model.
  // Cost price: use the highest non-zero cost across locations (FIFO from API).
  // Stock value: sum each location's (qty × its own costPrice) to avoid
  // applying one location's cost to the other's qty.
  const rows = useMemo((): DisplayRow[] => {
    const map = new Map<string, DisplayRow>();

    for (const s of stock) {
      const key = s.itemCode;
      if (!map.has(key)) {
        map.set(key, {
          itemCode: s.itemCode,
          model: s.model,
          description: s.description,
          category: s.category,
          listPrice: s.listPrice,
          costPrice: 0,
          stockKochi: 0,
          stockBlore: 0,
          total: 0,
          stockValue: 0,
        });
      }
      const row = map.get(key)!;

      if (s.location === "Kochi") row.stockKochi = s.currentStock;
      if (s.location === "Bangalore") row.stockBlore = s.currentStock;

      // Accumulate stock value per location using that location's own cost
      row.stockValue += s.currentStock * (s.costPrice ?? 0);

      // Keep the best known cost price (highest non-zero across locations)
      if ((s.costPrice ?? 0) > row.costPrice) row.costPrice = s.costPrice;
    }

    // Recalculate totals after all locations merged
    for (const row of map.values()) {
      row.total = row.stockKochi + row.stockBlore;
    }

    return Array.from(map.values());
  }, [stock]);

  const handleSort = (col: SortCol) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir(col === "model" ? "asc" : "desc");
    }
  };

  const filtered = useMemo(() => {
    let result = rows.filter((p) => {
      if (tab === "kochi" && p.stockKochi === 0) return false;
      if (tab === "blore" && p.stockBlore === 0) return false;
      if (tab === "out" && p.total !== 0) return false;
      if (category !== "all" && p.category !== category) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !p.model?.toLowerCase().includes(q) &&
          !p.itemCode.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });

    result = [...result].sort((a, b) => {
      const cmp =
        sortCol === "model"
          ? a.model.localeCompare(b.model)
          : a[sortCol] - b[sortCol];
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [rows, tab, search, category, sortCol, sortDir]);

  const grandTotalValue = useMemo(
    () => rows.reduce((s, p) => s + p.stockValue, 0),
    [rows],
  );
  const grandTotalUnits = useMemo(
    () => rows.reduce((s, p) => s + p.total, 0),
    [rows],
  );
  const filteredValue = filtered.reduce((s, p) => s + p.stockValue, 0);

  const status = (total: number) => {
    if (total === 0)
      return {
        label: "Out of stock",
        color: "var(--accent-red)",
        bg: "rgba(239,68,68,0.1)",
      };
    if (total <= 2)
      return {
        label: "Low",
        color: "var(--accent-amber)",
        bg: "rgba(245,158,11,0.1)",
      };
    return {
      label: "In stock",
      color: "var(--accent-green)",
      bg: "rgba(34,197,94,0.1)",
    };
  };

  const Tab = ({ id, label }: { id: string; label: string }) => (
    <div
      onClick={() => setTab(id)}
      style={{
        padding: "6px 12px",
        fontSize: 11,
        cursor: "pointer",
        color: tab === id ? "var(--text)" : "var(--text-muted)",
        borderBottom:
          tab === id ? "2px solid var(--accent)" : "2px solid transparent",
        fontWeight: tab === id ? 500 : 400,
        marginBottom: -1,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </div>
  );

  const SortTh = ({
    col,
    children,
    align = "left",
  }: {
    col: SortCol;
    children: React.ReactNode;
    align?: "left" | "right";
  }) => {
    const active = sortCol === col;
    return (
      <th
        onClick={() => handleSort(col)}
        style={{
          cursor: "pointer",
          userSelect: "none",
          textAlign: align,
          whiteSpace: "nowrap",
        }}
      >
        {children}
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
              fontSize: 7,
              lineHeight: 1,
              color:
                active && sortDir === "asc" ? "var(--accent)" : "currentColor",
            }}
          >
            ▲
          </span>
          <span
            style={{
              fontSize: 7,
              lineHeight: 1,
              color:
                active && sortDir === "desc" ? "var(--accent)" : "currentColor",
            }}
          >
            ▼
          </span>
        </span>
      </th>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <style>{`
        .stockview-search {
          font-size: 14px !important;
          padding: 11px 14px !important;
        }
        .stockview-filterbar {
          display: flex;
          gap: 8px;
          margin-bottom: 10px;
        }
        .stockview-table-scroll {
          overflow-x: auto;
          border: 1px solid var(--border);
          border-radius: 8px;
        }
        .stockview-table-scroll table { min-width: 760px; }
        .stockview-tabs-row {
          display: flex;
          gap: 0;
          border-bottom: 1px solid var(--border);
          margin-bottom: 10px;
          flex-wrap: wrap;
          align-items: center;
        }
        .sv-banner {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .sv-banner-card {
          flex: 1;
          min-width: 120px;
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 10px 14px;
        }
        @media (max-width: 720px) {
          .stockview-filterbar { flex-direction: column; }
          .stockview-filterbar select { width: 100% !important; }
          .sv-banner { flex-direction: column; }
        }
      `}</style>

      {/* ── Inventory summary banner ───────────────────────────────────── */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "12px 14px",
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: "var(--text-muted)",
            marginBottom: 10,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Inventory summary
        </div>
        <div className="sv-banner">
          <div className="sv-banner-card">
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
              Total stock value
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "var(--accent-green)",
                marginTop: 2,
              }}
            >
              {loading ? "—" : fmt(grandTotalValue)}
            </div>
            <div
              style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}
            >
              ex-GST · FIFO cost
            </div>
          </div>
          <div className="sv-banner-card">
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
              Total units in stock
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>
              {loading ? "—" : grandTotalUnits.toLocaleString("en-IN")}
            </div>
            <div
              style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}
            >
              across all locations
            </div>
          </div>
          <div className="sv-banner-card">
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
              Models tracked
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>
              {loading ? "—" : rows.length}
            </div>
            <div
              style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}
            >
              {rows.filter((r) => r.total === 0).length} out of stock
            </div>
          </div>
          {(tab !== "all" || search || category !== "all") && (
            <div
              className="sv-banner-card"
              style={{
                borderColor: "var(--accent)",
                background: "rgba(59,130,246,0.05)",
              }}
            >
              <div style={{ fontSize: 10, color: "var(--accent)" }}>
                Filtered view
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: "var(--accent)",
                  marginTop: 2,
                }}
              >
                {fmt(filteredValue)}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  marginTop: 2,
                }}
              >
                {filtered.length} items shown
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Stock table ────────────────────────────────────────────────── */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "12px 14px",
        }}
      >
        <div className="stockview-tabs-row">
          <Tab id="all" label="All" />
          <Tab id="kochi" label="Kochi" />
          <Tab id="blore" label="Bangalore" />
          <Tab id="out" label="Out of stock" />
          <div style={{ flex: 1 }} />
          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              display: "flex",
              alignItems: "center",
            }}
          >
            {loading
              ? "Loading…"
              : `${filtered.length} items · ${fmt(filteredValue)} ex-GST`}
          </div>
        </div>

        <div className="stockview-filterbar">
          <input
            className="stockview-search"
            placeholder="Search model or item code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1 }}
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{ width: 180 }}
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="stockview-table-scroll">
          <table>
            <thead>
              <tr>
                <SortTh col="model">Model</SortTh>
                <th>Category</th>
                <th>Item code</th>
                <SortTh col="stockKochi" align="right">
                  Kochi
                </SortTh>
                <SortTh col="stockBlore" align="right">
                  Blore
                </SortTh>
                <SortTh col="total" align="right">
                  Total
                </SortTh>
                <th style={{ textAlign: "right" }}>Cost price</th>
                <th style={{ textAlign: "right" }}>List price</th>
                <SortTh col="stockValue" align="right">
                  Stock value
                </SortTh>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={10}
                    style={{
                      textAlign: "center",
                      color: "var(--text-muted)",
                      padding: 20,
                    }}
                  >
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    style={{
                      textAlign: "center",
                      color: "var(--text-muted)",
                      padding: 20,
                    }}
                  >
                    No items found
                  </td>
                </tr>
              ) : (
                filtered.map((p) => {
                  const st = status(p.total);
                  return (
                    <tr key={p.itemCode}>
                      <td style={{ fontWeight: 500 }}>{p.model}</td>
                      <td style={{ color: "var(--text-muted)" }}>
                        {p.category || "—"}
                      </td>
                      <td style={{ color: "var(--text-muted)" }}>
                        {p.itemCode}
                      </td>
                      <td style={{ textAlign: "right" }}>{p.stockKochi}</td>
                      <td style={{ textAlign: "right" }}>{p.stockBlore}</td>
                      <td style={{ textAlign: "right", fontWeight: 500 }}>
                        {p.total}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          color:
                            p.costPrice > 0
                              ? "var(--text)"
                              : "var(--text-muted)",
                        }}
                      >
                        {p.costPrice > 0
                          ? `₹${Math.round(p.costPrice).toLocaleString("en-IN")}`
                          : "—"}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          color: "var(--text-muted)",
                        }}
                      >
                        ₹{p.listPrice.toLocaleString("en-IN")}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {p.costPrice > 0
                          ? `₹${Math.round(p.stockValue).toLocaleString("en-IN")}`
                          : "—"}
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: 10,
                            padding: "2px 8px",
                            borderRadius: 99,
                            background: st.bg,
                            color: st.color,
                          }}
                        >
                          {st.label}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
