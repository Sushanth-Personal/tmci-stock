"use client";
// src/components/StockSerials.tsx
// Stock view with serial number detail per lot, plus a serial number lookup
// tool (search any serial → find where it currently sits or who bought it).

import React, { useState, useEffect, useCallback } from "react";

interface Lot {
  lotId: string;
  location: string;
  date: string;
  qtyPurchased: number;
  remainingQty: number;
  serialNumbers: string[];
  vendor: string;
}

interface StockRow {
  model: string;
  itemCode: string;
  make: string;
  category: string;
  kochiQty: number;
  bangaloreQty: number;
  totalQty: number;
  lots: Lot[];
  hasSerialData: boolean;
}

interface LotMatch {
  serial: string;
  model: string;
  location: string;
  lotId: string;
  purchaseDate: string;
  vendor: string;
  poInvoice: string;
  status: string;
  lotRemainingQty: number;
}
interface SaleMatch {
  serial: string;
  model: string;
  location: string;
  soldTo: string;
  invoiceNumber: string;
  saleDate: string;
  status: string;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

export default function StockSerials() {
  const [tab, setTab] = useState<"stock" | "lookup">("stock");
  const [stock, setStock] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Accordion behaviour: only one model expanded at a time.
  // (Previously this was a Set, which let multiple rows stay open —
  // clicking a new row now closes whichever one was open before.)
  const [expandedModel, setExpandedModel] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Serial lookup state
  const [serialQuery, setSerialQuery] = useState("");
  const [lotMatches, setLotMatches] = useState<LotMatch[]>([]);
  const [saleMatches, setSaleMatches] = useState<SaleMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const loadStock = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/stock/serials");
      const d = await r.json();
      setStock(d.stock ?? []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    loadStock();
  }, [loadStock]);

  const toggleExpand = (model: string) => {
    setExpandedModel((prev) => (prev === model ? null : model));
  };

  const doSerialSearch = async () => {
    if (!serialQuery.trim()) return;
    setSearching(true);
    setSearched(true);
    try {
      const r = await fetch(
        `/api/stock/serials?q=${encodeURIComponent(serialQuery.trim())}`,
      );
      const d = await r.json();
      setLotMatches(d.lotMatches ?? []);
      setSaleMatches(d.saleMatches ?? []);
    } catch {}
    setSearching(false);
  };

  const filteredStock = stock.filter(
    (s) =>
      !search.trim() ||
      s.model.toLowerCase().includes(search.toLowerCase()) ||
      s.category.toLowerCase().includes(search.toLowerCase()),
  );

  const totalUnits = stock.reduce((s, r) => s + r.totalQty, 0);
  const modelsWithSerials = stock.filter((s) => s.hasSerialData).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <style>{`
        .ss-tab { font-size: 12px; padding: 8px 14px; cursor: pointer; border-bottom: 2px solid transparent; color: var(--text-muted); transition: all 0.1s; }
        .ss-tab.on { color: var(--text); border-bottom-color: var(--accent); font-weight: 500; }
        .ss-row { cursor: pointer; transition: background 0.1s; }
        .ss-row:hover { background: rgba(255,255,255,0.03); }
        .ss-serial-chip { font-size: 10px; font-family: monospace; background: var(--bg-input); padding: 2px 7px; border-radius: 4px; color: var(--text-dim); border: 1px solid var(--border); }
      `}</style>

