"use client";
// src/components/Ledger.tsx
// Stock Ledger — source of truth for what came in and what went out.
// Two tabs: Purchased (IN) and Sold (OUT)
// Each row = one model, one movement. Click a row to expand and see its
// recorded serial numbers (if any were captured for that transaction).

import React, { useState, useMemo } from "react";

interface Props {
  sales: any[];
  purchases: any[];
}

const fmtDate = (raw: any) => {
  if (!raw) return "—";
  const d = new Date(String(raw).split("T")[0]);
  return isNaN(d.getTime())
    ? String(raw)
    : d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
};

const fmtRs = (n: any) => {
  if (!n || n === 0) return "—";
  return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
};

export default function Ledger({ sales, purchases }: Props) {
  const [tab, setTab] = useState<"sold" | "purchased">("sold");
  const [search, setSearch] = useState("");
  const [party, setParty] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [allTime, setAllTime] = useState(true);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  // Accordion — only one row's serials expanded at a time. Keyed by txnId.
  const [expandedTxn, setExpandedTxn] = useState<string | null>(null);

  const filter = (rows: any[]) => {
    let r = rows.filter((x) => x.model || x.itemCode);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(
        (x) =>
          String(x.model ?? "")
            .toLowerCase()
            .includes(q) ||
          String(x.itemCode ?? "")
            .toLowerCase()
            .includes(q),
      );
    }
    if (party.trim()) {
      const q = party.toLowerCase();
      r = r.filter((x) =>
        String(x.party ?? x.customer ?? x.vendor ?? "")
          .toLowerCase()
          .includes(q),
      );
    }
    if (!allTime && (from || to)) {
      r = r.filter((x) => {
        const d = String(x.date ?? "").split("T")[0];
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    }
    return [...r].sort((a, b) => {
      const da = new Date(String(a.date ?? "").split("T")[0]).getTime() || 0;
      const db = new Date(String(b.date ?? "").split("T")[0]).getTime() || 0;
      return sortDir === "desc" ? db - da : da - db;
    });
  };

  const soldRows = useMemo(
    () => filter(sales),
    [sales, search, party, from, to, allTime, sortDir],
  );
  const purchasedRows = useMemo(
    () => filter(purchases),
    [purchases, search, party, from, to, allTime, sortDir],
  );

  const rows = tab === "sold" ? soldRows : purchasedRows;
  const totalVal = rows.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const totalQty = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);

  const clearFilters = () => {
    setSearch("");
    setParty("");
    setAllTime(true);
  };
  const hasFilters = search || party || !allTime;

  const toggleExpand = (txnId: string) => {
    setExpandedTxn((prev) => (prev === txnId ? null : txnId));
  };

  // Renders the serial chips (or an explanatory note) for the expanded row.
  const SerialDetail = ({ row }: { row: any }) => {
    const serials: string[] = Array.isArray(row.serialNumbers)
      ? row.serialNumbers.filter(Boolean)
      : [];
    return (
      <div
        style={{
          padding: "10px 14px",
          background: "rgba(255,255,255,0.02)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {serials.length === 0 ? (
          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              fontStyle: "italic",
            }}
          >
            No serial numbers recorded for this transaction.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                fontSize: 10,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Serial number{serials.length !== 1 ? "s" : ""} ({serials.length})
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {serials.map((sn, i) => (
                <span
                  key={i}
                  style={{
                    fontSize: 11,
                    fontFamily: "monospace",
                    background: "var(--bg-input)",
                    border: "1px solid var(--border)",
                    padding: "3px 9px",
                    borderRadius: 5,
                    color: "var(--text-dim)",
                  }}
                >
                  {sn}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <style>{`
        .ledger-tab {
          padding: 8px 16px; font-size: 12px; cursor: pointer;
          border-bottom: 2px solid transparent; color: var(--text-muted);
          transition: all 0.1s; white-space: nowrap; margin-bottom: -1px;
        }
        .ledger-tab.on { color: var(--text); font-weight: 500; }
        .ledger-tab.sold.on   { border-bottom-color: var(--accent-green); }
        .ledger-tab.purchased.on { border-bottom-color: var(--accent); }
        .ledger-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }
        .ledger-scroll table { min-width: 760px; }
        .ledger-row { cursor: pointer; transition: background 0.1s; }
        .ledger-row:hover td { background: rgba(255,255,255,0.02); }
        @media (max-width: 720px) {
          .ledger-filter-row { flex-direction: column !important; }
          .ledger-filter-row input, .ledger-filter-row select { width: 100% !important; }
        }
      `}</style>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
        <div
          className={`ledger-tab sold${tab === "sold" ? " on" : ""}`}
          onClick={() => {
            setTab("sold");
            setExpandedTxn(null);
          }}
        >
          ↑ Sold
          <span
            style={{
              marginLeft: 6,
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 99,
              background:
                tab === "sold" ? "rgba(34,197,94,0.12)" : "var(--bg-input)",
              color:
                tab === "sold" ? "var(--accent-green)" : "var(--text-muted)",
            }}
          >
            {soldRows.length}
          </span>
        </div>
        <div
          className={`ledger-tab purchased${tab === "purchased" ? " on" : ""}`}
          onClick={() => {
            setTab("purchased");
            setExpandedTxn(null);
          }}
        >
          ↓ Purchased
          <span
            style={{
              marginLeft: 6,
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 99,
              background:
                tab === "purchased"
                  ? "rgba(59,130,246,0.12)"
                  : "var(--bg-input)",
              color:
                tab === "purchased" ? "var(--accent)" : "var(--text-muted)",
            }}
          >
            {purchasedRows.length}
          </span>
        </div>
      </div>

      {/* Filters */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "12px 14px",
        }}
      >
        <div
          className="ledger-filter-row"
          style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}
        >
          <input
            placeholder="Search model…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 160 }}
          />
          <input
            placeholder={
              tab === "sold" ? "Filter by customer…" : "Filter by vendor…"
            }
            value={party}
            onChange={(e) => setParty(e.target.value)}
            style={{ flex: 1, minWidth: 160 }}
          />
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "var(--text-dim)",
              marginBottom: 0,
              whiteSpace: "nowrap",
            }}
          >
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
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                style={{ width: 140 }}
              />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                to
              </span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                style={{ width: 140 }}
              />
            </>
          )}
          <button
            onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
            style={{
              fontSize: 11,
              padding: "5px 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Date {sortDir === "desc" ? "↓ newest" : "↑ oldest"}
          </button>
          {hasFilters && (
            <button
              onClick={clearFilters}
              style={{
                fontSize: 11,
                padding: "5px 10px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Summary */}
        <div
          style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}
        >
          <div
            style={{
              background: "var(--bg-input)",
              borderRadius: 8,
              padding: "8px 14px",
              flex: 1,
            }}
          >
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
              {tab === "sold" ? "Total sold value" : "Total purchased value"}
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: tab === "sold" ? "var(--accent-green)" : "var(--accent)",
              }}
            >
              ₹{totalVal.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div
            style={{
              background: "var(--bg-input)",
              borderRadius: 8,
              padding: "8px 14px",
              flex: 1,
            }}
          >
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
              Units
            </div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{totalQty}</div>
          </div>
          <div
            style={{
              background: "var(--bg-input)",
              borderRadius: 8,
              padding: "8px 14px",
              flex: 1,
            }}
          >
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
              Entries
            </div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{rows.length}</div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="ledger-scroll">
        {tab === "sold" ? (
          <table>
            <thead>
              <tr>
                <th style={{ width: 20 }}></th>
                <th>Date</th>
                <th>Model</th>
                <th>Location</th>
                <th style={{ textAlign: "right" }}>Qty</th>
                <th style={{ textAlign: "right" }}>Sale price</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th style={{ textAlign: "right" }}>Cost</th>
                <th style={{ textAlign: "right" }}>Margin</th>
                <th>Customer</th>
                <th>Invoice</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={11}
                    style={{
                      textAlign: "center",
                      color: "var(--text-muted)",
                      padding: 24,
                    }}
                  >
                    No entries found.
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => {
                  const key = r.txnId ?? String(i);
                  const isOpen = expandedTxn === key;
                  const sp = Number(r.unitPrice ?? r.unitSalePrice ?? 0);
                  const cost = Number(r.costPrice ?? 0);
                  const tot = Number(r.total ?? 0);
                  const margin =
                    sp > 0 && cost > 0 ? ((sp - cost) / sp) * 100 : null;
                  const hasSerials =
                    Array.isArray(r.serialNumbers) &&
                    r.serialNumbers.filter(Boolean).length > 0;
                  return (
                    <React.Fragment key={key}>
                      <tr
                        className="ledger-row"
                        onClick={() => toggleExpand(key)}
                      >
                        <td style={{ color: "var(--text-muted)" }}>
                          {isOpen ? "▾" : "▸"}
                        </td>
                        <td
                          style={{
                            color: "var(--text-muted)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {fmtDate(r.date)}
                        </td>
                        <td style={{ fontWeight: 500 }}>
                          {r.model || "—"}
                          {hasSerials && (
                            <span
                              style={{
                                marginLeft: 6,
                                fontSize: 9,
                                color: "var(--text-muted)",
                              }}
                            >
                              🔢
                            </span>
                          )}
                        </td>
                        <td style={{ color: "var(--text-muted)" }}>
                          {r.location || "—"}
                        </td>
                        <td style={{ textAlign: "right" }}>{r.qty ?? "—"}</td>
                        <td style={{ textAlign: "right" }}>{fmtRs(sp)}</td>
                        <td style={{ textAlign: "right", fontWeight: 500 }}>
                          {fmtRs(tot)}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            color: "var(--text-muted)",
                          }}
                        >
                          {fmtRs(cost)}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            fontWeight: 500,
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
                        <td
                          style={{
                            color: "var(--text-muted)",
                            maxWidth: 200,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {r.party ?? r.customer ?? "—"}
                        </td>
                        <td
                          style={{
                            color: "var(--accent)",
                            fontSize: 11,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {r.poOrInvoice ?? "—"}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={11} style={{ padding: 0 }}>
                            <SerialDetail row={r} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 20 }}></th>
                <th>Date</th>
                <th>Model</th>
                <th>Location</th>
                <th style={{ textAlign: "right" }}>Qty</th>
                <th style={{ textAlign: "right" }}>Unit cost</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th>Vendor</th>
                <th>Invoice / PO</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    style={{
                      textAlign: "center",
                      color: "var(--text-muted)",
                      padding: 24,
                    }}
                  >
                    No entries found.
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => {
                  const key = r.txnId ?? String(i);
                  const isOpen = expandedTxn === key;
                  const up = Number(r.unitPrice ?? r.unitPurchasePrice ?? 0);
                  const tot = Number(r.total ?? 0);
                  const hasSerials =
                    Array.isArray(r.serialNumbers) &&
                    r.serialNumbers.filter(Boolean).length > 0;
                  return (
                    <React.Fragment key={key}>
                      <tr
                        className="ledger-row"
                        onClick={() => toggleExpand(key)}
                      >
                        <td style={{ color: "var(--text-muted)" }}>
                          {isOpen ? "▾" : "▸"}
                        </td>
                        <td
                          style={{
                            color: "var(--text-muted)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {fmtDate(r.date)}
                        </td>
                        <td style={{ fontWeight: 500 }}>
                          {r.model || "—"}
                          {hasSerials && (
                            <span
                              style={{
                                marginLeft: 6,
                                fontSize: 9,
                                color: "var(--text-muted)",
                              }}
                            >
                              🔢
                            </span>
                          )}
                        </td>
                        <td style={{ color: "var(--text-muted)" }}>
                          {r.location || "—"}
                        </td>
                        <td style={{ textAlign: "right" }}>{r.qty ?? "—"}</td>
                        <td style={{ textAlign: "right" }}>{fmtRs(up)}</td>
                        <td style={{ textAlign: "right", fontWeight: 500 }}>
                          {fmtRs(tot)}
                        </td>
                        <td
                          style={{
                            color: "var(--text-muted)",
                            maxWidth: 200,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {r.party ?? r.vendor ?? r.supplier ?? "—"}
                        </td>
                        <td
                          style={{
                            color: "var(--accent)",
                            fontSize: 11,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {r.poOrInvoice ?? "—"}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={9} style={{ padding: 0 }}>
                            <SerialDetail row={r} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
