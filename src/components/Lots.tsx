// src/components/Lots.tsx
"use client";
import { useEffect, useState, useMemo } from "react";

interface LotEntry {
  lotId: string;
  date: string;
  itemCode: string;
  model: string;
  location: string;
  qtyPurchased: number;
  remainingQty: number;
  unitPurchasePrice: number;
  vendor: string;
  poOrInvoice: string;
}

function fmt(n: number) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export default function Lots() {
  const [lots, setLots] = useState<LotEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [openOnly, setOpenOnly] = useState(true);

  useEffect(() => {
    fetch("/api/lots")
      .then((r) => r.json())
      .then((d) => {
        if (d.lots) setLots(d.lots);
      })
      .finally(() => setLoading(false));
  }, []);

  // Group open lots by Item Code + Location to compute stock value per model.
  // Stock value for a model = Σ(remaining qty × unit purchase price)
  // across all of its open lots — this is the FIFO-accurate valuation.
  const grouped = useMemo(() => {
    const open = lots.filter((l) => l.remainingQty > 0);
    const map: Record<
      string,
      {
        itemCode: string;
        model: string;
        location: string;
        totalRemaining: number;
        totalValue: number;
        lots: LotEntry[];
      }
    > = {};
    for (const l of open) {
      const key = `${l.itemCode}__${l.location}`;
      if (!map[key]) {
        map[key] = {
          itemCode: l.itemCode,
          model: l.model,
          location: l.location,
          totalRemaining: 0,
          totalValue: 0,
          lots: [],
        };
      }
      map[key].totalRemaining += l.remainingQty;
      map[key].totalValue += l.remainingQty * l.unitPurchasePrice;
      map[key].lots.push(l);
    }
    let rows = Object.values(map);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) => r.model.toLowerCase().includes(q) || r.itemCode.includes(q),
      );
    }
    return rows.sort((a, b) => b.totalValue - a.totalValue);
  }, [lots, search]);

  const grandTotalValue = grouped.reduce((s, r) => s + r.totalValue, 0);
  const grandTotalUnits = grouped.reduce((s, r) => s + r.totalRemaining, 0);

  const displayLots = useMemo(() => {
    let rows = openOnly ? lots.filter((l) => l.remainingQty > 0) : lots;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (l) => l.model.toLowerCase().includes(q) || l.itemCode.includes(q),
      );
    }
    return [...rows].reverse();
  }, [lots, openOnly, search]);

  const SectionLabel = ({ children }: any) => (
    <div
      style={{
        fontSize: 10,
        fontWeight: 500,
        color: "var(--text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header / search */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <input
          placeholder="Search by model or item code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 260 }}
        />
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 0,
            fontSize: 11,
          }}
        >
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(e) => setOpenOnly(e.target.checked)}
            style={{ width: "auto" }}
          />
          Show open lots only
        </label>
      </div>

      {/* Stock value summary — this is the one place cost/value is shown */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "12px 14px",
        }}
      >
        <SectionLabel>Current stock value (FIFO, from open lots)</SectionLabel>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2,1fr)",
            gap: 8,
          }}
        >
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
                marginBottom: 3,
              }}
            >
              Total units in open lots
            </div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>
              {grandTotalUnits}
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
                marginBottom: 3,
              }}
            >
              Total stock value
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 600,
                color: "var(--accent-green)",
              }}
            >
              {fmt(grandTotalValue)}
            </div>
          </div>
        </div>
      </div>

      {/* Per-model value breakdown */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "12px 14px",
        }}
      >
        <SectionLabel>Stock value by model ({grouped.length})</SectionLabel>
        {loading ? (
          <div
            style={{ color: "var(--text-muted)", fontSize: 12, padding: 12 }}
          >
            Loading…
          </div>
        ) : (
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Item code</th>
                  <th>Location</th>
                  <th>Open lots</th>
                  <th>Remaining qty</th>
                  <th>Stock value</th>
                </tr>
              </thead>
              <tbody>
                {grouped.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      style={{
                        textAlign: "center",
                        color: "var(--text-muted)",
                        padding: 20,
                      }}
                    >
                      No open lots found
                    </td>
                  </tr>
                ) : (
                  grouped.map((r) => (
                    <tr key={`${r.itemCode}__${r.location}`}>
                      <td style={{ fontWeight: 500 }}>{r.model}</td>
                      <td style={{ color: "var(--text-muted)" }}>
                        {r.itemCode}
                      </td>
                      <td>{r.location}</td>
                      <td>{r.lots.length}</td>
                      <td>{r.totalRemaining}</td>
                      <td
                        style={{
                          color: "var(--accent-green)",
                          fontWeight: 500,
                        }}
                      >
                        {fmt(r.totalValue)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Raw lot ledger */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "12px 14px",
        }}
      >
        <SectionLabel>Lot ledger ({displayLots.length} entries)</SectionLabel>
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          <table>
            <thead>
              <tr>
                <th>Lot ID</th>
                <th>Date</th>
                <th>Model</th>
                <th>Location</th>
                <th>Qty purchased</th>
                <th>Remaining</th>
                <th>Unit price</th>
                <th>Vendor</th>
              </tr>
            </thead>
            <tbody>
              {displayLots.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    style={{
                      textAlign: "center",
                      color: "var(--text-muted)",
                      padding: 20,
                    }}
                  >
                    No lots found
                  </td>
                </tr>
              ) : (
                displayLots.map((l) => (
                  <tr key={l.lotId}>
                    <td style={{ color: "var(--text-muted)" }}>{l.lotId}</td>
                    <td style={{ color: "var(--text-muted)" }}>
                      {(l.date + "").split("T")[0]}
                    </td>
                    <td style={{ fontWeight: 500 }}>{l.model}</td>
                    <td>{l.location}</td>
                    <td>{l.qtyPurchased}</td>
                    <td
                      style={{
                        color:
                          l.remainingQty > 0
                            ? "var(--accent-green)"
                            : "var(--text-muted)",
                      }}
                    >
                      {l.remainingQty}
                    </td>
                    <td>
                      ₹{(l.unitPurchasePrice || 0).toLocaleString("en-IN")}
                    </td>
                    <td style={{ color: "var(--text-muted)", fontSize: 11 }}>
                      {l.vendor}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