      {/* Summary cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 10,
        }}
      >
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
              marginBottom: 4,
            }}
          >
            Total units in stock
          </div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{totalUnits}</div>
        </div>
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
              marginBottom: 4,
            }}
          >
            Models tracked
          </div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{stock.length}</div>
        </div>
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
              marginBottom: 4,
            }}
          >
            Models with serial data
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "var(--accent-green)",
            }}
          >
            {modelsWithSerials}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
        <div
          className={`ss-tab${tab === "stock" ? " on" : ""}`}
          onClick={() => setTab("stock")}
        >
          Stock by model
        </div>
        <div
          className={`ss-tab${tab === "lookup" ? " on" : ""}`}
          onClick={() => setTab("lookup")}
        >
          🔍 Serial number lookup
        </div>
      </div>

      {tab === "stock" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            placeholder="Search model or category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {loading ? (
            <div
              style={{
                padding: 24,
                textAlign: "center",
                color: "var(--text-muted)",
                fontSize: 12,
              }}
            >
              Loading…
            </div>
          ) : filteredStock.length === 0 ? (
            <div
              style={{
                padding: 24,
                textAlign: "center",
                color: "var(--text-muted)",
                fontSize: 12,
              }}
            >
              No matching stock.
            </div>
          ) : (
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 10,
                overflow: "hidden",
              }}
            >
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>Model</th>
                    <th>Category</th>
                    <th style={{ textAlign: "right" }}>Kochi</th>
                    <th style={{ textAlign: "right" }}>Bangalore</th>
                    <th style={{ textAlign: "right" }}>Total</th>
                    <th>Serials tracked?</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStock.map((s) => {
                    const isOpen = expandedModel === s.model;
                    return (
                      <React.Fragment key={s.model}>
                        <tr
                          className="ss-row"
                          onClick={() => toggleExpand(s.model)}
                        >
                          <td style={{ width: 20, color: "var(--text-muted)" }}>
                            {isOpen ? "▾" : "▸"}
                          </td>
                          <td style={{ fontWeight: 500 }}>{s.model}</td>
                          <td style={{ color: "var(--text-muted)" }}>
                            {s.category}
                          </td>
                          <td style={{ textAlign: "right" }}>{s.kochiQty}</td>
                          <td style={{ textAlign: "right" }}>
                            {s.bangaloreQty}
                          </td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>
                            {s.totalQty}
                          </td>
                          <td>
                            {s.hasSerialData ? (
                              <span
                                style={{
                                  fontSize: 10,
                                  color: "var(--accent-green)",
                                }}
                              >
                                ✓ Yes
                              </span>
                            ) : (
                              <span
                                style={{
                                  fontSize: 10,
                                  color: "var(--text-muted)",
                                }}
                              >
                                — No serials recorded
                              </span>
                            )}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td></td>
                            <td
                              colSpan={6}
                              style={{
                                padding: "8px 10px 14px",
                                background: "var(--bg-input)",
                              }}
                            >
                              {s.lots.length === 0 ? (
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: "var(--text-muted)",
                                  }}
                                >
                                  No lot detail available.
                                </div>
                              ) : (
                                <div
                                  style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 8,
                                  }}
                                >
                                  {s.lots.map((lot) => (
                                    <div
                                      key={lot.lotId}
                                      style={{
                                        background: "var(--bg-card)",
                                        border: "1px solid var(--border)",
                                        borderRadius: 8,
                                        padding: "8px 12px",
                                      }}
                                    >
                                      <div
                                        style={{
                                          display: "flex",
                                          justifyContent: "space-between",
                                          alignItems: "center",
                                          marginBottom: 6,
                                          flexWrap: "wrap",
                                          gap: 6,
                                        }}
                                      >
                                        <div style={{ fontSize: 11 }}>
                                          <span style={{ fontWeight: 600 }}>
                                            {lot.lotId}
                                          </span>
                                          <span
                                            style={{
                                              color: "var(--text-muted)",
                                            }}
                                          >
                                            {" "}
                                            · {lot.location} ·{" "}
                                            {fmtDate(lot.date)} · {lot.vendor}
                                          </span>
                                        </div>
                                        <span
                                          style={{
                                            fontSize: 11,
                                            fontWeight: 600,
                                            color: "var(--accent-green)",
                                          }}
                                        >
                                          {lot.remainingQty} of{" "}
                                          {lot.qtyPurchased} remaining
                                        </span>
                                      </div>
                                      {lot.serialNumbers.length > 0 ? (
                                        <div
                                          style={{
                                            display: "flex",
                                            gap: 5,
                                            flexWrap: "wrap",
                                          }}
                                        >
                                          {lot.serialNumbers.map((sn, i) => (
                                            <span
                                              key={i}
                                              className="ss-serial-chip"
                                            >
                                              {sn}
                                            </span>
                                          ))}
                                        </div>
                                      ) : (
                                        <div
                                          style={{
                                            fontSize: 10,
                                            color: "var(--text-muted)",
                                            fontStyle: "italic",
                                          }}
                                        >
                                          No serials recorded for this lot
                                          (purchased before serial tracking, or
                                          entered without them)
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "lookup" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              placeholder="Enter a serial number (e.g. 72690288WS)…"
              value={serialQuery}
              onChange={(e) => setSerialQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") doSerialSearch();
              }}
              style={{ flex: 1, fontFamily: "monospace" }}
            />
            <button
              className="btn-primary"
              onClick={doSerialSearch}
              disabled={searching}
            >
              {searching ? "Searching…" : "Search"}
            </button>
          </div>

          {searched &&
            !searching &&
            lotMatches.length === 0 &&
            saleMatches.length === 0 && (
              <div
                style={{
                  padding: 20,
                  textAlign: "center",
                  color: "var(--text-muted)",
                  fontSize: 12,
                }}
              >
                No match found for "{serialQuery}". It may belong to a unit
                purchased before serial tracking began.
              </div>
            )}

          {saleMatches.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 6,
                }}
              >
                Sold — {saleMatches.length} match
                {saleMatches.length !== 1 ? "es" : ""}
              </div>
              {saleMatches.map((m, i) => (
                <div
                  key={i}
                  style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "10px 14px",
                    marginBottom: 6,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
                      {m.serial}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        padding: "1px 8px",
                        borderRadius: 99,
                        background: "rgba(239,68,68,0.1)",
                        color: "var(--accent-red)",
                        fontWeight: 600,
                      }}
                    >
                      SOLD
                    </span>
                  </div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    {m.model} — sold to <strong>{m.soldTo}</strong>
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      marginTop: 2,
                    }}
                  >
                    Invoice {m.invoiceNumber} · {fmtDate(m.saleDate)} ·{" "}
                    {m.location}
                  </div>
                </div>
              ))}
            </div>
          )}

          {lotMatches.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 6,
                }}
              >
                In purchase records — {lotMatches.length} match
                {lotMatches.length !== 1 ? "es" : ""}
              </div>
              {lotMatches.map((m, i) => (
                <div
                  key={i}
                  style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "10px 14px",
                    marginBottom: 6,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
                      {m.serial}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        padding: "1px 8px",
                        borderRadius: 99,
                        fontWeight: 600,
                        background:
                          m.lotRemainingQty > 0
                            ? "rgba(34,197,94,0.1)"
                            : "rgba(245,158,11,0.1)",
                        color:
                          m.lotRemainingQty > 0
                            ? "var(--accent-green)"
                            : "var(--accent-amber)",
                      }}
                    >
                      {m.lotRemainingQty > 0 ? "LOT HAS STOCK" : "LOT DEPLETED"}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    {m.model} — {m.lotId} ({m.vendor})
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      marginTop: 2,
                    }}
                  >
                    Purchased {fmtDate(m.purchaseDate)} · {m.location} ·{" "}
                    {m.lotRemainingQty} units remaining in this lot
                  </div>
                </div>
              ))}
            </div>
          )}

          {!searched && (
            <div
              style={{
                padding: 20,
                textAlign: "center",
                color: "var(--text-muted)",
                fontSize: 12,
              }}
            >
              Search any serial number to see whether it's in stock or which
              customer it was sold to.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
