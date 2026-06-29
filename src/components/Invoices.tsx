"use client";
import React from "react";
// src/components/Invoices.tsx
// Full invoices screen — two tabs: Pending dispatch + All invoices
// Left: list panel. Right: invoice detail panel (not a modal).

import { useState, useEffect, useCallback } from "react";

interface LineItem {
  model: string;
  itemCode: string;
  hsn: string;
  description: string;
  qty: number;
  unitSalePrice: number;
  discount: number;
  serialNumbers: string[];
  warranty: string;
}

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  customer_snapshot: any;
  location: string;
  line_items: LineItem[];
  charges: Array<{ label: string; amount: number }>;
  subtotal: number;
  gst_rate: number;
  gst_amount: number;
  total: number;
  notes: string | null;
  status: string;
  dispatched_at: string | null;
  created_at: string;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const fmtMoney = (n: number) =>
  "₹" +
  n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtShort = (n: number) => {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
};

const STATUS_META: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  pending_dispatch: {
    label: "Pending dispatch",
    color: "var(--accent-amber)",
    bg: "rgba(245,158,11,0.1)",
  },
  dispatched: {
    label: "Dispatched",
    color: "var(--accent-green)",
    bg: "rgba(34,197,94,0.1)",
  },
  cancelled: {
    label: "Cancelled",
    color: "var(--accent-red)",
    bg: "rgba(239,68,68,0.1)",
  },
};

