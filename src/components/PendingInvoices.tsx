"use client";
import React, { useState, useEffect, useCallback } from "react";
// src/components/PendingInvoices.tsx
// Dashboard widget — shows invoices pending dispatch + inline detail modal.
// Uses the SAME /api/invoices/[id]/dispatch endpoint as the main Invoices screen.

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

// ── Detail modal ─────────────────────────────────────────────────────────────
function InvoiceDetailModal({
  invoice,
  onClose,
  onDispatched,
}: {
  invoice: Invoice;
  onClose: () => void;
  onDispatched: () => void;
}) {
  const [dispatchDate, setDispatchDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [dispatching, setDispatching] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState("");

  const customer = invoice.customer_snapshot;

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
        setError(d.error || "Dispatch failed — check server logs.");
        setDispatching(false);
        return;
      }
      onDispatched();
    } catch (e) {
      setError("Network error — could not reach the server.");
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
      onDispatched();
    } catch {
      setError("Network error.");
      setCancelling(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.8)",
        zIndex: 200,
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
          width: "100%",
          maxWidth: 800,
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>
                {invoice.invoice_number}
              </span>
              <span
                style={{
                  fontSize: 10,
                  padding: "2px 8px",
                  borderRadius: 99,
                  background: "rgba(245,158,11,0.1)",
                  color: "var(--accent-amber)",
                  fontWeight: 600,
                }}
              >
                ⏳ Pending dispatch
              </span>
            </div>
            <div
              style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}
            >
              {fmtDate(invoice.invoice_date)} · {invoice.location} ·{" "}
              {invoice.notes}
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
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {customer && (
            <div
              style={{
                background: "rgba(59,130,246,0.06)",
                border: "1px solid rgba(59,130,246,0.2)",
                borderRadius: 8,
                padding: "10px 14px",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                {customer.display_name || customer.name}
              </div>
              {(customer.billing_address || customer.address) && (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-muted)",
                    marginTop: 2,
                  }}
                >
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
              {customer.gstin && (
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    marginTop: 2,
                  }}
                >
                  GSTIN: {customer.gstin}
                </div>
              )}
            </div>
          )}

          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--bg-input)" }}>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "8px 10px",
                      fontSize: 11,
                      color: "var(--text-muted)",
                    }}
                  >
                    #
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "8px 10px",
                      fontSize: 11,
                      color: "var(--text-muted)",
                    }}
                  >
                    Model
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "8px 10px",
                      fontSize: 11,
                      color: "var(--text-muted)",
                    }}
                  >
                    HSN
                  </th>
                  <th
                    style={{
                      textAlign: "right",
                      padding: "8px 10px",
                      fontSize: 11,
                      color: "var(--text-muted)",
                    }}
                  >
                    Qty
                  </th>
                  <th
                    style={{
                      textAlign: "right",
                      padding: "8px 10px",
                      fontSize: 11,
                      color: "var(--text-muted)",
                    }}
                  >
                    Rate
                  </th>
                  <th
                    style={{
                      textAlign: "right",
                      padding: "8px 10px",
                      fontSize: 11,
                      color: "var(--text-muted)",
                    }}
                  >
                    Disc
                  </th>
                  <th
                    style={{
                      textAlign: "right",
                      padding: "8px 10px",
                      fontSize: 11,
                      color: "var(--text-muted)",
                    }}
                  >
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoice.line_items.map((l, i) => {
                  const effectiveRate =
                    l.unitSalePrice * (1 - (l.discount ?? 0) / 100);
                  const amount = effectiveRate * l.qty;
                  return (
                    // FIX: React.Fragment with a key — the <> shorthand cannot take a key prop.
                    <React.Fragment key={i}>
                      <tr>
                        <td
                          style={{
                            padding: "8px 10px",
                            fontSize: 12,
                            color: "var(--text-muted)",
                          }}
                        >
                          {i + 1}
                        </td>
                        <td
                          style={{
                            padding: "8px 10px",
                            fontSize: 12,
                            fontWeight: 500,
                          }}
                        >
                          {l.model}
                        </td>
                        <td
                          style={{
                            padding: "8px 10px",
                            fontSize: 12,
                            color: "var(--text-muted)",
                            fontFamily: "monospace",
                          }}
                        >
                          {l.hsn}
                        </td>
                        <td
                          style={{
                            padding: "8px 10px",
                            fontSize: 12,
                            textAlign: "right",
                          }}
                        >
                          {l.qty}
                        </td>
                        <td
                          style={{
                            padding: "8px 10px",
                            fontSize: 12,
                            textAlign: "right",
                          }}
                        >
                          {fmtMoney(l.unitSalePrice)}
                        </td>
                        <td
                          style={{
                            padding: "8px 10px",
                            fontSize: 12,
                            textAlign: "right",
                            color:
                              l.discount > 0
                                ? "var(--accent-amber)"
                                : "var(--text-muted)",
                          }}
                        >
                          {l.discount > 0 ? `${l.discount}%` : "—"}
                        </td>
                        <td
                          style={{
                            padding: "8px 10px",
                            fontSize: 12,
                            textAlign: "right",
                            fontWeight: 500,
                          }}
                        >
                          {fmtMoney(amount)}
                        </td>
                      </tr>
                      {l.serialNumbers?.filter(Boolean).length > 0 && (
                        <tr style={{ background: "rgba(255,255,255,0.01)" }}>
                          <td />
                          <td colSpan={6} style={{ padding: "0 10px 8px" }}>
                            <div
                              style={{
                                display: "flex",
                                gap: 6,
                                flexWrap: "wrap",
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
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <div
              style={{
                background: "var(--bg-input)",
                borderRadius: 8,
                padding: "10px 16px",
                minWidth: 240,
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
                <span>Sub total</span>
                <span>{fmtMoney(invoice.subtotal)}</span>
              </div>
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
                  marginTop: 4,
                }}
              >
                <span>Total</span>
                <span>{fmtMoney(invoice.total)}</span>
              </div>
            </div>
          </div>

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
                fontSize: 13,
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
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--accent-green)",
                opacity: 0.85,
                marginTop: 8,
              }}
            >
              Clicking <strong>Mark as Dispatched</strong> will deduct{" "}
              {invoice.line_items.map((l) => `${l.qty}× ${l.model}`).join(", ")}{" "}
              from <strong>{invoice.location}</strong> stock using FIFO and log
              the sale transactions.
            </div>
          </div>

          {error && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 12,
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.3)",
                color: "var(--accent-red)",
              }}
            >
              {error}
            </div>
          )}

          {!confirmCancel ? (
            <button
              onClick={() => setConfirmCancel(true)}
              style={{
                alignSelf: "flex-start",
                background: "transparent",
                border: "1px solid rgba(239,68,68,0.3)",
                color: "var(--accent-red)",
                borderRadius: 6,
                fontSize: 11,
                padding: "5px 12px",
                cursor: "pointer",
              }}
            >
              Cancel invoice
            </button>
          ) : (
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
                  onClick={() => setConfirmCancel(false)}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--border)",
                    color: "var(--text-dim)",
                    borderRadius: 6,
                    fontSize: 11,
                    padding: "5px 12px",
                    cursor: "pointer",
                  }}
                >
                  Go back
                </button>
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  style={{
                    background: "var(--accent-red)",
                    border: "none",
                    color: "#fff",
                    borderRadius: 6,
                    fontSize: 11,
                    padding: "5px 12px",
                    cursor: "pointer",
                  }}
                >
                  {cancelling ? "Cancelling…" : "Yes, cancel"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "14px 20px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text-dim)",
              borderRadius: 6,
              fontSize: 12,
              padding: "7px 16px",
              cursor: "pointer",
            }}
          >
            Close
          </button>
          <button
            onClick={handleDispatch}
            disabled={dispatching}
            style={{
              background: dispatching
                ? "var(--text-muted)"
                : "var(--accent-green)",
              border: "none",
              color: "#fff",
              borderRadius: 6,
              fontSize: 12,
              padding: "7px 16px",
              cursor: dispatching ? "not-allowed" : "pointer",
              fontWeight: 600,
            }}
          >
            {dispatching
              ? "Dispatching…"
              : "✓ Mark as Dispatched → update stock"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main widget ──────────────────────────────────────────────────────────────
export default function PendingInvoices({
  onStockChanged,
}: {
  onStockChanged?: () => void;
}) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/invoices?status=pending_dispatch&limit=50");
      const d = await r.json();
      setInvoices(d.invoices ?? []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDispatched = () => {
    setToast("Stock updated — invoice dispatched.");
    setTimeout(() => setToast(""), 3000);
    setSelected(null);
    load();
    onStockChanged?.();
  };

  if (loading) return null;
  if (invoices.length === 0) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            zIndex: 250,
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

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--accent-amber)",
          }}
        >
          ⏳ {invoices.length} invoice{invoices.length !== 1 ? "s" : ""} pending
          dispatch
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: 10,
        }}
      >
        {invoices.map((inv) => {
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
              onClick={() => setSelected(inv)}
              style={{
                background: "var(--bg-card)",
                border: "1px solid rgba(245,158,11,0.3)",
                borderRadius: 10,
                padding: "12px 14px",
                cursor: "pointer",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                {customerName}
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
                {products}
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: 8,
                }}
              >
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  {inv.invoice_number} · {fmtDate(inv.invoice_date)}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "var(--accent-green)",
                  }}
                >
                  {fmtMoney(inv.total)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {selected && (
        <InvoiceDetailModal
          invoice={selected}
          onClose={() => setSelected(null)}
          onDispatched={handleDispatched}
        />
      )}
    </div>
  );
}
