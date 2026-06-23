"use client";
import { useState, useMemo } from "react";

interface Props {
  products: any[];
  onSuccess: () => void;
}

// Defined at module scope to avoid remount-on-every-render bug
const FG = ({ label, children, full }: any) => (
  <div className={full ? "form-grid-full" : ""}>
    <label>{label}</label>
    {children}
  </div>
);

export default function RecordSale({ products, onSuccess }: Props) {
  const today = new Date().toISOString().split("T")[0];
  const [model, setModel] = useState("");
  const [date, setDate] = useState(today);
  const [location, setLocation] = useState("Kochi");
  const [qty, setQty] = useState(1);
  const [salePrice, setSalePrice] = useState<number | "">("");
  const [customer, setCustomer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const product = useMemo(
    () => products.find((p) => p.model === model),
    [products, model],
  );
  const currentStock = product
    ? location === "Kochi"
      ? product.stockKochi
      : product.stockBlore
    : 0;
  const afterSale = currentStock - qty;
  const margin =
    product && salePrice
      ? (((+salePrice - product.costPrice) / +salePrice) * 100).toFixed(1)
      : null;
  const stockOk = afterSale >= 0;

  const handleSubmit = async () => {
    if (!model || !salePrice || qty < 1) {
      setError("Fill all required fields.");
      return;
    }
    if (!stockOk) {
      setError(`Insufficient stock. Available: ${currentStock}`);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          model,
          itemCode: product?.itemCode,
          location,
          qtySold: qty,
          unitSalePrice: +salePrice,
          customer,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to record sale.");
        return;
      }
      setSuccess(`Sale recorded! Margin: ${data.margin?.toFixed(1)}%`);
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
        Sale details
      </div>
      <div className="form-grid">
        <FG label="Model" full>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">— select model —</option>
            {products.map((p) => (
              <option key={p.model} value={p.model}>
                {p.model} · Kochi: {p.stockKochi ?? 0}, Blore:{" "}
                {p.stockBlore ?? 0}
              </option>
            ))}
          </select>
        </FG>
        <FG label="Date">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </FG>
        <FG label="Selling location">
          <select
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          >
            <option>Kochi</option>
            <option>Bangalore</option>
          </select>
        </FG>
        <FG label="Qty sold">
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(+e.target.value)}
          />
        </FG>
        <FG label="Sale price per unit (₹)">
          <input
            type="number"
            value={salePrice}
            onChange={(e) => setSalePrice(+e.target.value || "")}
            placeholder="e.g. 8100"
          />
        </FG>
        <FG label="Customer / Invoice ref">
          <input
            type="text"
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            placeholder="Customer name or invoice number"
          />
        </FG>
      </div>

      {product && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 10px",
            borderRadius: 8,
            border: `1px solid ${stockOk ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
            background: stockOk
              ? "rgba(34,197,94,0.08)"
              : "rgba(239,68,68,0.08)",
            color: stockOk ? "var(--accent-green)" : "var(--accent-red)",
            fontSize: 11,
          }}
        >
          <div style={{ fontWeight: 500 }}>
            {stockOk
              ? `✓ Stock OK — ${currentStock} units in ${location}`
              : `✗ Insufficient stock — only ${currentStock} available`}
          </div>
          {stockOk && (
            <div style={{ fontSize: 10, marginTop: 2, opacity: 0.85 }}>
              After this sale: {afterSale} remaining · Cost price: ₹
              {(product.costPrice || 0).toLocaleString("en-IN")}
              {margin && ` · Est. margin: ${margin}%`}
            </div>
          )}
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
            setSalePrice("");
            setCustomer("");
            setError("");
          }}
        >
          Clear
        </button>
        <button
          className="btn-primary"
          onClick={handleSubmit}
          disabled={loading}
        >
          {loading ? "Saving…" : "Save sale → sheet"}
        </button>
      </div>
    </div>
  );
}
