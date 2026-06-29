"use client";
// src/components/PendingInvoices.tsx
//
// Dashboard widget showing invoices with status = 'pending_dispatch'.
// Clicking "Dispatch" calls PATCH /api/invoices/<id>/dispatch which
// runs FIFO consumption and updates Google Sheets stock.

import { useEffect, useState, useCallback } from "react";

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
  customer_snapshot: {
    name: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    gstin?: string;
    phone?: string;
  } | null;
  location: string;
  line_items: LineItem[];
  charges: Array<{ label: string; amount: number }>; // ← packing / forwarding / transport
  subtotal: number;
  gst_rate: number;
  gst_amount: number;
  total: number;
  notes: string | null;
  status: string;
  created_at: string;
}

function fmt(v: number) {
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}K`;
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
}

function fmtFull(v: number) {
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ─── Detail modal for a single invoice ────────────────────────────────────────
function InvoiceDetailModal({
  invoice,
  onClose,
  onDispatched,
  onCancelled,
}: {
  invoice: Invoice;
  onClose: () => void;
  onDispatched: () => void;
  onCancelled: () => void;
}) {
  const [dispatching, setDispatching] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);

  const handleDispatch = async () => {
    setDispatching(true);
    setError("");
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/dispatch`, {
        method: "PATCH",
      });
      const d = await res.json();
      if (!res.ok) {
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
      const res = await fetch(`/api/invoices/${invoice.id}/dispatch`, {
        method: "DELETE",
      });
      const d = await res.json();
      if (!res.ok) {
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

  const customer = invoice.customer_snapshot;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        zIndex: 100,
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
          borderRadius: 12,
          padding: "20px 22px",
          width: "100%",
          maxWidth: 680,
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          overflowY: "auto",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              {invoice.invoice_number}
            </div>
            <div
              style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}
            >
              {fmtDate(invoice.invoice_date)} · {invoice.location}
              {invoice.notes && <span> · {invoice.notes}</span>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontSize: 10,
                padding: "3px 10px",
                borderRadius: 99,
                background: "rgba(245,158,11,0.12)",
                color: "var(--accent-amber)",
                fontWeight: 600,
              }}
            >
              ⏳ Pending dispatch
            </span>
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 20,
                lineHeight: 1,
                padding: "0 4px",
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Customer */}
        {customer && (
          <div
            style={{
              background: "var(--bg-input)",
              borderRadius: 8,
              padding: "10px 12px",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "6px 16px",
              fontSize: 12,
            }}
          >
            <div
              style={{ gridColumn: "1/-1", fontWeight: 600, marginBottom: 4 }}
            >
              {customer.name}
            </div>
            {customer.address && (
              <div style={{ color: "var(--text-muted)" }}>
                {[
                  customer.address,
                  customer.city,
                  customer.state,
                  customer.pincode,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </div>
            )}
            {customer.gstin && (
              <div style={{ color: "var(--text-muted)" }}>
                GSTIN: {customer.gstin}
              </div>
            )}
          </div>
        )}

        {/* Line items table */}
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
                <th>Description</th>
                <th>HSN</th>
                <th style={{ textAlign: "right" }}>Qty</th>
                <th style={{ textAlign: "right" }}>Rate (₹)</th>
                <th style={{ textAlign: "right" }}>Disc</th>
                <th style={{ textAlign: "right" }}>Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {invoice.line_items.map((l, i) => {
                const effectiveRate =
                  l.unitSalePrice * (1 - (l.discount ?? 0) / 100);
                const amount = effectiveRate * l.qty;
                return (
                  <>
                    <tr key={i}>
                      <td style={{ color: "var(--text-muted)" }}>{i + 1}</td>
                      <td style={{ fontWeight: 500 }}>{l.model}</td>
                      <td style={{ color: "var(--text-muted)", fontSize: 11 }}>
                        {l.description}
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
                        {fmtFull(l.unitSalePrice)}
                        {l.discount > 0 && (
                          <div
                            style={{
                              fontSize: 10,
                              color: "var(--accent-amber)",
                            }}
                          >
                            − {l.discount}% → {fmtFull(effectiveRate)}
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
                        {fmtFull(amount)}
                      </td>
                    </tr>
                    {/* Serial numbers row if any */}
                    {l.serialNumbers && l.serialNumbers.length > 0 && (
                      <tr
                        key={`sn-${i}`}
                        style={{ background: "rgba(255,255,255,0.015)" }}
                      >
                        <td />
                        <td
                          colSpan={7}
                          style={{ paddingTop: 3, paddingBottom: 6 }}
                        >
                          <div
                            style={{
                              fontSize: 10,
                              color: "var(--text-muted)",
                              display: "flex",
                              gap: 8,
                              flexWrap: "wrap",
                            }}
                          >
                            {l.serialNumbers.map((sn, si) => (
                              <span
                                key={si}
                                style={{
                                  fontFamily: "monospace",
                                  background: "var(--bg-input)",
                                  padding: "1px 6px",
                                  borderRadius: 4,
                                }}
                              >
                                S/N {si + 1}: {sn || "—"}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
              {/* Charges rows — rendered as non-stock line items below products */}
              {(invoice.charges ?? []).length > 0 && (
                <tr>
                  <td
                    colSpan={8}
                    style={{
                      padding: "4px 10px",
                      background: "rgba(255,255,255,0.02)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--text-muted)",
                        fontStyle: "italic",
                      }}
                    >
                      — charges —
                    </div>
                  </td>
                </tr>
              )}
              {(invoice.charges ?? []).map((c, ci) => (
                <tr
                  key={`charge-${ci}`}
                  style={{ background: "rgba(255,255,255,0.015)" }}
                >
                  <td style={{ color: "var(--text-muted)" }}>—</td>
                  <td
                    colSpan={3}
                    style={{ color: "var(--text-dim)", fontStyle: "italic" }}
                  >
                    {c.label}
                  </td>
                  <td style={{ textAlign: "right" }}>1</td>
                  <td style={{ textAlign: "right" }}>{fmtFull(c.amount)}</td>
                  <td
                    style={{ textAlign: "right", color: "var(--text-muted)" }}
                  >
                    —
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 500 }}>
                    {fmtFull(c.amount)}
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
              minWidth: 280,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {/* Show product sub-total separately if charges exist */}
            {(invoice.charges ?? []).length > 0 &&
              (() => {
                const productSub = invoice.line_items.reduce(
                  (s, l) =>
                    s + l.qty * l.unitSalePrice * (1 - (l.discount ?? 0) / 100),
                  0,
                );
                const chargesTotal = (invoice.charges ?? []).reduce(
                  (s, c) => s + c.amount,
                  0,
                );
                return (
                  <>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 11,
                        color: "var(--text-muted)",
                      }}
                    >
                      <span>Products</span>
                      <span>{fmtFull(productSub)}</span>
                    </div>
                    {(invoice.charges ?? []).map((c, ci) => (
                      <div
                        key={ci}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 11,
                          color: "var(--text-muted)",
                        }}
                      >
                        <span>{c.label}</span>
                        <span>{fmtFull(c.amount)}</span>
                      </div>
                    ))}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 12,
                        color: "var(--text-dim)",
                        borderTop: "1px dashed var(--border)",
                        paddingTop: 4,
                        marginTop: 2,
                      }}
                    >
                      <span>Sub-total (ex-GST)</span>
                      <span>{fmtFull(productSub + chargesTotal)}</span>
                    </div>
                  </>
                );
              })()}
            {!(invoice.charges ?? []).length && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12,
                  color: "var(--text-dim)",
                }}
              >
                <span>Sub total</span>
                <span>{fmtFull(invoice.subtotal)}</span>
              </div>
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                color: "var(--text-dim)",
              }}
            >
              <span>GST ({invoice.gst_rate}%)</span>
              <span>{fmtFull(invoice.gst_amount)}</span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 14,
                fontWeight: 700,
                color: "var(--accent-green)",
                borderTop: "1px solid var(--border)",
                paddingTop: 6,
                marginTop: 3,
              }}
            >
              <span>Total</span>
              <span>{fmtFull(invoice.total)}</span>
            </div>
          </div>
        </div>

        {/* Dispatch warning */}
        <div
          style={{
            background: "rgba(34,197,94,0.07)",
            border: "1px solid rgba(34,197,94,0.25)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 12,
            color: "var(--accent-green)",
          }}
        >
          <div style={{ fontWeight: 600 }}>Ready to dispatch?</div>
          <div style={{ fontSize: 11, marginTop: 3, opacity: 0.9 }}>
            Clicking <strong>Mark as Dispatched</strong> will deduct{" "}
            {invoice.line_items.map((l) => `${l.qty}× ${l.model}`).join(", ")}{" "}
            from <strong>{invoice.location}</strong> stock using FIFO and log
            the sale transactions.
          </div>
        </div>

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

        {/* Cancel confirmation */}
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
              This will mark the invoice as cancelled. Stock was never deducted
              so no reversal is needed.
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
                {cancelling ? "Cancelling…" : "Yes, cancel invoice"}
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        {!confirmCancel && (
          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
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
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn-ghost"
                style={{ fontSize: 11 }}
                onClick={onClose}
              >
                Close
              </button>
              <button
                className="btn-primary"
                style={{ fontSize: 11, background: "var(--accent-green)" }}
                onClick={handleDispatch}
                disabled={dispatching}
              >
                {dispatching
                  ? "Dispatching…"
                  : "✓ Mark as Dispatched → update stock"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main widget ──────────────────────────────────────────────────────────────
export default function PendingInvoices({
  onStockChanged,
}: {
  onStockChanged?: () => void;
}) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [toastMsg, setToastMsg] = useState("");
  const [toastColor, setToastColor] = useState("var(--accent-green)");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/invoices?status=pending_dispatch&limit=30");
      const d = await r.json();
      setInvoices(d.invoices ?? []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const showToast = (msg: string, color = "var(--accent-green)") => {
    setToastMsg(msg);
    setToastColor(color);
    setTimeout(() => setToastMsg(""), 4000);
  };

  const handleDispatched = () => {
    setSelected(null);
    load();
    onStockChanged?.();
    showToast("✓ Dispatched! Stock updated in Google Sheets.");
  };

  const handleCancelled = () => {
    setSelected(null);
    load();
    showToast("Invoice cancelled.", "var(--text-muted)");
  };

  if (loading) return null;
  if (invoices.length === 0) return null;

  return (
    <>
      {selected && (
        <InvoiceDetailModal
          invoice={selected}
          onClose={() => setSelected(null)}
          onDispatched={handleDispatched}
          onCancelled={handleCancelled}
        />
      )}

      {toastMsg && (
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
            color: toastColor,
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
            fontWeight: 500,
          }}
        >
          {toastMsg}
        </div>
      )}

      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid rgba(245,158,11,0.35)",
          borderRadius: 10,
          padding: "12px 14px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "var(--accent-amber)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              ⏳ Pending dispatch ({invoices.length})
            </div>
            <div
              style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}
            >
              Invoices generated — stock not yet deducted. Click to dispatch.
            </div>
          </div>
          <button
            className="btn-ghost"
            style={{ fontSize: 11, padding: "4px 10px" }}
            onClick={load}
          >
            ↻
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {invoices.map((inv) => {
            const itemSummary = inv.line_items
              .map((l) => `${l.qty}× ${l.model}`)
              .join(", ");

            return (
              <div
                key={inv.id}
                onClick={() => setSelected(inv)}
                style={{
                  background: "var(--bg-input)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  transition: "border-color 0.15s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.borderColor = "var(--accent-amber)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.borderColor = "var(--border)")
                }
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 12 }}>
                      {inv.invoice_number}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {fmtDate(inv.invoice_date)}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        padding: "1px 6px",
                        borderRadius: 4,
                        background: "rgba(59,130,246,0.1)",
                        color: "var(--accent)",
                      }}
                    >
                      {inv.location}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      marginTop: 3,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {inv.customer_snapshot?.name && (
                      <span
                        style={{ fontWeight: 500, color: "var(--text-dim)" }}
                      >
                        {inv.customer_snapshot.name} ·{" "}
                      </span>
                    )}
                    {itemSummary}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--accent-green)",
                    }}
                  >
                    {fmt(inv.total)}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    incl. GST
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 10,
                    padding: "4px 10px",
                    borderRadius: 6,
                    background: "rgba(34,197,94,0.1)",
                    color: "var(--accent-green)",
                    fontWeight: 600,
                    flexShrink: 0,
                    border: "1px solid rgba(34,197,94,0.2)",
                  }}
                >
                  Dispatch →
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
