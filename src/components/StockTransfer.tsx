"use client";
import { useState, useMemo } from "react";

interface Props {
  products: any[];
  onSuccess: () => void;
}

const FG = ({ label, children }: any) => (
  <div>
    <label>{label}</label>
    {children}
  </div>
);

const LocBox = ({ locLabel, name, stock }: any) => (
  <div
    style={{
      background: "var(--bg-input)",
      borderRadius: 8,
      padding: "10px 12px",
      textAlign: "center",
    }}
  >
    <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>
      {locLabel}
    </div>
    <div style={{ fontSize: 14, fontWeight: 600 }}>{name}</div>
    <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
      {stock} units available
    </div>
  </div>
);

export default function StockTransfer({ products, onSuccess }: Props) {
  const today = new Date().toISOString().split("T")[0];
  const [model, setModel] = useState("");
  const [from, setFrom] = useState("Kochi");
  const [qty, setQty] = useState(1);
  const [date, setDate] = useState(today);
  const [courier, setCourier] = useState<number | "">(0);
  const [remarks, setRemarks] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const to = from === "Kochi" ? "Bangalore" : "Kochi";
  const product = useMemo(
    () => products.find((p) => p.model === model),
    [products, model],
  );
  const fromStock = product
    ? from === "Kochi"
      ? product.stockKochi
      : product.stockBlore
    : 0;
  const toStock = product
    ? from === "Kochi"
      ? product.stockBlore
      : product.stockKochi
    : 0;
  const valid = fromStock >= qty && qty > 0;

  const handleSubmit = async () => {
    if (!model || qty < 1) {
      setError("Select model and qty.");
      return;
    }
    if (!valid) {
      setError(`Insufficient stock in ${from}.`);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          fromLocation: from,
          toLocation: to,
          qty,
          courierCharges: +(courier || 0),
          remarks,
          date,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed.");
        return;
      }
      setSuccess(
        `Transfer done! ${from}: ${data.newFromStock}, ${to}: ${data.newToStock}`,
      );
      setTimeout(() => {
        setSuccess("");
        onSuccess();
      }, 1500);
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
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
          fontSize: 10,
          fontWeight: 500,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 10,
        }}
      >
        Transfer stock between locations
      </div>

      <div style={{ marginBottom: 10 }}>
        <label>Model</label>
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">— select model —</option>
          {products.map((p) => (
            <option key={p.model} value={p.model}>
              {p.model} · Kochi: {p.stockKochi ?? 0}, Blore: {p.stockBlore ?? 0}
            </option>
          ))}
        </select>
      </div>

      {/* Direction toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <button
          className={from === "Kochi" ? "btn-primary" : "btn-ghost"}
          onClick={() => setFrom("Kochi")}
          style={{ fontSize: 11 }}
        >
          Kochi → Bangalore
        </button>
        <button
          className={from === "Bangalore" ? "btn-primary" : "btn-ghost"}
          onClick={() => setFrom("Bangalore")}
          style={{ fontSize: 11 }}
        >
          Bangalore → Kochi
        </button>
      </div>

      {/* Visual boxes */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          gap: 10,
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <LocBox locLabel="From" name={from} stock={fromStock} />
        <div
          style={{ textAlign: "center", color: "var(--accent)", fontSize: 22 }}
        >
          →
        </div>
        <LocBox locLabel="To" name={to} stock={toStock} />
      </div>

      <div className="form-grid">
        <FG label="Qty to transfer">
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(+e.target.value)}
          />
        </FG>
        <FG label="Date">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </FG>
        <FG label="Courier charges (₹)">
          <input
            type="number"
            value={courier}
            onChange={(e) => setCourier(+e.target.value)}
            placeholder="e.g. 500"
          />
        </FG>
        <FG label="Remarks">
          <input
            type="text"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="optional note"
          />
        </FG>
      </div>

      {product && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 10px",
            borderRadius: 8,
            border: `1px solid ${valid ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
            background: valid ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
            color: valid ? "var(--accent-green)" : "var(--accent-red)",
            fontSize: 11,
            fontWeight: 500,
          }}
        >
          {valid
            ? `✓ After transfer: ${from}: ${fromStock - qty} units, ${to}: ${toStock + qty} units`
            : `✗ Only ${fromStock} units available in ${from}`}
        </div>
      )}

      {error && (
        <div style={{ marginTop: 8, fontSize: 11, color: "var(--accent-red)" }}>
          {error}
        </div>
      )}
      {success && (
        <div
          style={{ marginTop: 8, fontSize: 11, color: "var(--accent-green)" }}
        >
          {success}
        </div>
      )}

      <div className="action-row">
        <button
          className="btn-ghost"
          onClick={() => {
            setModel("");
            setQty(1);
            setRemarks("");
            setError("");
          }}
        >
          Clear
        </button>
        <button
          className="btn-primary"
          onClick={handleSubmit}
          disabled={loading || !valid}
        >
          {loading ? "Saving…" : "Confirm transfer → sheet"}
        </button>
      </div>
    </div>
  );
}
