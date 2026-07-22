"use client";
// src/components/ReorderExplainModal.tsx
//
// Shown when someone taps "Explain" on a row in the Dashboard's item
// ordering priority table. Written for a business owner, not a data
// analyst — no "CV", no "regularity %" as the headline text, just plain
// sentences. The numbers are still there for anyone who wants them, but
// they're secondary, labelled in the same plain language.
//
// Also shows a purchase-history chart for this specific model — when
// past orders came in, roughly how big each one was (flagged "Bulk" vs
// "Regular" relative to that item's own typical order size), and who it
// was ordered from — so the priority score isn't a black box.

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";

export interface ReorderItem {
  model: string;
  currentStock: number;
  velocityPerDay: number;
  daysOfCover: number | null;
  regularity: number;
  monthsActive: number;
  cv: number;
  daysSinceLastSale: number | null;
  txnCount: number;
  suggestedQty: number;
  score: number;
  tier: "URGENT" | "SOON" | "WATCH" | "OK";
  windowMonths: number;
  leadTimeDays: number;
}

function normalizeModel(m: any): string {
  const s = String(m ?? "").trim();
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

function fmtDate(raw: any): string {
  const d = new Date(String(raw ?? "").split("T")[0]);
  if (isNaN(d.getTime())) return String(raw ?? "—");
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

function friendlyRate(velocityPerDay: number): string {
  if (velocityPerDay <= 0) return "hasn't sold recently";
  const perWeek = velocityPerDay * 7;
  if (perWeek >= 1) return `about ${perWeek.toFixed(1)} units a week`;
  const daysPerUnit = Math.round(1 / velocityPerDay);
  return `about 1 unit every ${daysPerUnit} days`;
}

function patternSentence(item: ReorderItem): string {
  if (item.monthsActive === 0) return "";
  if (item.cv < 0.5) {
    return "It sells fairly steadily, a bit almost every month";
  }
  if (item.cv < 1) {
    return "It sells somewhat unevenly — busier some months than others";
  }
  return "It sells in bursts — this looks more like an occasional bulk order than a steady repeat item";
}

function tierSentence(item: ReorderItem): string {
  switch (item.tier) {
    case "URGENT":
      return `At the current pace, stock could run out before a new order arrives (orders typically take about ${item.leadTimeDays} days). Reorder this now.`;
    case "SOON":
      return "Stock is getting low compared to how this item usually sells. Worth adding to your next order.";
    case "WATCH":
      return "Not urgent yet — just something to keep an eye on.";
    default:
      return item.currentStock > 0
        ? "No action needed — there's enough on hand and it isn't selling fast."
        : "No action needed — this item hasn't been selling, so being out of stock isn't costing you sales right now.";
  }
}

export default function ReorderExplainModal({
  item,
  sales,
  purchases,
  onClose,
}: {
  item: ReorderItem;
  sales: any[];
  purchases: any[];
  onClose: () => void;
}) {
  const modelKey = normalizeModel(item.model);

  // Main chart/table: SALES — this is what actually drives the score
  // (velocity, regularity, "sells in bursts" etc. are all computed from
  // customer sales, not vendor purchases), so the chart has to show the
  // same thing the explanation text is describing.
  const history = sales
    .filter((s) => normalizeModel(s.model) === modelKey)
    .map((s) => ({
      date: s.date,
      qty: Number(s.qty ?? 0),
      customer: s.party ?? s.customer ?? "Unknown customer",
      unitPrice: Number(s.unitPrice ?? s.unitSalePrice ?? 0),
    }))
    .filter((s) => s.qty > 0)
    .sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1));

  const qtys = history.map((h) => h.qty).sort((a, b) => a - b);
  const median =
    qtys.length === 0
      ? 0
      : qtys.length % 2 === 1
        ? qtys[(qtys.length - 1) / 2]
        : (qtys[qtys.length / 2 - 1] + qtys[qtys.length / 2]) / 2;

  const chartData = history.slice(-10).map((h) => ({
    label: fmtDate(h.date),
    qty: h.qty,
    customer: h.customer,
    isBulk: qtys.length >= 2 && h.qty >= median * 1.8 && h.qty > 1,
  }));

  // Secondary, supplementary info only: when this item was last actually
  // restocked from a vendor — useful context, but not the main story.
  const lastPurchase = purchases
    .filter((p) => normalizeModel(p.model) === modelKey)
    .map((p) => ({
      date: p.date,
      qty: Number(p.qty ?? p.qtyPurchased ?? 0),
      vendor: p.party ?? p.vendor ?? p.supplier ?? "Unknown vendor",
    }))
    .filter((p) => p.qty > 0)
    .sort((a, b) => (String(a.date) < String(b.date) ? 1 : -1))[0];

  const noSalesHistory = item.monthsActive === 0;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        zIndex: 400,
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
          maxWidth: 620,
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{item.model}</div>
            <div
              style={{
                marginTop: 8,
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "3px 10px",
                  borderRadius: 99,
                  background:
                    item.tier === "URGENT"
                      ? "var(--accent-red-bg)"
                      : item.tier === "SOON"
                        ? "var(--accent-amber-bg)"
                        : item.tier === "WATCH"
                          ? "var(--accent-bg)"
                          : "var(--bg-input)",
                  color:
                    item.tier === "URGENT"
                      ? "var(--accent-red)"
                      : item.tier === "SOON"
                        ? "var(--accent-amber)"
                        : item.tier === "WATCH"
                          ? "var(--accent)"
                          : "var(--text-muted)",
                }}
              >
                {item.tier}
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color:
                    item.currentStock === 0
                      ? "var(--accent-red)"
                      : "var(--text)",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background:
                      item.currentStock === 0
                        ? "var(--accent-red)"
                        : "var(--accent-green)",
                    display: "inline-block",
                  }}
                />
                {item.currentStock} in stock
              </span>
            </div>
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

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {/* Plain-language explanation */}
          <div
            style={{
              fontSize: 13,
              color: "var(--text)",
              lineHeight: 1.8,
              background: "var(--bg-input)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "14px 16px",
              marginBottom: 16,
            }}
          >
            {noSalesHistory ? (
              <>
                This item hasn't sold in the last {item.windowMonths} months.
                {item.currentStock > 0
                  ? ` You still have ${item.currentStock} unit(s) sitting in stock, so there's no need to order more.`
                  : " There's none in stock, but since it isn't selling, that's not currently costing you anything."}
              </>
            ) : (
              <>
                Over the last {item.windowMonths} months, this item sold{" "}
                {item.txnCount} time{item.txnCount !== 1 ? "s" : ""}, in{" "}
                {item.monthsActive} of those {item.windowMonths} months.{" "}
                {patternSentence(item)}
                {" — "}
                {friendlyRate(item.velocityPerDay)}.{" "}
                {item.currentStock === 0
                  ? "You're currently out of stock."
                  : `You currently have ${item.currentStock} in stock, which covers roughly ${
                      item.daysOfCover !== null
                        ? Math.round(item.daysOfCover)
                        : "—"
                    } days at that pace.`}{" "}
                {item.daysSinceLastSale !== null &&
                  `It last sold ${item.daysSinceLastSale} day(s) ago.`}
              </>
            )}
            <div style={{ marginTop: 10, fontWeight: 600 }}>
              {tierSentence(item)}
            </div>
          </div>

          {/* Purchase history chart */}
          <div style={{ marginBottom: 8 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: 8,
              }}
            >
              Recent sales for this item
            </div>
            {lastPurchase && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginBottom: 10,
                }}
              >
                Last restocked {fmtDate(lastPurchase.date)} — {lastPurchase.qty}{" "}
                unit(s) from {lastPurchase.vendor}.
              </div>
            )}
            {chartData.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                No sales history found for this item.
              </div>
            ) : (
              <>
                <div style={{ width: "100%", height: 160 }}>
                  <ResponsiveContainer>
                    <BarChart data={chartData}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--border)"
                      />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: "var(--text-muted)", fontSize: 10 }}
                        axisLine={{ stroke: "var(--border)" }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: "var(--text-muted)", fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        width={30}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "var(--bg-input)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        formatter={(v: any, _n: any, p: any) => [
                          `${Number(v)} units${p?.payload?.isBulk ? " (bulk sale)" : ""}`,
                          p?.payload?.customer,
                        ]}
                      />
                      <Bar dataKey="qty" radius={[4, 4, 0, 0]}>
                        {chartData.map((d, i) => (
                          <Cell
                            key={i}
                            fill={
                              d.isBulk ? "var(--accent-amber)" : "var(--accent)"
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 14,
                    fontSize: 10,
                    color: "var(--text-muted)",
                    marginTop: 4,
                    marginBottom: 12,
                  }}
                >
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 5 }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: "var(--accent)",
                        display: "inline-block",
                      }}
                    />
                    Regular-sized sale
                  </span>
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 5 }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: "var(--accent-amber)",
                        display: "inline-block",
                      }}
                    />
                    Bulk sale (much bigger than usual)
                  </span>
                </div>

                {/* Sale list with customer */}
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th style={{ textAlign: "right" }}>Qty</th>
                        <th>Customer</th>
                        <th style={{ textAlign: "right" }}>Unit price</th>
                        <th>Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...history]
                        .reverse()
                        .slice(0, 8)
                        .map((h, i) => {
                          const isBulk =
                            qtys.length >= 2 &&
                            h.qty >= median * 1.8 &&
                            h.qty > 1;
                          return (
                            <tr key={i}>
                              <td style={{ color: "var(--text-muted)" }}>
                                {fmtDate(h.date)}
                              </td>
                              <td
                                style={{ textAlign: "right", fontWeight: 500 }}
                              >
                                {h.qty}
                              </td>
                              <td>{h.customer}</td>
                              <td
                                style={{
                                  textAlign: "right",
                                  color: "var(--text-muted)",
                                }}
                              >
                                ₹{h.unitPrice.toLocaleString("en-IN")}
                              </td>
                              <td>
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 600,
                                    color: isBulk
                                      ? "var(--accent-amber)"
                                      : "var(--text-muted)",
                                  }}
                                >
                                  {isBulk ? "Bulk" : "Regular"}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
