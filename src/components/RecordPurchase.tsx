"use client";
import { useState, useMemo, useRef, useEffect } from "react";

interface Props {
  products: any[];
  onSuccess: () => void;
}

interface BatchLine {
  model: string;
  qty: number;
  unitPrice: number;
  total: number;
}

// Defined at module scope so these are stable function references across renders.
const FG = ({ label, children, full, note }: any) => (
  <div style={{ gridColumn: full ? "1/-1" : undefined }}>
    <label>
      {label}
      {note && (
        <span
          style={{ color: "var(--text-muted)", fontSize: 10, marginLeft: 4 }}
        >
          {note}
        </span>
      )}
    </label>
    {children}
  </div>
);

const PriceRow = ({ label, value, final, color }: any) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      fontSize: 11,
      padding: "3px 0",
      borderBottom: final ? "none" : "1px solid var(--border)",
      color: final ? "var(--accent-green)" : color || "var(--text-dim)",
      fontWeight: final ? 600 : color ? 500 : 400,
    }}
  >
    <span>{label}</span>
    <span>{value}</span>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────
// Searchable model combobox
// ─────────────────────────────────────────────────────────────────────────
function ModelCombobox({
  products,
  value,
  onSelect,
  inputRef,
}: {
  products: any[];
  value: string;
  onSelect: (model: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      const model = (p.model || "").toLowerCase();
      const cat = (p.category || "").toLowerCase();
      const code = (p.itemCode || "").toLowerCase();
      return model.includes(q) || cat.includes(q) || code.includes(q);
    });
  }, [products, query]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const choose = (p: any) => {
    onSelect(p.model);
    setQuery(p.model);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlight]) choose(filtered[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder="Type to search model, category, or item code…"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (e.target.value === "") onSelect("");
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 30,
            background: "var(--bg-input)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            maxHeight: 260,
            overflowY: "auto",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          {filtered.map((p, i) => (
            <div
              key={p.model}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(p);
              }}
              onMouseEnter={() => setHighlight(i)}
              style={{
                padding: "7px 10px",
                fontSize: 12,
                cursor: "pointer",
                background:
                  i === highlight ? "rgba(59,130,246,0.15)" : "transparent",
                color: i === highlight ? "var(--text)" : "var(--text-dim)",
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span style={{ fontWeight: 500, color: "var(--text)" }}>
                {p.model}
                {p.category ? (
                  <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                    {" "}
                    ({p.category})
                  </span>
                ) : null}
              </span>
              <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>
                {p.itemCode}
              </span>
            </div>
          ))}
        </div>
      )}
      {open && filtered.length === 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 30,
            background: "var(--bg-input)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          No matching products
        </div>
      )}
    </div>
  );
}

