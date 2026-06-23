"use client";
import { useState } from "react";

export default function AddItem({ onSuccess }: { onSuccess: () => void }) {
  const [model, setModel] = useState("");
  const [itemCode, setItemCode] = useState("");
  const [family, setFamily] = useState("DMM");
  const [hsn, setHsn] = useState("");
  const [moq, setMoq] = useState(1);
  const [listPrice, setListPrice] = useState<number | "">("");
  const [baseDiscount, setBaseDiscount] = useState<number | "">(30);
  const [addDiscount, setAddDiscount] = useState<number | "">(0);
  const [stockKochi, setStockKochi] = useState(0);
  const [stockBlore, setStockBlore] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const costPrice = listPrice
    ? +(listPrice) * (1 - +(baseDiscount||0)/100) * (1 - +(addDiscount||0)/100)
    : null;

  const handleSubmit = async () => {
    if (!model || !itemCode || !listPrice) { setError("Model, item code, and list price are required."); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, itemCode, family, hsn, moq, listPrice: +listPrice, baseDiscount: +(baseDiscount||30), addDiscount: +(addDiscount||0), stockKochi, stockBlore }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed."); return; }
      setSuccess("Product added to sheet!");
      setTimeout(() => { setSuccess(""); onSuccess(); }, 1500);
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  };

  const FG = ({ label, children }: any) => (
    <div><label>{label}</label>{children}</div>
  );

  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 10, fontWeight: 500, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
        Add a new product to master list
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <FG label="Model name">
          <input type="text" value={model} onChange={e => setModel(e.target.value)} placeholder="e.g. Fluke 289" />
        </FG>
        <FG label="Item code">
          <input type="text" value={itemCode} onChange={e => setItemCode(e.target.value)} placeholder="e.g. 4084137" />
        </FG>
        <FG label="Product family">
          <select value={family} onChange={e => setFamily(e.target.value)}>
            <option>DMM</option>
            <option>ACC</option>
            <option>AMP</option>
            <option>EPROD</option>
            <option>Other</option>
          </select>
        </FG>
        <FG label="HSN code">
          <input type="text" value={hsn} onChange={e => setHsn(e.target.value)} placeholder="e.g. 90303100" />
        </FG>
        <FG label="MOQ">
          <input type="number" min={1} value={moq} onChange={e => setMoq(+e.target.value)} />
        </FG>
        <FG label="List price (₹)">
          <input type="number" value={listPrice} onChange={e => setListPrice(+e.target.value || "")} placeholder="e.g. 46182" />
        </FG>
        <FG label="Base discount (%)">
          <input type="number" value={baseDiscount} onChange={e => setBaseDiscount(+e.target.value)} placeholder="e.g. 30" />
        </FG>
        <FG label="Additional discount (%)">
          <input type="number" value={addDiscount} onChange={e => setAddDiscount(+e.target.value)} placeholder="e.g. 0" />
        </FG>
        <FG label="Opening stock – Kochi">
          <input type="number" min={0} value={stockKochi} onChange={e => setStockKochi(+e.target.value)} />
        </FG>
        <FG label="Opening stock – Bangalore">
          <input type="number" min={0} value={stockBlore} onChange={e => setStockBlore(+e.target.value)} />
        </FG>
      </div>

      {costPrice !== null && (
        <div style={{ marginTop: 10, padding: "8px 12px", background: "var(--bg-input)", borderRadius: 8, fontSize: 11, color: "var(--text-dim)" }}>
          Calculated cost price: <strong style={{ color: "var(--accent-green)" }}>₹{costPrice.toFixed(0)}</strong> per unit
        </div>
      )}

      {error && <div style={{ marginTop: 8, fontSize: 11, color: "var(--accent-red)" }}>{error}</div>}
      {success && <div style={{ marginTop: 8, fontSize: 11, color: "var(--accent-green)" }}>{success}</div>}

      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 12 }}>
        <button className="btn-ghost" onClick={() => { setModel(""); setItemCode(""); setListPrice(""); setError(""); }}>Cancel</button>
        <button className="btn-primary" onClick={handleSubmit} disabled={loading}>
          {loading ? "Adding…" : "Add item → sheet"}
        </button>
      </div>
    </div>
  );
}
