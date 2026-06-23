"use client";
import { useEffect, useState, useMemo } from "react";

interface PriceEntry {
  sr: number;
  model: string;
  itemCode: string;
  effectiveDate: string;
  listPrice: number;
  baseDiscount: number;
  addDiscount: number;
  costPrice: number;
  note: string;
}

interface Props {
  products: any[];
}

export default function PriceHistory({ products }: Props) {
  const [history, setHistory] = useState<PriceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Add price revision form state
  const [showForm, setShowForm] = useState(false);
  const [model, setModel] = useState("");
  const [listPrice, setListPrice] = useState<number | "">("");
  const [baseDiscount, setBaseDiscount] = useState<number | "">(30);
  const [addDiscount, setAddDiscount] = useState<number | "">(0);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    fetch("/api/price-history")
      .then((r) => r.json())
      .then((d) => {
        if (d.history) setHistory(d.history);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search) return [...history].reverse();
    const q = search.toLowerCase();
    return [...history]
      .reverse()
      .filter(
        (h) =>
          h.model?.toLowerCase().includes(q) ||
          String(h.itemCode).includes(q)
      );
  }, [history, search]);

  const costPreview =
    listPrice && baseDiscount !== "" && addDiscount !== ""
      ? +listPrice * (1 - +baseDiscount / 100) * (1 - +addDiscount / 100)
      : null;

  const handleAddRevision = async () => {
    if (!model || !listPrice) {
      setError("Model and list price are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/price-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          listPrice: +listPrice,
          baseDiscount: +(baseDiscount || 0),
          addDiscount: +(addDiscount || 0),
          note,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed.");
        return;
      }
      setSuccess(
        `Price revision saved. New cost: ₹${data.costPrice?.toFixed(0)}`
      );
      // Refresh history
      const r2 = await fetch("/api/price-history");
      const d2 = await r2.json();
      if (d2.history) setHistory(d2.history);
      setModel("");
      setListPrice("");
      setNote("");
      setTimeout(() => {
        setSuccess("");
        setShowForm(false);
      }, 2000);
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  };

  const SectionLabel = ({ children }: any) => (
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

  const FG = ({ label, children }: any) => (
    <div>
      <label>{label}</label>
      {children}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <input
          placeholder="Search by model or item code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 260 }}
        />
        <button
          className="btn-primary"
          style={{ fontSize: 11 }}
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? "Cancel" : "+ Add price revision"}
        </button>
      </div>

      {/* Add revision form */}
      {showForm && (
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "12px 14px",
          }}
        >
          <SectionLabel>New price revision</SectionLabel>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
          >
            <FG label="Model">
              <select
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  const p = products.find((x) => x.model === e.target.value);
                  if (p) {
                    setListPrice(p.listPrice || "");
                    setBaseDiscount(
                      p.baseDiscount ? +(p.baseDiscount * 100).toFixed(1) : 30
                    );
                    setAddDiscount(
                      p.addDiscount ? +(p.addDiscount * 100).toFixed(1) : 0
                    );
                  }
                }}
              >
                <option value="">— select model —</option>
                {products.map((p) => (
                  <option key={p.model} value={p.model}>
                    {p.model}
                  </option>
                ))}
              </select>
            </FG>
            <FG label="New list price (₹)">
              <input
                type="number"
                value={listPrice}
                onChange={(e) => setListPrice(+e.target.value || "")}
                placeholder="e.g. 52000"
              />
            </FG>
            <FG label="General discount (%)">
              <input
                type="number"
                value={baseDiscount}
                onChange={(e) => setBaseDiscount(+e.target.value)}
              />
            </FG>
            <FG label="Additional discount (%)">
              <input
                type="number"
                value={addDiscount}
                onChange={(e) => setAddDiscount(+e.target.value)}
              />
            </FG>
            <div style={{ gridColumn: "1/-1" }}>
              <FG label="Note / reason">
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Fluke Q2 2026 price revision"
                />
              </FG>
            </div>
          </div>

          {costPreview !== null && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 12px",
                background: "var(--bg-input)",
                borderRadius: 8,
                fontSize: 11,
                color: "var(--text-dim)",
              }}
            >
              New cost price:{" "}
              <strong style={{ color: "var(--accent-green)" }}>
                ₹{costPreview.toFixed(0)}
              </strong>{" "}
              per unit
            </div>
          )}

          {error && (
            <div
              style={{ marginTop: 8, fontSize: 11, color: "var(--accent-red)" }}
            >
              {error}
            </div>
          )}
          {success && (
            <div
              style={{
                marginTop: 8,
                fontSize: 11,
                color: "var(--accent-green)",
              }}
            >
              {success}
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: 12,
            }}
          >
            <button
              className="btn-primary"
              onClick={handleAddRevision}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save revision → sheet"}
            </button>
          </div>
        </div>
      )}

      {/* History table */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "12px 14px",
        }}
      >
        <SectionLabel>
          Price revision history ({filtered.length} entries)
        </SectionLabel>
        {loading ? (
          <div
            style={{ color: "var(--text-muted)", fontSize: 12, padding: 12 }}
          >
            Loading…
          </div>
        ) : (
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
                  <th>Date</th>
                  <th>Model</th>
                  <th>Item Code</th>
                  <th>List Price</th>
                  <th>Gen. Disc</th>
                  <th>Add. Disc</th>
                  <th>Cost Price</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      style={{
                        textAlign: "center",
                        color: "var(--text-muted)",
                        padding: 20,
                      }}
                    >
                      No entries found
                    </td>
                  </tr>
                ) : (
                  filtered.map((h, i) => (
                    <tr key={i}>
                      <td style={{ color: "var(--text-muted)" }}>
                        {h.effectiveDate}
                      </td>
                      <td style={{ fontWeight: 500 }}>{h.model}</td>
                      <td style={{ color: "var(--text-muted)" }}>
                        {h.itemCode}
                      </td>
                      <td>₹{(h.listPrice || 0).toLocaleString("en-IN")}</td>
                      <td style={{ color: "var(--text-muted)" }}>
                        {((h.baseDiscount || 0) * 100).toFixed(0)}%
                      </td>
                      <td style={{ color: "var(--text-muted)" }}>
                        {((h.addDiscount || 0) * 100).toFixed(0)}%
                      </td>
                      <td style={{ color: "var(--accent-green)", fontWeight: 500 }}>
                        ₹{(h.costPrice || 0).toLocaleString("en-IN")}
                      </td>
                      <td style={{ color: "var(--text-muted)", fontSize: 11 }}>
                        {h.note}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}