// ─── Invoice detail panel ─────────────────────────────────────────────────────
function InvoiceDetail({
  invoice,
  onDispatched,
  onCancelled,
  onClose,
}: {
  invoice: Invoice;
  onDispatched: () => void;
  onCancelled: () => void;
  onClose: () => void;
}) {
  const [dispatchDate, setDispatchDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [dispatching, setDispatching] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState("");

  const isPending = invoice.status === "pending_dispatch";
  const sm = STATUS_META[invoice.status] ?? STATUS_META.pending_dispatch;
  const customer = invoice.customer_snapshot;

  const productSubtotal = invoice.line_items.reduce(
    (s, l) => s + l.qty * l.unitSalePrice * (1 - (l.discount ?? 0) / 100),
    0,
  );
  const chargesTotal = (invoice.charges ?? []).reduce(
    (s, c) => s + c.amount,
    0,
  );

  const handleDispatch = async () => {
    setDispatching(true);
    setError("");
    try {
      const r = await fetch(`/api/invoices/${invoice.id}/dispatch`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dispatched_at: dispatchDate }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error || "Dispatch failed");
        setDispatching(false);
        return;
      }
      onDispatched();
    } catch {
      setError("Network error.");
      setDispatching(false);
    }
  };

  const handleCancel = async () => {
    setCancelling(true);
    setError("");
    try {
      const r = await fetch(`/api/invoices/${invoice.id}/dispatch`, {
        method: "DELETE",
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error || "Cancel failed");
        setCancelling(false);
        return;
      }
      onCancelled();
    } catch {
      setError("Network error.");
      setCancelling(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          background: "var(--bg-card)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 15 }}>
                {invoice.invoice_number}
              </span>
              <span
                style={{
                  fontSize: 10,
                  padding: "2px 8px",
                  borderRadius: 99,
                  background: sm.bg,
                  color: sm.color,
                  fontWeight: 600,
                }}
              >
                {sm.label}
              </span>
              <span
                style={{
                  fontSize: 11,
                  padding: "1px 7px",
                  borderRadius: 4,
                  background: "rgba(59,130,246,0.1)",
                  color: "var(--accent)",
                }}
              >
                {invoice.location}
              </span>
            </div>
            <div
              style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}
            >
              {fmtDate(invoice.invoice_date)}
              {invoice.dispatched_at &&
                ` · Dispatched ${fmtDate(invoice.dispatched_at)}`}
              {invoice.notes && ` · ${invoice.notes}`}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "14px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {/* Customer */}
        {customer && (
          <div
            style={{
              background: "rgba(59,130,246,0.06)",
              border: "1px solid rgba(59,130,246,0.2)",
              borderRadius: 8,
              padding: "10px 12px",
              fontSize: 12,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 3 }}>
              {customer.display_name || customer.name}
            </div>
            {(customer.billing_address || customer.address) && (
              <div style={{ color: "var(--text-muted)" }}>
                {[
                  customer.billing_address || customer.address,
                  customer.billing_city || customer.city,
                  customer.billing_state || customer.state,
                  customer.billing_pincode || customer.pincode,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </div>
            )}
            <div
              style={{
                display: "flex",
                gap: 10,
                marginTop: 3,
                flexWrap: "wrap",
              }}
            >
              {customer.gstin && (
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: 11,
                    color: "var(--text-muted)",
                  }}
                >
                  GSTIN: {customer.gstin}
                </span>
              )}
              {(customer.phone || customer.mobile) && (
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {customer.phone || customer.mobile}
                </span>
              )}
              {customer.email && (
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {customer.email}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Line items */}
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
                <th>#</th>
                <th>Model</th>
                <th>HSN</th>
                <th style={{ textAlign: "right" }}>Qty</th>
                <th style={{ textAlign: "right" }}>Rate</th>
                <th style={{ textAlign: "right" }}>Disc</th>
                <th style={{ textAlign: "right" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.line_items.map((l, i) => {
                const eff = l.unitSalePrice * (1 - (l.discount ?? 0) / 100);
                return (
                  <React.Fragment key={i}>
                    <tr>
                      <td style={{ color: "var(--text-muted)" }}>{i + 1}</td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{l.model}</div>
                        {l.description && (
                          <div
                            style={{ fontSize: 10, color: "var(--text-muted)" }}
                          >
                            {l.description}
                          </div>
                        )}
                        {l.warranty && (
                          <div
                            style={{ fontSize: 10, color: "var(--text-muted)" }}
                          >
                            Warranty: {l.warranty}
                          </div>
                        )}
                      </td>
                      <td
                        style={{
                          color: "var(--text-muted)",
                          fontFamily: "monospace",
                        }}
                      >
                        {l.hsn}
                      </td>
                      <td style={{ textAlign: "right" }}>{l.qty}</td>
                      <td style={{ textAlign: "right" }}>
                        {fmtMoney(l.unitSalePrice)}
                        {l.discount > 0 && (
                          <div
                            style={{
                              fontSize: 10,
                              color: "var(--accent-amber)",
                            }}
                          >
                            → {fmtMoney(eff)}
                          </div>
                        )}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          color:
                            l.discount > 0
                              ? "var(--accent-amber)"
                              : "var(--text-muted)",
                        }}
                      >
                        {l.discount > 0 ? `${l.discount}%` : "—"}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 500 }}>
                        {fmtMoney(eff * l.qty)}
                      </td>
                    </tr>
                    {l.serialNumbers?.filter(Boolean).length > 0 && (
                      <tr
                        key={`sn-${i}`}
                        style={{ background: "rgba(255,255,255,0.01)" }}
                      >
                        <td />
                        <td colSpan={6}>
                          <div
                            style={{
                              display: "flex",
                              gap: 6,
                              flexWrap: "wrap",
                              paddingBottom: 4,
                            }}
                          >
                            {l.serialNumbers.filter(Boolean).map((sn, si) => (
                              <span
                                key={si}
                                style={{
                                  fontSize: 10,
                                  fontFamily: "monospace",
                                  background: "var(--bg-input)",
                                  padding: "1px 6px",
                                  borderRadius: 4,
                                  color: "var(--text-muted)",
                                }}
                              >
                                S/N {si + 1}: {sn}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {(invoice.charges ?? []).map((c, ci) => (
                <tr
                  key={`charge-${ci}`}
                  style={{ background: "rgba(255,255,255,0.01)" }}
                >
                  <td style={{ color: "var(--text-muted)" }}>—</td>
                  <td
                    colSpan={3}
                    style={{ color: "var(--text-dim)", fontStyle: "italic" }}
                  >
                    {c.label}
                  </td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(c.amount)}</td>
                  <td
                    style={{ textAlign: "right", color: "var(--text-muted)" }}
                  >
                    —
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 500 }}>
                    {fmtMoney(c.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div
            style={{
              background: "var(--bg-input)",
              borderRadius: 8,
              padding: "10px 14px",
              minWidth: 260,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                color: "var(--text-dim)",
              }}
            >
              <span>Products sub-total</span>
              <span>{fmtMoney(productSubtotal)}</span>
            </div>
            {chargesTotal > 0 &&
              (invoice.charges ?? []).map((c, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 11,
                    color: "var(--text-muted)",
                  }}
                >
                  <span>{c.label}</span>
                  <span>{fmtMoney(c.amount)}</span>
                </div>
              ))}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                color: "var(--text-dim)",
              }}
            >
              <span>GST ({invoice.gst_rate}%)</span>
              <span>{fmtMoney(invoice.gst_amount)}</span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 15,
                fontWeight: 700,
                color: "var(--accent-green)",
                borderTop: "1px solid var(--border)",
                paddingTop: 6,
                marginTop: 2,
              }}
            >
              <span>Total</span>
              <span>{fmtMoney(invoice.total)}</span>
            </div>
          </div>
        </div>

        {/* Dispatch section */}
        {isPending && (
          <div
            style={{
              background: "rgba(34,197,94,0.06)",
              border: "1px solid rgba(34,197,94,0.25)",
              borderRadius: 8,
              padding: "12px 14px",
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--accent-green)",
                marginBottom: 8,
              }}
            >
              Ready to dispatch?
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <div>
                <label
                  style={{
                    fontSize: 10,
                    color: "var(--text-muted)",
                    display: "block",
                    marginBottom: 3,
                  }}
                >
                  Dispatch date
                </label>
                <input
                  type="date"
                  value={dispatchDate}
                  onChange={(e) => setDispatchDate(e.target.value)}
                  style={{ width: 160 }}
                />
              </div>
              <button
                className="btn-primary"
                style={{
                  fontSize: 12,
                  background: "var(--accent-green)",
                  marginTop: 14,
                }}
                onClick={handleDispatch}
                disabled={dispatching}
              >
                {dispatching ? "Dispatching…" : "✓ Mark as dispatched"}
              </button>
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--accent-green)",
                opacity: 0.8,
                marginTop: 6,
              }}
            >
              Deducts{" "}
              {invoice.line_items.map((l) => `${l.qty}× ${l.model}`).join(", ")}{" "}
              from {invoice.location} via FIFO and logs the sale.
            </div>
          </div>
        )}

        {error && (
          <div
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.3)",
              fontSize: 12,
              color: "var(--accent-red)",
            }}
          >
            {error}
          </div>
        )}

        {/* Cancel */}
        {isPending && !confirmCancel && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <button
              className="btn-ghost"
              style={{
                fontSize: 11,
                color: "var(--accent-red)",
                borderColor: "rgba(239,68,68,0.3)",
              }}
              onClick={() => setConfirmCancel(true)}
            >
              Cancel invoice
            </button>
          </div>
        )}
        {confirmCancel && (
          <div
            style={{
              background: "rgba(239,68,68,0.07)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 12,
            }}
          >
            <div
              style={{
                fontWeight: 600,
                color: "var(--accent-red)",
                marginBottom: 8,
              }}
            >
              Cancel this invoice?
            </div>
            <div style={{ color: "var(--text-muted)", marginBottom: 10 }}>
              Stock was never deducted so no reversal is needed.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn-ghost"
                style={{ fontSize: 11 }}
                onClick={() => setConfirmCancel(false)}
              >
                Go back
              </button>
              <button
                className="btn-primary"
                style={{ fontSize: 11, background: "var(--accent-red)" }}
                onClick={handleCancel}
                disabled={cancelling}
              >
                {cancelling ? "Cancelling…" : "Yes, cancel"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Invoices screen ─────────────────────────────────────────────────────
export default function Invoices({
  onStockChanged,
}: {
  onStockChanged?: () => void;
}) {
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async (status?: string) => {
    setLoading(true);
    try {
      const url = status
        ? `/api/invoices?status=${status}&limit=100`
        : "/api/invoices?limit=100";
      const r = await fetch(url);
      const d = await r.json();
      setInvoices(d.invoices ?? []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load(tab === "pending" ? "pending_dispatch" : undefined);
  }, [tab, load]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  };

  const handleDispatched = () => {
    showToast("✓ Dispatched! Stock updated in Google Sheets.");
    setSelected(null);
    load(tab === "pending" ? "pending_dispatch" : undefined);
    onStockChanged?.();
  };

  const handleCancelled = () => {
    showToast("Invoice cancelled.");
    setSelected(null);
    load(tab === "pending" ? "pending_dispatch" : undefined);
  };

  const listWidth = selected ? 300 : "100%";

  return (
    <div
      style={{ display: "flex", height: "100%", overflow: "hidden", gap: 0 }}
    >
      <style>{`
        .inv-item { padding: 10px 12px; border-bottom: 1px solid var(--border); cursor: pointer; transition: background 0.1s; }
        .inv-item:hover { background: rgba(255,255,255,0.03); }
        .inv-item.active { background: rgba(59,130,246,0.08); border-left: 2px solid var(--accent); }
        .inv-tab { font-size: 12px; padding: 8px 14px; cursor: pointer; border-bottom: 2px solid transparent; color: var(--text-muted); transition: all 0.1s; margin-bottom: -1px; }
        .inv-tab.on { color: var(--text); border-bottom-color: var(--accent); font-weight: 500; }
      `}</style>

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            zIndex: 200,
            padding: "10px 16px",
            borderRadius: 8,
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            fontSize: 12,
            color: "var(--accent-green)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
            fontWeight: 500,
          }}
        >
          {toast}
        </div>
      )}

      {/* Left — Invoice list */}
      <div
        style={{
          width: listWidth,
          minWidth: selected ? 300 : undefined,
          flexShrink: 0,
          borderRight: selected ? "1px solid var(--border)" : "none",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          transition: "width 0.2s",
        }}
      >
        {/* Tabs */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid var(--border)",
            padding: "0 4px",
            flexShrink: 0,
            background: "var(--bg-card)",
          }}
        >
          <div
            className={`inv-tab${tab === "pending" ? " on" : ""}`}
            onClick={() => {
              setTab("pending");
              setSelected(null);
            }}
          >
            Pending dispatch
          </div>
          <div
            className={`inv-tab${tab === "all" ? " on" : ""}`}
            onClick={() => {
              setTab("all");
              setSelected(null);
            }}
          >
            All invoices
          </div>
          <div style={{ flex: 1 }} />
          <button
            className="btn-ghost"
            style={{ fontSize: 10, margin: "6px 4px" }}
            onClick={() =>
              load(tab === "pending" ? "pending_dispatch" : undefined)
            }
          >
            ↻
          </button>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div
              style={{
                padding: 16,
                fontSize: 12,
                color: "var(--text-muted)",
                textAlign: "center",
              }}
            >
              Loading…
            </div>
          ) : invoices.length === 0 ? (
            <div
              style={{
                padding: 24,
                fontSize: 12,
                color: "var(--text-muted)",
                textAlign: "center",
              }}
            >
              {tab === "pending"
                ? "No invoices pending dispatch."
                : "No invoices found."}
            </div>
          ) : (
            invoices.map((inv) => {
              const sm =
                STATUS_META[inv.status] ?? STATUS_META.pending_dispatch;
              const customerName =
                inv.customer_snapshot?.display_name ||
                inv.customer_snapshot?.name ||
                "—";
              const products = inv.line_items
                .map((l) => `${l.qty}× ${l.model}`)
                .join(", ");
              return (
                <div
                  key={inv.id}
                  className={`inv-item${selected?.id === inv.id ? " active" : ""}`}
                  onClick={() => setSelected(inv)}
                >
                  {/* Company name — most important */}
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 13,
                      color: "var(--text)",
                      marginBottom: 2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {customerName}
                  </div>
                  {/* Product list */}
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-dim)",
                      marginBottom: 4,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {products}
                  </div>
                  {/* Bottom row: invoice # + date + total + status */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                      {inv.invoice_number}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                      ·
                    </span>
                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                      {fmtDate(inv.invoice_date)}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--accent-green)",
                      }}
                    >
                      {fmtShort(inv.total)}
                    </span>
                    {tab === "all" && (
                      <span
                        style={{
                          fontSize: 9,
                          padding: "1px 6px",
                          borderRadius: 99,
                          background: sm.bg,
                          color: sm.color,
                          fontWeight: 600,
                        }}
                      >
                        {sm.label}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "6px 12px",
            borderTop: "1px solid var(--border)",
            fontSize: 10,
            color: "var(--text-muted)",
            flexShrink: 0,
          }}
        >
          {invoices.length} invoice{invoices.length !== 1 ? "s" : ""}
          {invoices.length > 0 &&
            ` · ${fmtShort(invoices.reduce((s, i) => s + i.total, 0))} total`}
        </div>
      </div>

      {/* Right — Detail panel */}
      {selected && (
        <div
          style={{
            flex: 1,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <InvoiceDetail
            invoice={selected}
            onDispatched={handleDispatched}
            onCancelled={handleCancelled}
            onClose={() => setSelected(null)}
          />
        </div>
      )}

      {/* Empty state */}
      {!selected && !loading && invoices.length > 0 && (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            fontSize: 13,
          }}
        >
          Select an invoice to view details
        </div>
      )}
    </div>
  );
}
