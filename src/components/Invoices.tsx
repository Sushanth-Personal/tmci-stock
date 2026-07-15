"use client";
import React from "react";
// src/components/Invoices.tsx
// Full invoices screen -- two tabs: Pending dispatch + All invoices
// Left: list panel with search + sort. Right: invoice detail panel.

import { useState, useEffect, useCallback, useMemo } from "react";
import InvoicePaper from "@/components/InvoicePaper";

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

interface CandidateLot {
  lot_id: string;
  date: string;
  vendor: string;
  po_invoice: string;
  remaining_qty: number;
}

interface UnmatchedSerial {
  model: string;
  location: string;
  serial: string;
  candidateLots: CandidateLot[];
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const fmtMoney = (n: number) =>
  "Rs. " +
  n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtShort = (n: number) => {
  if (n >= 100000) return `Rs.${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `Rs.${(n / 1000).toFixed(1)}K`;
  return `Rs.${Math.round(n).toLocaleString("en-IN")}`;
};

type StatusMeta = { label: string; color: string; bg: string };

const STATUS_META: Record<string, StatusMeta> = {
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

// ── Sort options ──────────────────────────────────────────────────────────────
type SortKey = "date" | "customer" | "total" | "invoiceNo";
type SortDir = "asc" | "desc";

const SORT_LABELS: Record<SortKey, string> = {
  date: "Date",
  customer: "Customer name",
  total: "Total value",
  invoiceNo: "Invoice number",
};

function getCustomerName(inv: Invoice): string {
  return (
    inv.customer_snapshot?.display_name || inv.customer_snapshot?.name || ""
  );
}

function matchesSearch(inv: Invoice, q: string): boolean {
  const needle = q.toLowerCase();
  if (inv.invoice_number.toLowerCase().includes(needle)) return true;
  if (getCustomerName(inv).toLowerCase().includes(needle)) return true;
  if (inv.customer_snapshot?.gstin?.toLowerCase().includes(needle)) return true;
  if (inv.notes?.toLowerCase().includes(needle)) return true;
  if (
    inv.line_items.some(
      (l) =>
        l.model?.toLowerCase().includes(needle) ||
        l.description?.toLowerCase().includes(needle) ||
        l.hsn?.toLowerCase().includes(needle),
    )
  )
    return true;
  if (
    inv.line_items.some((l) =>
      l.serialNumbers?.some((sn) => sn?.toLowerCase().includes(needle)),
    )
  )
    return true;
  return false;
}

// --- Invoice detail panel ---------------------------------------------------
function InvoiceDetail({
  invoice,
  onDispatched,
  onCancelled,
  onDeleted,
  onClose,
}: {
  invoice: Invoice;
  onDispatched: () => void;
  onCancelled: () => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [dispatchDate, setDispatchDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [dispatching, setDispatching] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [error, setError] = useState("");

  // ── Retroactive serial → purchase assignment wizard ───────────────────────
  const [unmatchedSerials, setUnmatchedSerials] = useState<
    UnmatchedSerial[] | null
  >(null);
  const [assignmentMessage, setAssignmentMessage] = useState("");
  const [serialChoices, setSerialChoices] = useState<Record<string, string>>(
    {},
  );
  const [assignStep, setAssignStep] = useState(0);

  const isPending = invoice.status === "pending_dispatch";
  const isDispatched = invoice.status === "dispatched";
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

  const handleDispatch = async (assignments?: Record<string, string>) => {
    setDispatching(true);
    setError("");
    try {
      const r = await fetch(`/api/invoices/${invoice.id}/dispatch`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dispatched_at: dispatchDate,
          serialLotAssignments: assignments ?? serialChoices,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.needsSerialAssignment) {
          setUnmatchedSerials(d.unmatchedSerials ?? []);
          setAssignmentMessage(
            d.message ||
              "Some serials don't match a recorded purchase — pick which purchase each came from below.",
          );
          setAssignStep(0);
          setDispatching(false);
          return;
        }
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

  const handleDelete = async () => {
    setDeleting(true);
    setError("");
    try {
      const r = await fetch(`/api/invoices/${invoice.id}/bin`, {
        method: "POST",
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error || "Failed to move to bin");
        setDeleting(false);
        return;
      }
      onDeleted();
    } catch {
      setError("Network error.");
      setDeleting(false);
    }
  };

  const handleUndoDispatch = async () => {
    setUndoing(true);
    setError("");
    try {
      const r = await fetch(`/api/invoices/${invoice.id}/undo-dispatch`, {
        method: "POST",
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error || "Undo failed");
        setUndoing(false);
        return;
      }
      if (d.warning) setError(`✓ Undone. ${d.warning}`);
      onDispatched();
    } catch {
      setError("Network error.");
    }
    setUndoing(false);
  };

  const allAssigned =
    !unmatchedSerials ||
    unmatchedSerials.every((u) => !!serialChoices[u.serial]);
  const wizardActive = !!(unmatchedSerials && unmatchedSerials.length > 0);

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
                ` - Dispatched ${fmtDate(invoice.dispatched_at)}`}
              {invoice.notes && ` - ${invoice.notes}`}
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
            x
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
        {/* Hide the normal invoice detail while the serial-assignment
            wizard is active — same pattern as PendingInvoices.tsx, keeps
            the wizard as the sole focus instead of a wall of text above it. */}
        {!wizardActive && (
          <>
            <div
              style={{
                background: "#ffffff",
                borderRadius: 8,
                padding: 20,
                display: "flex",
                justifyContent: "center",
                overflowX: "auto",
                overflowY: "auto",
                maxHeight: "calc(100vh - 220px)",
              }}
            >
              <InvoicePaper invoice={invoice} />
            </div>

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
                    onClick={() => handleDispatch()}
                    disabled={dispatching}
                  >
                    {dispatching ? "Dispatching..." : "Mark as dispatched"}
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
                  {invoice.line_items
                    .map((l) => `${l.qty}x ${l.model}`)
                    .join(", ")}{" "}
                  from {invoice.location} via FIFO and logs the sale.
                </div>
              </div>
            )}

            {isDispatched && !confirmUndo && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: "10px 12px",
                  background: "rgba(245,158,11,0.06)",
                  border: "1px solid rgba(245,158,11,0.25)",
                  borderRadius: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-dim)",
                    lineHeight: 1.6,
                  }}
                >
                  This invoice is dispatched — stock has been deducted via FIFO.
                  If it was marked dispatched by mistake, you can undo it: stock
                  is restored and the invoice returns to Pending Dispatch.
                </div>
                <button
                  className="btn-ghost"
                  style={{
                    fontSize: 11,
                    color: "var(--accent-amber)",
                    borderColor: "rgba(245,158,11,0.3)",
                    alignSelf: "flex-start",
                  }}
                  onClick={() => setConfirmUndo(true)}
                >
                  ↺ Undo dispatch (restore stock)
                </button>
              </div>
            )}

            {confirmUndo && (
              <div
                style={{
                  background: "rgba(245,158,11,0.07)",
                  border: "1px solid rgba(245,158,11,0.3)",
                  borderRadius: 8,
                  padding: "10px 14px",
                  fontSize: 12,
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    color: "var(--accent-amber)",
                    marginBottom: 8,
                  }}
                >
                  Undo this dispatch?
                </div>
                <div
                  style={{
                    color: "var(--text-muted)",
                    marginBottom: 10,
                    lineHeight: 1.6,
                  }}
                >
                  Stock will be added back to the most recent open lot for each
                  item (or a new lot if none exists — flagged for cost review).
                  The Sale transactions will be removed, and the invoice returns
                  to Pending Dispatch so you can fix it and dispatch again.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 11 }}
                    onClick={() => setConfirmUndo(false)}
                  >
                    Go back
                  </button>
                  <button
                    className="btn-primary"
                    style={{ fontSize: 11, background: "var(--accent-amber)" }}
                    onClick={handleUndoDispatch}
                    disabled={undoing}
                  >
                    {undoing ? "Undoing…" : "Yes, undo dispatch"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Match unrecorded serial to a purchase — one at a time ── */}
        {wizardActive &&
          (() => {
            const current = unmatchedSerials![assignStep];
            const total = unmatchedSerials!.length;
            const chosen = serialChoices[current.serial];
            const isLast = assignStep === total - 1;
            const totalAvailable = current.candidateLots.reduce(
              (s, l) => s + l.remaining_qty,
              0,
            );

            return (
              <div
                style={{
                  background: "rgba(59,130,246,0.06)",
                  border: "1px solid rgba(59,130,246,0.3)",
                  borderRadius: 8,
                  padding: "14px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 6,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: "var(--accent)",
                      }}
                    >
                      Match unrecorded serial to a purchase
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--text-muted)",
                      }}
                    >
                      {assignStep + 1} of {total}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 6,
                      borderRadius: 99,
                      background: "var(--bg-input)",
                      overflow: "hidden",
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${((assignStep + 1) / total) * 100}%`,
                        background: "var(--accent)",
                        borderRadius: 99,
                        transition: "width 0.2s ease",
                      }}
                    />
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      lineHeight: 1.6,
                    }}
                  >
                    This invoice can't be dispatched until every serial below is
                    matched to the purchase it actually came from.
                  </div>
                </div>

                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  {/* Left: the serial that needs matching */}
                  <div
                    style={{
                      width: 220,
                      flexShrink: 0,
                      background: "var(--bg-card)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "14px 12px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--text-muted)",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        marginBottom: 6,
                      }}
                    >
                      Serial number
                    </div>
                    <div
                      style={{
                        fontFamily: "monospace",
                        fontSize: 16,
                        fontWeight: 700,
                        color: "var(--accent-amber)",
                        lineHeight: 1.3,
                        wordBreak: "break-all",
                      }}
                    >
                      {current.serial}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text-dim)",
                        marginTop: 6,
                      }}
                    >
                      {current.model}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        marginTop: 10,
                        lineHeight: 1.6,
                      }}
                    >
                      Not found in stock records — but{" "}
                      <strong style={{ color: "var(--accent-green)" }}>
                        {totalAvailable} unit(s)
                      </strong>{" "}
                      of this model are available.
                    </div>
                  </div>

                  {/* Right: candidate purchases */}
                  <div
                    style={{
                      flex: 1,
                      minWidth: 260,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        marginBottom: 2,
                      }}
                    >
                      Which purchase did this unit come from?
                    </div>
                    {current.candidateLots.length === 0 ? (
                      <div style={{ fontSize: 12, color: "var(--accent-red)" }}>
                        No open purchase found for this model — record a
                        Purchase for it first.
                      </div>
                    ) : (
                      current.candidateLots.map((l) => {
                        const isChosen = chosen === l.lot_id;
                        return (
                          <div
                            key={l.lot_id}
                            onClick={() =>
                              setSerialChoices((prev) => ({
                                ...prev,
                                [current.serial]: l.lot_id,
                              }))
                            }
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                              padding: "10px 12px",
                              borderRadius: 6,
                              border: isChosen
                                ? "1.5px solid var(--accent)"
                                : "1px solid var(--border)",
                              background: isChosen
                                ? "rgba(59,130,246,0.1)"
                                : "var(--bg-input)",
                              cursor: "pointer",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                              }}
                            >
                              <span
                                style={{
                                  width: 16,
                                  height: 16,
                                  borderRadius: "50%",
                                  border: `1.5px solid ${isChosen ? "var(--accent)" : "var(--text-muted)"}`,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  flexShrink: 0,
                                }}
                              >
                                {isChosen && (
                                  <span
                                    style={{
                                      width: 8,
                                      height: 8,
                                      borderRadius: "50%",
                                      background: "var(--accent)",
                                    }}
                                  />
                                )}
                              </span>
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 500 }}>
                                  Purchased {fmtDate(l.date)} from{" "}
                                  {l.vendor || "unknown vendor"}
                                </div>
                                <div
                                  style={{
                                    fontSize: 10,
                                    color: "var(--text-muted)",
                                    marginTop: 1,
                                  }}
                                >
                                  Invoice/PO {l.po_invoice || "—"}
                                </div>
                              </div>
                            </div>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                color: "var(--accent-green)",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {l.remaining_qty} left
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 12 }}
                    onClick={() => setAssignStep((s) => Math.max(0, s - 1))}
                    disabled={assignStep === 0}
                  >
                    ← Back
                  </button>
                  {isLast ? (
                    <button
                      className="btn-primary"
                      style={{
                        fontSize: 12,
                        background: "var(--accent-green)",
                      }}
                      onClick={() => handleDispatch()}
                      disabled={dispatching || !chosen}
                    >
                      {dispatching
                        ? "Dispatching…"
                        : "✓ Confirm purchases → dispatch"}
                    </button>
                  ) : (
                    <button
                      className="btn-primary"
                      style={{ fontSize: 12 }}
                      onClick={() => setAssignStep((s) => s + 1)}
                      disabled={!chosen}
                    >
                      Next →
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

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

        {!wizardActive && isPending && !confirmCancel && !confirmDelete && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <button
              className="btn-ghost"
              style={{
                fontSize: 11,
                color: "var(--accent-amber)",
                borderColor: "rgba(245,158,11,0.3)",
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
                {cancelling ? "Cancelling..." : "Yes, cancel"}
              </button>
            </div>
          </div>
        )}

        {!wizardActive && !isDispatched && !confirmDelete && !confirmCancel && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <button
              className="btn-ghost"
              style={{
                fontSize: 11,
                color: "var(--accent-red)",
                borderColor: "rgba(239,68,68,0.3)",
              }}
              onClick={() => setConfirmDelete(true)}
            >
              Delete invoice
            </button>
          </div>
        )}
        {confirmDelete && (
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
              Move this invoice to Bin?
            </div>
            <div style={{ color: "var(--text-muted)", marginBottom: 10 }}>
              It'll be recoverable from the Bin (under Admin) for 30 days, then
              permanently deleted.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn-ghost"
                style={{ fontSize: 11 }}
                onClick={() => setConfirmDelete(false)}
              >
                Go back
              </button>
              <button
                className="btn-primary"
                style={{ fontSize: 11, background: "var(--accent-red)" }}
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Moving to bin..." : "Yes, move to bin"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Main Invoices screen ----------------------------------------------------
export default function Invoices({
  onStockChanged,
  initialTab = "pending",
}: {
  onStockChanged?: () => void;
  initialTab?: "pending" | "all" | "overdue";
}) {
  const [tab, setTab] = useState<"pending" | "all" | "overdue">(initialTab);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [toast, setToast] = useState("");

  // ── Search + sort state ────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

  const load = useCallback(async (status?: string) => {
    setLoading(true);
    try {
      const url = status
        ? `/api/invoices?status=${status}&limit=200`
        : "/api/invoices?limit=200";
      const r = await fetch(url);
      const d = await r.json();
      setInvoices(d.invoices ?? []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    // "overdue" needs every invoice (not just pending) so we can filter by
    // due date client-side — there's no dedicated status for it.
    load(tab === "pending" ? "pending_dispatch" : undefined);
  }, [tab, load]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  };

  const handleDispatched = () => {
    showToast("Stock updated.");
    setSelected(null);
    load(tab === "pending" ? "pending_dispatch" : undefined);
    onStockChanged?.();
  };

  const handleCancelled = () => {
    showToast("Invoice cancelled.");
    setSelected(null);
    load(tab === "pending" ? "pending_dispatch" : undefined);
  };

  const handleDeleted = () => {
    showToast("Moved to bin - recoverable for 30 days.");
    setSelected(null);
    load(tab === "pending" ? "pending_dispatch" : undefined);
  };

  // ── Filter + sort pipeline ─────────────────────────────────────────────────
  const displayedInvoices = useMemo(() => {
    let rows = invoices;

    if (tab === "overdue") {
      // "Overdue" here means the payment due date has passed. There's no
      // payment-received tracking in this app, so this can't tell paid
      // from unpaid — it just surfaces every non-cancelled invoice whose
      // due date is behind today, same as Zoho's own "OVERDUE BY N DAYS"
      // badge, which is purely due-date based too.
      const todayStr = new Date().toISOString().split("T")[0];
      rows = rows.filter(
        (inv) =>
          inv.status !== "cancelled" && inv.due_date && inv.due_date < todayStr,
      );
    }

    if (search.trim()) {
      rows = rows.filter((inv) => matchesSearch(inv, search.trim()));
    }

    const sorted = [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "date":
          cmp =
            new Date(a.invoice_date).getTime() -
            new Date(b.invoice_date).getTime();
          break;
        case "customer":
          cmp = getCustomerName(a).localeCompare(getCustomerName(b));
          break;
        case "total":
          cmp = a.total - b.total;
          break;
        case "invoiceNo":
          cmp = a.invoice_number.localeCompare(b.invoice_number);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [invoices, search, sortKey, sortDir]);

  const toggleSortDir = () => setSortDir((d) => (d === "asc" ? "desc" : "asc"));

  const listWidth = selected ? 320 : "100%";

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
        .inv-search-input { font-size: 12px !important; padding: 7px 10px !important; }
        .inv-sort-btn {
          display: flex; align-items: center; gap: 5px; font-size: 11px;
          padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border);
          background: var(--bg-input); color: var(--text-dim); cursor: pointer;
          white-space: nowrap; position: relative;
        }
        .inv-sort-btn:hover { border-color: var(--accent); }
        .inv-sort-menu {
          position: absolute; top: calc(100% + 4px); left: 0; z-index: 60;
          background: var(--bg-input); border: 1px solid var(--border);
          border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
          min-width: 160px; overflow: hidden;
        }
        .inv-sort-option {
          padding: 8px 12px; font-size: 12px; cursor: pointer;
          display: flex; align-items: center; justify-content: space-between;
        }
        .inv-sort-option:hover { background: rgba(59,130,246,0.1); }
        .inv-sort-option.active { color: var(--accent); font-weight: 500; }
      `}</style>

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

      {/* Left - Invoice list */}
      <div
        style={{
          width: listWidth,
          minWidth: selected ? 320 : undefined,
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
          <div
            className={`inv-tab${tab === "overdue" ? " on" : ""}`}
            onClick={() => {
              setTab("overdue");
              setSelected(null);
              load(); // overdue needs the full unfiltered set
            }}
          >
            Overdue
          </div>
          <div style={{ flex: 1 }} />
          <button
            className="btn-ghost"
            style={{ fontSize: 10, margin: "6px 4px" }}
            onClick={() =>
              load(tab === "pending" ? "pending_dispatch" : undefined)
            }
          >
            Refresh
          </button>
        </div>

        {/* Search + Sort bar */}
        <div
          style={{
            padding: "8px 10px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
            display: "flex",
            gap: 6,
          }}
        >
          <input
            className="inv-search-input"
            placeholder="Search customer, invoice #, product, HSN, serial…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1 }}
          />
          <div style={{ position: "relative" }}>
            <button
              className="inv-sort-btn"
              onClick={() => setSortMenuOpen((v) => !v)}
            >
              <span>↕ {SORT_LABELS[sortKey]}</span>
            </button>
            {sortMenuOpen && (
              <>
                <div
                  onClick={() => setSortMenuOpen(false)}
                  style={{ position: "fixed", inset: 0, zIndex: 50 }}
                />
                <div className="inv-sort-menu">
                  {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                    <div
                      key={key}
                      className={`inv-sort-option${sortKey === key ? " active" : ""}`}
                      onClick={() => {
                        setSortKey(key);
                        setSortMenuOpen(false);
                      }}
                    >
                      {SORT_LABELS[key]}
                      {sortKey === key && <span>✓</span>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            className="inv-sort-btn"
            onClick={toggleSortDir}
            title={sortDir === "asc" ? "Ascending" : "Descending"}
          >
            {sortDir === "asc" ? "↑" : "↓"}
          </button>
        </div>

        {/* Result count when filtered */}
        {search.trim() && (
          <div
            style={{
              padding: "6px 10px",
              fontSize: 10,
              color: "var(--text-muted)",
              borderBottom: "1px solid var(--border)",
              flexShrink: 0,
            }}
          >
            {displayedInvoices.length} of {invoices.length} match "{search}"
          </div>
        )}

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
              Loading...
            </div>
          ) : displayedInvoices.length === 0 ? (
            <div
              style={{
                padding: 24,
                fontSize: 12,
                color: "var(--text-muted)",
                textAlign: "center",
              }}
            >
              {search.trim()
                ? "No invoices match your search."
                : tab === "pending"
                  ? "No invoices pending dispatch."
                  : "No invoices found."}
            </div>
          ) : (
            displayedInvoices.map((inv) => {
              const sm =
                STATUS_META[inv.status] ?? STATUS_META.pending_dispatch;
              const customerName = getCustomerName(inv) || "-";
              const products = inv.line_items
                .map((l) => `${l.qty}x ${l.model}`)
                .join(", ");
              return (
                <div
                  key={inv.id}
                  className={`inv-item${selected?.id === inv.id ? " active" : ""}`}
                  onClick={() => setSelected(inv)}
                >
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
                      .
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

        <div
          style={{
            padding: "6px 12px",
            borderTop: "1px solid var(--border)",
            fontSize: 10,
            color: "var(--text-muted)",
            flexShrink: 0,
          }}
        >
          {displayedInvoices.length} invoice
          {displayedInvoices.length !== 1 ? "s" : ""}
          {displayedInvoices.length > 0 &&
            ` - ${fmtShort(displayedInvoices.reduce((s, i) => s + i.total, 0))} total`}
        </div>
      </div>

      {/* Right - Detail panel */}
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
            onDeleted={handleDeleted}
            onClose={() => setSelected(null)}
          />
        </div>
      )}

      {!selected && !loading && displayedInvoices.length > 0 && (
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
