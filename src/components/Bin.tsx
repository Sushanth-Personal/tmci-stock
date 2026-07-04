"use client";
// src/components/Bin.tsx
// Shows binned (soft-deleted) invoices with Restore / Delete forever actions.

import { useEffect, useState, useCallback } from "react";

interface BinnedInvoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  customer_snapshot: any;
  total: number;
  status: string;
  deleted_at: string;
  daysLeft: number;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const fmtMoney = (n: number) =>
  "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });

export default function Bin() {
  const [invoices, setInvoices] = useState<BinnedInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/invoices/bin");
      const d = await r.json();
      setInvoices(d.invoices ?? []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const handleRestore = async (id: string, num: string) => {
    setBusyId(id);
    try {
      const r = await fetch(`/api/invoices/${id}/bin`, { method: "PATCH" });
      const d = await r.json();
      if (!r.ok) {
        showToast(d.error || "Restore failed");
        setBusyId(null);
        return;
      }
      showToast(`✓ Restored ${num}`);
      setInvoices((prev) => prev.filter((i) => i.id !== id));
    } catch {
      showToast("Network error");
    }
    setBusyId(null);
  };

  const handlePermanentDelete = async (id: string, num: string) => {
    setBusyId(id);
    try {
      const r = await fetch(`/api/invoices/${id}/bin`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) {
        showToast(d.error || "Delete failed");
        setBusyId(null);
        return;
      }
      showToast(`Deleted ${num} permanently`);
      setInvoices((prev) => prev.filter((i) => i.id !== id));
      setConfirmDeleteId(null);
    } catch {
      showToast("Network error");
    }
    setBusyId(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
            color: "var(--text)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
            fontWeight: 500,
          }}
        >
          {toast}
        </div>
      )}

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
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              🗑 Bin ({invoices.length})
            </div>
            <div
              style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}
            >
              Deleted invoices are kept for 30 days, then permanently removed
              automatically.
            </div>
          </div>
          <button className="btn-ghost" style={{ fontSize: 11 }} onClick={load}>
            ↻
          </button>
        </div>

        {loading ? (
          <div
            style={{
              padding: 20,
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: 12,
            }}
          >
            Loading…
          </div>
        ) : invoices.length === 0 ? (
          <div
            style={{
              padding: 20,
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: 12,
            }}
          >
            Bin is empty.
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th>Deleted</th>
                  <th>Auto-purge in</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const customerName =
                    inv.customer_snapshot?.display_name ||
                    inv.customer_snapshot?.name ||
                    "—";
                  const urgent = inv.daysLeft <= 3;
                  return (
                    <tr key={inv.id}>
                      <td style={{ fontWeight: 500 }}>{inv.invoice_number}</td>
                      <td style={{ color: "var(--text-muted)" }}>
                        {customerName}
                      </td>
                      <td>{fmtDate(inv.invoice_date)}</td>
                      <td style={{ textAlign: "right", fontWeight: 500 }}>
                        {fmtMoney(inv.total)}
                      </td>
                      <td style={{ color: "var(--text-muted)" }}>
                        {fmtDate(inv.deleted_at)}
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: 10,
                            padding: "2px 8px",
                            borderRadius: 99,
                            background: urgent
                              ? "rgba(239,68,68,0.1)"
                              : "rgba(245,158,11,0.1)",
                            color: urgent
                              ? "var(--accent-red)"
                              : "var(--accent-amber)",
                            fontWeight: 600,
                          }}
                        >
                          {inv.daysLeft} day{inv.daysLeft !== 1 ? "s" : ""}
                        </span>
                      </td>
                      <td>
                        {confirmDeleteId === inv.id ? (
                          <div
                            style={{
                              display: "flex",
                              gap: 6,
                              alignItems: "center",
                            }}
                          >
                            <span
                              style={{
                                fontSize: 10,
                                color: "var(--accent-red)",
                              }}
                            >
                              Sure?
                            </span>
                            <button
                              className="btn-ghost"
                              style={{ fontSize: 10, padding: "2px 8px" }}
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              No
                            </button>
                            <button
                              className="btn-primary"
                              style={{
                                fontSize: 10,
                                padding: "2px 8px",
                                background: "var(--accent-red)",
                              }}
                              onClick={() =>
                                handlePermanentDelete(
                                  inv.id,
                                  inv.invoice_number,
                                )
                              }
                              disabled={busyId === inv.id}
                            >
                              Delete forever
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              className="btn-ghost"
                              style={{
                                fontSize: 10,
                                padding: "3px 9px",
                                color: "var(--accent-green)",
                              }}
                              onClick={() =>
                                handleRestore(inv.id, inv.invoice_number)
                              }
                              disabled={busyId === inv.id}
                            >
                              ↺ Restore
                            </button>
                            <button
                              className="btn-ghost"
                              style={{
                                fontSize: 10,
                                padding: "3px 9px",
                                color: "var(--accent-red)",
                                borderColor: "rgba(239,68,68,0.3)",
                              }}
                              onClick={() => setConfirmDeleteId(inv.id)}
                              disabled={busyId === inv.id}
                            >
                              Delete forever
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
