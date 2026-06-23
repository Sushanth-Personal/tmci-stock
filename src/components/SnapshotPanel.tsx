// src/components/SnapshotPanel.tsx
// Add this to the Downloads page — shows recent snapshots and lets you
// trigger a manual one. Restore is view-only (shows the data) as a safety
// gate — actual sheet restoration requires a separate confirmed action.
"use client";
import { useEffect, useState } from "react";

interface SnapshotMeta {
  id: number;
  taken_at: string;
  label: string;
  row_counts: {
    products: number;
    stock: number;
    transactions: number;
    lots: number;
  };
}

export default function SnapshotPanel() {
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const load = async () => {
    try {
      const r = await fetch("/api/snapshot");
      const d = await r.json();
      if (d.snapshots) setSnapshots(d.snapshots);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const takeSnapshot = async () => {
    setSaving(true);
    setMsg("");
    try {
      const r = await fetch("/api/snapshot?label=manual", { method: "POST" });
      const d = await r.json();
      if (d.success) {
        setMsg(
          `✓ Snapshot saved — ${d.snapshot.row_counts.transactions} transactions, ${d.snapshot.row_counts.lots} lots`,
        );
        load();
      } else {
        setMsg(`✗ ${d.error}`);
      }
    } catch {
      setMsg("✗ Network error");
    }
    setSaving(false);
    setTimeout(() => setMsg(""), 4000);
  };

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const labelColor = (label: string) => {
    if (label === "manual") return "var(--accent)";
    if (label.includes("evening")) return "var(--accent-amber)";
    return "var(--text-muted)";
  };

  return (
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
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 500,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Supabase backups
          </div>
          <div
            style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}
          >
            Auto-saves at 7:30 AM, 1:30 PM, 7:30 PM IST · last 90 kept
          </div>
        </div>
        <button
          className="btn-primary"
          onClick={takeSnapshot}
          disabled={saving}
          style={{ fontSize: 11 }}
        >
          {saving ? "Saving…" : "↑ Save now"}
        </button>
      </div>

      {msg && (
        <div
          style={{
            marginBottom: 10,
            fontSize: 11,
            padding: "6px 10px",
            borderRadius: 6,
            background: "var(--bg-input)",
            color: msg.startsWith("✓")
              ? "var(--accent-green)"
              : "var(--accent-red)",
          }}
        >
          {msg}
        </div>
      )}

      {loading ? (
        <div
          style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 0" }}
        >
          Loading…
        </div>
      ) : snapshots.length === 0 ? (
        <div
          style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 0" }}
        >
          No snapshots yet. Hit "Save now" to create the first one.
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Saved at</th>
                <th>Type</th>
                <th style={{ textAlign: "right" }}>Products</th>
                <th style={{ textAlign: "right" }}>Stock rows</th>
                <th style={{ textAlign: "right" }}>Transactions</th>
                <th style={{ textAlign: "right" }}>Lots</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => (
                <tr key={s.id}>
                  <td style={{ color: "var(--text-muted)", fontSize: 11 }}>
                    {s.id}
                  </td>
                  <td>{fmtDate(s.taken_at)}</td>
                  <td>
                    <span
                      style={{
                        fontSize: 10,
                        padding: "2px 8px",
                        borderRadius: 99,
                        background: "var(--bg-input)",
                        color: labelColor(s.label),
                      }}
                    >
                      {s.label}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {s.row_counts?.products ?? "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {s.row_counts?.stock ?? "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {s.row_counts?.transactions ?? "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {s.row_counts?.lots ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
