// src/components/SnapshotPanel.tsx
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
interface SnapshotDetail extends SnapshotMeta {
  products: Record<string, unknown>[];
  stock: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
  lots: Record<string, unknown>[];
}
interface DiffRow {
  key: string;
  label: string;
  status: "added" | "deleted" | "changed" | "unchanged";
  snapshotRow: Record<string, unknown> | null;
  liveRow: Record<string, unknown> | null;
  changedFields?: Array<{ field: string; snapshot: unknown; live: unknown }>;
}
interface TableDiff {
  table: string;
  added: number;
  deleted: number;
  changed: number;
  unchanged: number;
  rows: DiffRow[];
  liveAhead: boolean;
}
interface DiffResult {
  snapshotId: number;
  takenAt: string;
  label: string;
  anyLiveAhead: boolean;
  summary: { totalDeleted: number; totalAdded: number; totalChanged: number };
  diffs: TableDiff[];
}

function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  return [headers, ...rows.map((r) => headers.map((h) => escape(r[h])))]
    .map((row) => row.join(","))
    .join("\n");
}
function downloadCSV(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function labelColor(label: string) {
  if (label === "manual") return "var(--accent)";
  if (label.includes("evening") || label.includes("pm"))
    return "var(--accent-amber)";
  return "var(--text-muted)";
}
const TABLE_LABELS: Record<string, string> = {
  products: "Products",
  stock: "Stock",
  transactions: "Transactions",
  lots: "FIFO Lots",
};
const STATUS_COLOR: Record<string, string> = {
  added: "var(--accent-green)",
  deleted: "var(--accent-red)",
  changed: "var(--accent-amber)",
  unchanged: "var(--text-muted)",
};
const STATUS_BG: Record<string, string> = {
  added: "rgba(34,197,94,0.07)",
  deleted: "rgba(239,68,68,0.07)",
  changed: "rgba(245,158,11,0.07)",
  unchanged: "transparent",
};
const STATUS_LABEL: Record<string, string> = {
  added: "+ will be added",
  deleted: "− will be deleted",
  changed: "~ will change",
};

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
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
const Pill = ({
  color,
  bg,
  children,
}: {
  color: string;
  bg: string;
  children: React.ReactNode;
}) => (
  <span
    style={{
      fontSize: 10,
      padding: "2px 8px",
      borderRadius: 99,
      background: bg,
      color,
      fontWeight: 500,
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </span>
);

function DiffModal({
  snap,
  onClose,
  onProceedRestore,
}: {
  snap: SnapshotMeta;
  onClose: () => void;
  onProceedRestore: (d: DiffResult) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [error, setError] = useState("");
  const [activeTable, setActiveTable] = useState("transactions");
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/snapshot/diff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: snap.id }),
        });
        const d = await res.json();
        if (!res.ok) {
          setError(d.error || "Diff failed");
          return;
        }
        setDiff(d);
        const mostChanged = d.diffs.reduce(
          (best: TableDiff, t: TableDiff) =>
            t.deleted + t.changed + t.added >
            best.deleted + best.changed + best.added
              ? t
              : best,
          d.diffs[0],
        );
        if (mostChanged) setActiveTable(mostChanged.table);
      } catch {
        setError("Network error loading diff.");
      }
      setLoading(false);
    })();
  }, [snap.id]);

  const currentDiff = diff?.diffs.find((d) => d.table === activeTable);
  const displayRows =
    currentDiff?.rows.filter(
      (r) => showUnchanged || r.status !== "unchanged",
    ) ?? [];

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
          maxWidth: 900,
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              Snapshot #{snap.id} vs live sheet
            </div>
            <div
              style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}
            >
              Taken {fmtDate(snap.taken_at)} · {snap.label}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              padding: "2px 6px",
            }}
          >
            ×
          </button>
        </div>

        {loading && (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-muted)",
              fontSize: 12,
            }}
          >
            Comparing snapshot against live sheet…
          </div>
        )}
        {error && (
          <div style={{ color: "var(--accent-red)", fontSize: 12 }}>
            {error}
          </div>
        )}

        {diff && !loading && (
          <>
            {/* Summary */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3,1fr)",
                gap: 8,
                flexShrink: 0,
              }}
            >
              {[
                {
                  n: diff.summary.totalDeleted,
                  label:
                    diff.summary.totalDeleted > 0
                      ? "⚠ Live rows that would be LOST"
                      : "Rows that would be deleted",
                  sub:
                    diff.summary.totalDeleted > 0
                      ? "Live is AHEAD of snapshot"
                      : "No live-only rows",
                  color:
                    diff.summary.totalDeleted > 0
                      ? "var(--accent-red)"
                      : "var(--text-muted)",
                  bg:
                    diff.summary.totalDeleted > 0
                      ? "rgba(239,68,68,0.1)"
                      : "var(--bg-input)",
                  border:
                    diff.summary.totalDeleted > 0
                      ? "rgba(239,68,68,0.35)"
                      : "var(--border)",
                },
                {
                  n: diff.summary.totalAdded,
                  label: "Rows that would be restored",
                  sub: "In snapshot, missing from live",
                  color: "var(--accent-green)",
                  bg: "rgba(34,197,94,0.07)",
                  border: "rgba(34,197,94,0.2)",
                },
                {
                  n: diff.summary.totalChanged,
                  label: "Rows with changed values",
                  sub: "Field-level differences",
                  color: "var(--accent-amber)",
                  bg: "rgba(245,158,11,0.07)",
                  border: "rgba(245,158,11,0.2)",
                },
              ].map((m, i) => (
                <div
                  key={i}
                  style={{
                    background: m.bg,
                    border: `1px solid ${m.border}`,
                    borderRadius: 8,
                    padding: "10px 14px",
                  }}
                >
                  <div
                    style={{ fontSize: 10, color: m.color, marginBottom: 4 }}
                  >
                    {m.label}
                  </div>
                  <div
                    style={{ fontSize: 22, fontWeight: 700, color: m.color }}
                  >
                    {m.n}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--text-muted)",
                      marginTop: 2,
                    }}
                  >
                    {m.sub}
                  </div>
                </div>
              ))}
            </div>

            {diff.anyLiveAhead && (
              <div
                style={{
                  background: "rgba(239,68,68,0.09)",
                  border: "1px solid rgba(239,68,68,0.4)",
                  borderRadius: 8,
                  padding: "10px 14px",
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--accent-red)",
                    marginBottom: 4,
                  }}
                >
                  ⚠ Your live sheet is ahead of this snapshot
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text)",
                    lineHeight: 1.6,
                  }}
                >
                  The live sheet has{" "}
                  <strong>{diff.summary.totalDeleted} rows</strong> that don't
                  exist in this snapshot. A full restore would permanently
                  delete them. Review the red rows below before restoring.
                </div>
              </div>
            )}

            {diff.summary.totalDeleted === 0 &&
              diff.summary.totalAdded === 0 &&
              diff.summary.totalChanged === 0 && (
                <div
                  style={{
                    background: "rgba(34,197,94,0.07)",
                    border: "1px solid rgba(34,197,94,0.25)",
                    borderRadius: 8,
                    padding: "12px 14px",
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--accent-green)",
                    }}
                  >
                    ✓ Snapshot matches live sheet exactly — nothing to restore.
                  </div>
                </div>
              )}

            {/* Table tabs */}
            <div
              style={{
                display: "flex",
                gap: 0,
                borderBottom: "1px solid var(--border)",
                flexShrink: 0,
                overflowX: "auto",
              }}
            >
              {diff.diffs.map((td) => {
                const total = td.deleted + td.changed + td.added;
                const isActive = activeTable === td.table;
                return (
                  <div
                    key={td.table}
                    onClick={() => setActiveTable(td.table)}
                    style={{
                      padding: "7px 14px",
                      fontSize: 11,
                      cursor: "pointer",
                      color: isActive ? "var(--text)" : "var(--text-muted)",
                      borderBottom: isActive
                        ? "2px solid var(--accent)"
                        : "2px solid transparent",
                      fontWeight: isActive ? 500 : 400,
                      marginBottom: -1,
                      whiteSpace: "nowrap",
                      display: "flex",
                      gap: 6,
                      alignItems: "center",
                    }}
                  >
                    {TABLE_LABELS[td.table]}
                    <span
                      style={{
                        fontSize: 9,
                        padding: "1px 5px",
                        borderRadius: 99,
                        background:
                          total > 0
                            ? td.deleted > 0
                              ? "rgba(239,68,68,0.15)"
                              : "rgba(59,130,246,0.15)"
                            : "var(--bg-input)",
                        color:
                          total > 0
                            ? td.deleted > 0
                              ? "var(--accent-red)"
                              : "var(--accent)"
                            : "var(--text-muted)",
                      }}
                    >
                      {total > 0
                        ? `${total} change${total !== 1 ? "s" : ""}`
                        : "no changes"}
                    </span>
                  </div>
                );
              })}
              <div style={{ flex: 1 }} />
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  margin: "0 8px 4px",
                  fontSize: 10,
                  color: "var(--text-muted)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={showUnchanged}
                  onChange={(e) => setShowUnchanged(e.target.checked)}
                  style={{ width: "auto" }}
                />
                Show unchanged
              </label>
            </div>

            {/* Diff rows */}
            {currentDiff && (
              <div
                style={{
                  flex: 1,
                  overflow: "auto",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                }}
              >
                {displayRows.length === 0 ? (
                  <div
                    style={{
                      padding: 24,
                      textAlign: "center",
                      color: "var(--text-muted)",
                      fontSize: 12,
                    }}
                  >
                    {currentDiff.unchanged > 0
                      ? `All ${currentDiff.unchanged} rows are identical. Toggle "Show unchanged" to see them.`
                      : "No rows in this table."}
                  </div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 130 }}>Status</th>
                        <th>Row</th>
                        <th style={{ width: 90 }}>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayRows.map((row) => (
                        <>
                          <tr
                            key={row.key}
                            style={{
                              background: STATUS_BG[row.status],
                              cursor:
                                row.status === "changed"
                                  ? "pointer"
                                  : "default",
                            }}
                            onClick={() => {
                              if (row.status === "changed")
                                setExpandedRow(
                                  expandedRow === row.key ? null : row.key,
                                );
                            }}
                          >
                            <td>
                              <Pill
                                color={STATUS_COLOR[row.status]}
                                bg={STATUS_BG[row.status]}
                              >
                                {STATUS_LABEL[row.status] ?? row.status}
                              </Pill>
                            </td>
                            <td
                              style={{
                                fontSize: 11,
                                color: "var(--text-dim)",
                                fontFamily: "monospace",
                              }}
                            >
                              {row.label}
                            </td>
                            <td
                              style={{
                                fontSize: 10,
                                color: "var(--text-muted)",
                              }}
                            >
                              {row.status === "changed" && (
                                <span
                                  style={{
                                    color: "var(--accent)",
                                    cursor: "pointer",
                                  }}
                                >
                                  {row.changedFields?.length} field
                                  {row.changedFields?.length !== 1 ? "s" : ""}{" "}
                                  {expandedRow === row.key ? "▲" : "▼"}
                                </span>
                              )}
                            </td>
                          </tr>
                          {row.status === "changed" &&
                            expandedRow === row.key &&
                            row.changedFields?.map((cf) => (
                              <tr
                                key={cf.field}
                                style={{ background: "rgba(245,158,11,0.04)" }}
                              >
                                <td
                                  style={{
                                    paddingLeft: 20,
                                    fontSize: 10,
                                    color: "var(--text-muted)",
                                    fontStyle: "italic",
                                  }}
                                >
                                  {cf.field}
                                </td>
                                <td colSpan={2}>
                                  <div
                                    style={{
                                      display: "flex",
                                      gap: 6,
                                      alignItems: "center",
                                      flexWrap: "wrap",
                                      fontSize: 11,
                                    }}
                                  >
                                    <span
                                      style={{
                                        color: "var(--accent-green)",
                                        background: "rgba(34,197,94,0.08)",
                                        padding: "1px 6px",
                                        borderRadius: 4,
                                        fontFamily: "monospace",
                                      }}
                                    >
                                      snapshot: {String(cf.snapshot ?? "—")}
                                    </span>
                                    <span
                                      style={{ color: "var(--text-muted)" }}
                                    >
                                      →
                                    </span>
                                    <span
                                      style={{
                                        color: "var(--accent-red)",
                                        background: "rgba(239,68,68,0.08)",
                                        padding: "1px 6px",
                                        borderRadius: 4,
                                        fontFamily: "monospace",
                                      }}
                                    >
                                      live: {String(cf.live ?? "—")}
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            ))}
                        </>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
                flexShrink: 0,
                flexWrap: "wrap",
              }}
            >
              <button className="btn-ghost" onClick={onClose}>
                Cancel
              </button>
              {(diff.summary.totalAdded > 0 ||
                diff.summary.totalChanged > 0 ||
                diff.summary.totalDeleted > 0) && (
                <button
                  className="btn-primary"
                  style={{
                    background: diff.anyLiveAhead
                      ? "var(--accent-red)"
                      : "var(--accent)",
                  }}
                  onClick={() => onProceedRestore(diff)}
                >
                  {diff.anyLiveAhead
                    ? "⚠ Proceed anyway (live data will be lost)"
                    : "Restore missing / changed rows →"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RestoreConfirmModal({
  snap,
  diff,
  onClose,
  onRestored,
}: {
  snap: SnapshotMeta;
  diff: DiffResult;
  onClose: () => void;
  onRestored: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const isReady = confirm === "RESTORE";

  const runRestore = async () => {
    setRestoring(true);
    setError("");
    try {
      const res = await fetch("/api/snapshot/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: snap.id,
          tables: ["products", "stock", "transactions", "lots"],
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || "Restore failed");
        setRestoring(false);
        return;
      }
      setResult(d.restoredRows);
      onRestored();
    } catch {
      setError("Network error.");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.82)",
        zIndex: 110,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid rgba(239,68,68,0.4)",
          borderRadius: 12,
          padding: "22px 24px",
          width: "100%",
          maxWidth: 480,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {result ? (
          <>
            <div
              style={{
                fontWeight: 600,
                fontSize: 14,
                color: "var(--accent-green)",
              }}
            >
              ✓ Restore complete
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {Object.entries(result).map(([table, count]) => (
                <div
                  key={table}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 12,
                  }}
                >
                  <span style={{ color: "var(--text-dim)" }}>
                    {TABLE_LABELS[table]}
                  </span>
                  <span
                    style={{ color: "var(--accent-green)", fontWeight: 500 }}
                  >
                    {count} rows written
                  </span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Hit ↻ Refresh in the top bar to reload data.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: 13,
                  color: "var(--accent-red)",
                  marginBottom: 6,
                }}
              >
                Final confirmation — this cannot be undone
              </div>
              <div
                style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.7 }}
              >
                Overwriting live sheet with snapshot <strong>#{snap.id}</strong>{" "}
                from <strong>{fmtDate(snap.taken_at)}</strong>.
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {diff.summary.totalDeleted > 0 && (
                <div
                  style={{
                    background: "rgba(239,68,68,0.09)",
                    border: "1px solid rgba(239,68,68,0.3)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontSize: 11,
                    color: "var(--accent-red)",
                  }}
                >
                  ✗ {diff.summary.totalDeleted} live rows will be permanently
                  deleted
                </div>
              )}
              {diff.summary.totalAdded > 0 && (
                <div
                  style={{
                    background: "rgba(34,197,94,0.07)",
                    border: "1px solid rgba(34,197,94,0.25)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontSize: 11,
                    color: "var(--accent-green)",
                  }}
                >
                  + {diff.summary.totalAdded} snapshot rows will be restored
                </div>
              )}
              {diff.summary.totalChanged > 0 && (
                <div
                  style={{
                    background: "rgba(245,158,11,0.07)",
                    border: "1px solid rgba(245,158,11,0.25)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontSize: 11,
                    color: "var(--accent-amber)",
                  }}
                >
                  ~ {diff.summary.totalChanged} rows will be overwritten with
                  snapshot values
                </div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Type <strong style={{ color: "var(--text)" }}>RESTORE</strong>{" "}
                to confirm
              </label>
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="RESTORE"
                style={{
                  borderColor: isReady
                    ? "var(--accent-green)"
                    : "var(--border)",
                }}
                autoFocus
              />
            </div>
            {error && (
              <div style={{ fontSize: 11, color: "var(--accent-red)" }}>
                {error}
              </div>
            )}
            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <button className="btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn-primary"
                style={{
                  background: isReady ? "var(--accent-red)" : "var(--bg-input)",
                  color: isReady ? "white" : "var(--text-muted)",
                  cursor: isReady ? "pointer" : "not-allowed",
                  border: isReady ? "none" : "1px solid var(--border)",
                }}
                onClick={runRestore}
                disabled={!isReady || restoring}
              >
                {restoring ? "Restoring…" : "Restore now"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ViewModal({
  snap,
  onClose,
}: {
  snap: SnapshotDetail;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<
    "products" | "stock" | "transactions" | "lots"
  >("transactions");
  const dateSlug = snap.taken_at
    .slice(0, 16)
    .replace("T", "_")
    .replace(":", "h");
  const currentData = snap[tab] ?? [];
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
          maxWidth: 860,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              Snapshot #{snap.id}
            </div>
            <div
              style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}
            >
              {fmtDate(snap.taken_at)} · {snap.label}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              flexShrink: 0,
            }}
          >
            <button
              className="btn-ghost"
              style={{ fontSize: 11 }}
              onClick={() =>
                (
                  ["products", "stock", "transactions", "lots"] as const
                ).forEach(
                  (t) =>
                    (snap[t] ?? []).length > 0 &&
                    downloadCSV(
                      `snapshot_${snap.id}_${dateSlug}_${t}.csv`,
                      toCSV(snap[t]),
                    ),
                )
              }
            >
              ⬇ All CSVs
            </button>
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 20,
                lineHeight: 1,
                padding: "2px 6px",
              }}
            >
              ×
            </button>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 0,
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          {(["products", "stock", "transactions", "lots"] as const).map((t) => (
            <div
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "7px 14px",
                fontSize: 11,
                cursor: "pointer",
                color: tab === t ? "var(--text)" : "var(--text-muted)",
                borderBottom:
                  tab === t
                    ? "2px solid var(--accent)"
                    : "2px solid transparent",
                fontWeight: tab === t ? 500 : 400,
                marginBottom: -1,
                whiteSpace: "nowrap",
                display: "flex",
                gap: 6,
                alignItems: "center",
              }}
            >
              {TABLE_LABELS[t]}
              <span
                style={{
                  fontSize: 9,
                  padding: "1px 5px",
                  borderRadius: 99,
                  background:
                    tab === t ? "rgba(59,130,246,0.15)" : "var(--bg-input)",
                  color: tab === t ? "var(--accent)" : "var(--text-muted)",
                }}
              >
                {snap.row_counts?.[t as keyof typeof snap.row_counts] ??
                  snap[t]?.length ??
                  0}
              </span>
            </div>
          ))}
          <div style={{ flex: 1 }} />
          <button
            className="btn-ghost"
            style={{ fontSize: 10, padding: "4px 10px", margin: "0 0 4px" }}
            onClick={() =>
              downloadCSV(
                `snapshot_${snap.id}_${dateSlug}_${tab}.csv`,
                toCSV(currentData),
              )
            }
          >
            ⬇ {TABLE_LABELS[tab]} CSV
          </button>
        </div>
        <div
          style={{
            flex: 1,
            overflow: "auto",
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}
        >
          {currentData.length === 0 ? (
            <div
              style={{
                padding: 24,
                textAlign: "center",
                color: "var(--text-muted)",
                fontSize: 12,
              }}
            >
              No data in this table.
            </div>
          ) : (
            <table style={{ minWidth: 600 }}>
              <thead>
                <tr>
                  {Object.keys(currentData[0]).map((col) => (
                    <th key={col}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentData.slice(0, 200).map((row, i) => (
                  <tr key={i}>
                    {Object.values(row).map((cell, j) => (
                      <td
                        key={j}
                        style={{
                          maxWidth: 180,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {String(cell ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
                {currentData.length > 200 && (
                  <tr>
                    <td
                      colSpan={Object.keys(currentData[0]).length}
                      style={{
                        textAlign: "center",
                        color: "var(--text-muted)",
                        fontSize: 11,
                        padding: 10,
                      }}
                    >
                      Showing 200 of {currentData.length} rows. Download CSV for
                      all.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SnapshotPanel() {
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [viewSnap, setViewSnap] = useState<SnapshotDetail | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [diffSnap, setDiffSnap] = useState<SnapshotMeta | null>(null);
  const [restoreState, setRestoreState] = useState<{
    snap: SnapshotMeta;
    diff: DiffResult;
  } | null>(null);

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
          `✓ Snapshot #${d.snapshot.id} saved — ${d.snapshot.row_counts.transactions} transactions, ${d.snapshot.row_counts.lots} lots`,
        );
        load();
      } else setMsg(`✗ ${d.error}`);
    } catch {
      setMsg("✗ Network error");
    }
    setSaving(false);
    setTimeout(() => setMsg(""), 5000);
  };

  const openView = async (snap: SnapshotMeta) => {
    setViewLoading(true);
    try {
      const r = await fetch(`/api/snapshot?restore=${snap.id}`, {
        method: "POST",
      });
      const d = await r.json();
      if (d.snapshot) setViewSnap({ ...snap, ...d.snapshot });
      else {
        setMsg("✗ Could not load snapshot");
        setTimeout(() => setMsg(""), 3000);
      }
    } catch {
      setMsg("✗ Network error");
      setTimeout(() => setMsg(""), 3000);
    }
    setViewLoading(false);
  };

  return (
    <>
      {viewSnap && (
        <ViewModal snap={viewSnap} onClose={() => setViewSnap(null)} />
      )}
      {diffSnap && (
        <DiffModal
          snap={diffSnap}
          onClose={() => setDiffSnap(null)}
          onProceedRestore={(diff) => {
            setRestoreState({ snap: diffSnap, diff });
            setDiffSnap(null);
          }}
        />
      )}
      {restoreState && (
        <RestoreConfirmModal
          snap={restoreState.snap}
          diff={restoreState.diff}
          onClose={() => setRestoreState(null)}
          onRestored={() => {
            setMsg("✓ Restore complete — hit ↻ Refresh to reload.");
            setTimeout(() => setMsg(""), 6000);
          }}
        />
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
        {viewLoading && (
          <div
            style={{
              marginBottom: 10,
              fontSize: 11,
              color: "var(--text-muted)",
            }}
          >
            Loading snapshot data…
          </div>
        )}

        {loading ? (
          <div
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              padding: "8px 0",
            }}
          >
            Loading…
          </div>
        ) : snapshots.length === 0 ? (
          <div
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              padding: "8px 0",
            }}
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
                  <th style={{ textAlign: "right" }}>Stock</th>
                  <th style={{ textAlign: "right" }}>Transactions</th>
                  <th style={{ textAlign: "right" }}>Lots</th>
                  <th>Actions</th>
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
                    <td>
                      <div style={{ display: "flex", gap: 5 }}>
                        <button
                          className="btn-ghost"
                          style={{ fontSize: 10, padding: "3px 9px" }}
                          onClick={() => openView(s)}
                          disabled={viewLoading}
                        >
                          View
                        </button>
                        <button
                          className="btn-ghost"
                          style={{
                            fontSize: 10,
                            padding: "3px 9px",
                            color: "var(--accent-amber)",
                            borderColor: "rgba(245,158,11,0.3)",
                          }}
                          onClick={() => setDiffSnap(s)}
                        >
                          Compare & Restore
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