export default function RecordPurchase({ products, onSuccess }: Props) {
  const today = new Date().toISOString().split("T")[0];

  const [batchMode, setBatchMode] = useState(true);
  const [batchLines, setBatchLines] = useState<BatchLine[]>([]);

  const [model, setModel] = useState("");
  // Purchase date = when goods were received / the PO date
  const [date, setDate] = useState(today);
  // Invoice date = supplier's invoice date (may differ from receipt date)
  const [invoiceDate, setInvoiceDate] = useState("");
  const [location, setLocation] = useState("Kochi");
  const [qty, setQty] = useState<number | "">("");
  const [listPrice, setListPrice] = useState<number | "">("");
  const [baseDiscount, setBaseDiscount] = useState<number | "">(30);
  const [addDiscount, setAddDiscount] = useState<number | "">(0);
  const [customFinal, setCustomFinal] = useState<number | "">("");
  const [customTotalPrice, setCustomTotalPrice] = useState<number | "">("");
  const [courier, setCourier] = useState<number | "">(0);
  const [supplier, setSupplier] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const modelInputRef = useRef<HTMLInputElement>(null);

  const product = useMemo(
    () => products.find((p) => p.model === model),
    [products, model],
  );

  const pricing = useMemo(() => {
    if (!listPrice) return null;
    const lp = +listPrice;
    const bd = +(baseDiscount || 0) / 100;
    const ad = +(addDiscount || 0) / 100;
    const afterBase = lp * (1 - bd);
    const afterAdd = afterBase * (1 - ad);
    const resolvedQty = +(qty || 0);
    const unitPrice = customFinal !== "" ? +customFinal : afterAdd;
    const courierPer = resolvedQty > 0 ? +(courier || 0) / resolvedQty : 0;
    const effectiveCost = unitPrice + courierPer;
    const totalVal = resolvedQty * unitPrice + +(courier || 0);
    const impliedAddDiscountPct =
      customFinal !== "" && lp > 0
        ? ((afterBase - +customFinal) / lp) * 100
        : null;
    return {
      afterBase,
      afterAdd,
      unitPrice,
      courierPer,
      effectiveCost,
      totalVal,
      impliedAddDiscountPct,
    };
  }, [listPrice, baseDiscount, addDiscount, customFinal, courier, qty]);

  useEffect(() => {
    if (customTotalPrice !== "" && qty !== "" && +qty > 0) {
      setCustomFinal(+(+customTotalPrice / +qty).toFixed(2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qty]);

  const clearLineFields = () => {
    setModel("");
    setQty("");
    setListPrice("");
    setCustomFinal("");
    setCustomTotalPrice("");
    setError("");
  };

  const handleModelSelect = (newModel: string) => {
    setModel(newModel);
    const p = products.find((x) => x.model === newModel);
    if (p) {
      setListPrice(p.listPrice || "");
      if (!batchMode || batchLines.length === 0) {
        setBaseDiscount(p.baseDiscount ? p.baseDiscount * 100 : 30);
        setAddDiscount(p.addDiscount ? p.addDiscount * 100 : 0);
      }
    }
  };

  const handleSubmit = async () => {
    if (!model || !qty || +qty <= 0) {
      setError("Select model and enter qty.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          invoiceDate: invoiceDate || undefined,
          model,
          location,
          qtyPurchased: +(qty || 0),
          unitListPrice: +(listPrice || 0),
          baseDiscount: +(baseDiscount || 0),
          addDiscount: +(addDiscount || 0),
          customFinalPrice: customFinal !== "" ? +customFinal : undefined,
          courierCharges: +(courier || 0),
          supplier,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed.");
        return;
      }

      const effectiveCost =
        data.effectiveCostPerUnit ?? pricing?.effectiveCost ?? 0;

      if (batchMode) {
        setBatchLines((lines) => [
          ...lines,
          {
            model,
            qty: +(qty || 0),
            unitPrice: effectiveCost,
            total: +(qty || 0) * effectiveCost,
          },
        ]);
        setSuccess(
          `Added: ${qty} × ${model} @ ₹${effectiveCost.toFixed(0)}/unit = ₹${(+(qty || 0) * effectiveCost).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
        );
        clearLineFields();
        setTimeout(() => setSuccess(""), 1800);
        modelInputRef.current?.focus();
      } else {
        setSuccess(
          `Purchase recorded! Effective cost: ₹${effectiveCost.toFixed(0)}/unit`,
        );
        setTimeout(() => {
          setSuccess("");
          onSuccess();
        }, 1500);
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  };

  const handleNewPO = () => {
    setBatchLines([]);
    setSupplier("");
    setInvoiceDate("");
    clearLineFields();
    setCourier(0);
  };

  const batchTotal = batchLines.reduce((s, l) => s + l.total, 0);
  const batchUnits = batchLines.reduce((s, l) => s + l.qty, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Batch mode toggle + current PO summary */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "10px 14px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 0,
              fontSize: 12,
              color: "var(--text-dim)",
            }}
          >
            <input
              type="checkbox"
              checked={batchMode}
              onChange={(e) => setBatchMode(e.target.checked)}
              style={{ width: "auto" }}
            />
            Batch mode — keep PO, location, discounts &amp; courier between
            items
          </label>
          {batchMode && batchLines.length > 0 && (
            <button
              className="btn-ghost"
              style={{ fontSize: 11 }}
              onClick={handleNewPO}
            >
              Start new PO
            </button>
          )}
        </div>

        {batchMode && batchLines.length > 0 && (
          <div
            style={{
              marginTop: 10,
              border: "1px solid var(--border)",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Unit cost</th>
                  <th style={{ textAlign: "right" }}>Line total</th>
                </tr>
              </thead>
              <tbody>
                {batchLines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.model}</td>
                    <td style={{ textAlign: "right" }}>{l.qty}</td>
                    <td style={{ textAlign: "right" }}>
                      ₹{l.unitPrice.toFixed(0)}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      ₹
                      {l.total.toLocaleString("en-IN", {
                        maximumFractionDigits: 0,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "8px 10px",
                borderTop: "1px solid var(--border)",
                background: "var(--bg-input)",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              <span>
                {batchLines.length} items this PO · {batchUnits} units
              </span>
              <span style={{ color: "var(--accent-green)" }}>
                ₹
                {batchTotal.toLocaleString("en-IN", {
                  maximumFractionDigits: 0,
                })}
              </span>
            </div>
          </div>
        )}
      </div>

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
          {batchMode ? "Add line item to PO" : "Purchase details"}
        </div>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
        >
          <FG label="Model" full>
            <ModelCombobox
              products={products}
              value={model}
              onSelect={handleModelSelect}
              inputRef={modelInputRef}
            />
          </FG>

          {/* ── Two date fields side by side ── */}
          <FG label="Purchase / receipt date">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </FG>
          <FG label="Invoice date" note="supplier's invoice date">
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
            />
          </FG>

          <FG label="Location">
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            >
              <option>Kochi</option>
              <option>Bangalore</option>
            </select>
          </FG>
          <FG label="Qty purchased">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={qty === "" ? "" : String(qty)}
              placeholder="e.g. 10"
              onChange={(e) => {
                const digits = e.target.value.replace(/[^0-9]/g, "");
                setQty(digits === "" ? "" : parseInt(digits, 10));
              }}
            />
          </FG>
          <FG label="Unit list price (₹)">
            <input
              type="text"
              inputMode="decimal"
              value={listPrice === "" ? "" : String(listPrice)}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9.]/g, "");
                setListPrice(v === "" ? "" : +v);
              }}
              placeholder="e.g. 8100"
            />
          </FG>
          <FG
            label="General discount (%)"
            note={batchMode ? "sticky for this PO" : undefined}
          >
            <input
              type="text"
              inputMode="decimal"
              value={baseDiscount === "" ? "" : String(baseDiscount)}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9.]/g, "");
                setBaseDiscount(v === "" ? "" : +v);
              }}
              placeholder="e.g. 30"
            />
          </FG>
          <FG
            label="Additional discount (%)"
            note={batchMode ? "sticky for this PO" : undefined}
          >
            <input
              type="text"
              inputMode="decimal"
              value={addDiscount === "" ? "" : String(addDiscount)}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9.]/g, "");
                setAddDiscount(v === "" ? "" : +v);
              }}
              placeholder="e.g. 5"
            />
          </FG>
          <FG
            label="Custom unit price (₹)"
            note="per unit · override if needed"
          >
            <input
              type="text"
              inputMode="decimal"
              value={customFinal === "" ? "" : String(customFinal)}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9.]/g, "");
                const num: number | "" = v === "" ? "" : +v;
                setCustomFinal(num);
                setCustomTotalPrice(
                  num === "" || !qty || qty === ""
                    ? ""
                    : +(num * +qty).toFixed(2),
                );
              }}
              placeholder="auto-calculated or enter per-unit price manually"
            />
          </FG>
          <FG
            label="Custom total price (₹)"
            note="for this line · auto-fills unit price"
          >
            <input
              type="text"
              inputMode="decimal"
              value={customTotalPrice === "" ? "" : String(customTotalPrice)}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9.]/g, "");
                const num: number | "" = v === "" ? "" : +v;
                setCustomTotalPrice(num);
                setCustomFinal(
                  num === "" || !qty || qty === ""
                    ? ""
                    : +(+num / +qty).toFixed(2),
                );
              }}
              placeholder="e.g. 18000 for the whole line"
            />
            {customTotalPrice !== "" && qty !== "" && +qty > 0 && (
              <div
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  marginTop: 4,
                }}
              >
                = ₹{(+customTotalPrice / +qty).toFixed(0)} per unit across {qty}{" "}
                unit{+qty === 1 ? "" : "s"}
              </div>
            )}
          </FG>
          <FG
            label="Courier charges (₹)"
            note={
              batchMode
                ? "sticky · split across this item's qty"
                : "split across all items"
            }
          >
            <input
              type="text"
              inputMode="decimal"
              value={courier === "" ? "" : String(courier)}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9.]/g, "");
                setCourier(v === "" ? "" : +v);
              }}
              placeholder="e.g. 1200"
            />
          </FG>
          <FG
            label="Supplier / PO reference"
            note={batchMode ? "sticky for this PO" : undefined}
          >
            <input
              type="text"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              placeholder="e.g. PO-2026-03 / Fluke direct"
            />
          </FG>
        </div>

        {/* Price breakdown */}
        {pricing && (
          <div
            style={{
              background: "var(--bg-input)",
              borderRadius: 8,
              padding: "10px 12px",
              marginTop: 8,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: "var(--text-dim)",
                marginBottom: 8,
              }}
            >
              Price breakdown
            </div>
            <PriceRow
              label="List price (ex-GST)"
              value={`₹${(+(listPrice || 0)).toLocaleString("en-IN")}`}
            />
            {baseDiscount ? (
              <PriceRow
                label={`General discount (${baseDiscount}%)`}
                value={`− ₹${((+(listPrice || 0) * +(baseDiscount || 0)) / 100).toLocaleString("en-IN")}`}
                color="var(--accent-amber)"
              />
            ) : null}
            {customFinal !== "" ? (
              pricing.impliedAddDiscountPct !== null &&
              pricing.impliedAddDiscountPct < 0 ? (
                <PriceRow
                  label={`Markup vs. discounted price (${Math.abs(pricing.impliedAddDiscountPct).toFixed(1)}% above)`}
                  value={`+ ₹${Math.abs(pricing.afterBase - +customFinal).toFixed(0)}`}
                  color="var(--accent-red)"
                />
              ) : (
                <PriceRow
                  label={
                    pricing.impliedAddDiscountPct !== null
                      ? `Additional discount (implied, ${pricing.impliedAddDiscountPct.toFixed(1)}%)`
                      : "Additional discount (implied)"
                  }
                  value={
                    pricing.impliedAddDiscountPct !== null
                      ? `− ₹${Math.abs(pricing.afterBase - +customFinal).toFixed(0)}`
                      : "—"
                  }
                  color="var(--accent-amber)"
                />
              )
            ) : (
              <PriceRow
                label={`Additional discount (${addDiscount || 0}%)`}
                value={`− ₹${((pricing.afterBase * +(addDiscount || 0)) / 100).toFixed(0)}`}
                color="var(--accent-amber)"
              />
            )}
            <PriceRow
              label={
                customFinal !== ""
                  ? "Custom unit price (ex-GST)"
                  : "Unit purchase price (ex-GST, after all discounts)"
              }
              value={`₹${(customFinal !== "" ? +customFinal : pricing.afterAdd).toFixed(0)}`}
            />
            {courier ? (
              <PriceRow
                label={`Courier (shared ÷ ${qty || "?"})`}
                value={`₹${pricing.courierPer.toFixed(0)}/unit`}
              />
            ) : null}
            <PriceRow
              label="Effective cost per unit (incl. courier)"
              value={`₹${pricing.effectiveCost.toFixed(0)}`}
              final
            />
            <div
              style={{
                marginTop: 6,
                paddingTop: 6,
                borderTop: "1px dashed var(--border)",
              }}
            >
              <PriceRow
                label={`Line total — ${qty || 0} unit${+qty === 1 ? "" : "s"} (ex-GST, incl. courier)`}
                value={`₹${pricing.totalVal.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
                final
              />
            </div>
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
            style={{ marginTop: 8, fontSize: 11, color: "var(--accent-green)" }}
          >
            {success}
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: 6,
            justifyContent: "flex-end",
            marginTop: 12,
          }}
        >
          <button className="btn-ghost" onClick={clearLineFields}>
            Clear item
          </button>
          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading
              ? "Saving…"
              : batchMode
                ? "Add item → sheet"
                : "Save purchase → sheet"}
          </button>
          {batchMode && batchLines.length > 0 && (
            <button
              className="btn-primary"
              style={{ background: "var(--accent-green)" }}
              onClick={() => {
                setBatchLines([]);
                onSuccess();
              }}
            >
              Done with this PO
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
