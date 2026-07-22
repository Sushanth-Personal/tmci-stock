"use client";
// src/components/Items.tsx
//
// The full product catalogue: search/browse existing items, add a new
// one, or edit an existing row. Replaces the old bare "Add Item" form as
// the target of the sidebar's "Items" entry — that form is still here,
// just now reached via a "+ Add item" button instead of being the whole
// screen.

import { useState, useMemo, useEffect } from "react";

interface Product {
  id: number;
  itemCode: string;
  hsn: string;
  category: string;
  make: string;
  model: string;
  description: string;
  listPrice: number;
  warranty: string;
  moq: number;
}

const fmtRs = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN");

const FG = ({ label, children }: any) => (
  <div>
    <label>{label}</label>
    {children}
  </div>
);

// ── Shared add/edit form ────────────────────────────────────────────────
function ItemForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: Product | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const isEdit = !!initial;
  const [model, setModel] = useState(initial?.model ?? "");
  const [itemCode, setItemCode] = useState(initial?.itemCode ?? "");
  const [category, setCategory] = useState(initial?.category || "DMM");
  const [make, setMake] = useState(initial?.make ?? "");
  const [hsn, setHsn] = useState(initial?.hsn ?? "");
  const [moq, setMoq] = useState<number>(initial?.moq ?? 1);
  const [listPrice, setListPrice] = useState<number | "">(
    initial?.listPrice ?? "",
  );
  const [warranty, setWarranty] = useState(initial?.warranty ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = async () => {
    if (!model.trim() || !listPrice) {
      setError("Model name and list price are required.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const payload = {
        model: model.trim(),
        itemCode,
        category,
        make,
        hsn,
        moq: +moq || 1,
        listPrice: +listPrice,
        warranty,
        description,
      };
      const res = await fetch("/api/products", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isEdit ? { id: initial!.id, ...payload } : payload,
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed.");
        return;
      }
      setSuccess(isEdit ? "Item updated!" : "Item added to catalogue!");
      setTimeout(() => {
        setSuccess("");
        onSaved();
      }, 900);
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
        {isEdit
          ? `Edit item — ${initial!.model}`
          : "Add a new product to master list"}
      </div>
      <div className="form-grid">
        <FG label="Model name">
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. Fluke 289"
          />
        </FG>
        <FG label="Item code">
          <input
            type="text"
            value={itemCode}
            onChange={(e) => setItemCode(e.target.value)}
            placeholder="e.g. 4084137"
          />
        </FG>
        <FG label="Product family">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option>DMM</option>
            <option>ACC</option>
            <option>AMP</option>
            <option>EPROD</option>
            <option>Other</option>
          </select>
        </FG>
        <FG label="HSN code">
          <input
            type="text"
            value={hsn}
            onChange={(e) => setHsn(e.target.value)}
            placeholder="e.g. 90303100"
          />
        </FG>
        <FG label="Make">
          <input
            type="text"
            value={make}
            onChange={(e) => setMake(e.target.value)}
            placeholder="e.g. Fluke"
          />
        </FG>
        <FG label="MOQ">
          <input
            type="number"
            min={1}
            value={moq}
            onChange={(e) => setMoq(+e.target.value)}
          />
        </FG>
        <FG label="List price (₹)">
          <input
            type="number"
            value={listPrice}
            onChange={(e) => setListPrice(+e.target.value || "")}
            placeholder="e.g. 46182"
          />
        </FG>
        <FG label="Warranty">
          <input
            type="text"
            value={warranty}
            onChange={(e) => setWarranty(e.target.value)}
            placeholder="e.g. 3 years"
          />
        </FG>
        <FG label="Description">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Digital Multimeter"
          />
        </FG>
      </div>

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
        <button className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn-primary"
          onClick={handleSubmit}
          disabled={loading}
        >
          {loading
            ? "Saving…"
            : isEdit
              ? "Save changes"
              : "Add item → catalogue"}
        </button>
      </div>
    </div>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────
export default function Items({
  products: productsProp,
  onChanged,
}: {
  products?: Product[];
  onChanged?: () => void;
}) {
  const [products, setProducts] = useState<Product[]>(productsProp ?? []);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [make, setMake] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [deleteError, setDeleteError] = useState<string>("");

  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const r = await fetch("/api/products");
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setLoadError(d.error || `Failed to load products (HTTP ${r.status}).`);
        setLoading(false);
        return;
      }
      const d = await r.json();
      setProducts(d.products ?? []);
    } catch (e: any) {
      setLoadError(
        `Network error loading products: ${e?.message ?? "unknown error"}`,
      );
    }
    setLoading(false);
  };

  // Always self-fetch on mount — don't rely solely on the parent's
  // `products` prop, which may start as an empty array (truthy, so an
  // earlier version of this check skipped fetching) or may not be wired
  // up at all if the page.tsx edit was missed.
  useEffect(() => {
    load();
  }, []);

  // If the parent later passes a non-empty, more-current list (e.g. after
  // a sale auto-adds a new catalogue item elsewhere in the app), prefer
  // it — but never let an empty/undefined prop blank out a list we
  // already successfully loaded ourselves.
  useEffect(() => {
    if (productsProp && productsProp.length > 0) setProducts(productsProp);
  }, [productsProp]);

  const categories = useMemo(() => {
    const s = new Set(products.map((p) => p.category).filter(Boolean));
    return Array.from(s).sort();
  }, [products]);

  const makes = useMemo(() => {
    const s = new Set(products.map((p) => p.make).filter(Boolean));
    return Array.from(s).sort();
  }, [products]);

  const filtered = useMemo(() => {
    let rows = products;
    if (category !== "all") rows = rows.filter((p) => p.category === category);
    if (make !== "all") rows = rows.filter((p) => p.make === make);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (p) =>
          p.model?.toLowerCase().includes(q) ||
          p.itemCode?.toLowerCase().includes(q) ||
          p.make?.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q),
      );
    }
    return [...rows].sort((a, b) => a.model.localeCompare(b.model));
  }, [products, search, category, make]);

  const refreshAll = () => {
    load();
    onChanged?.();
  };

  const handleDelete = async (p: Product) => {
    if (!confirm(`Delete "${p.model}" from the catalogue?`)) return;
    setDeleteError("");
    try {
      const r = await fetch(`/api/products?id=${p.id}`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) {
        setDeleteError(d.error || "Failed to delete.");
        return;
      }
      refreshAll();
    } catch {
      setDeleteError("Network error.");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {(showForm || editing) && (
        <ItemForm
          initial={editing}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSaved={() => {
            setShowForm(false);
            setEditing(null);
            refreshAll();
          }}
        />
      )}

      {!showForm && !editing && (
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
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 500,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Product catalogue · {filtered.length} of {products.length} items
            </div>
            <button className="btn-primary" onClick={() => setShowForm(true)}>
              + Add item
            </button>
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 10,
              flexWrap: "wrap",
            }}
          >
            <input
              placeholder="Search model, item code, make, description…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 220 }}
            />
            <select
              value={make}
              onChange={(e) => setMake(e.target.value)}
              style={{ width: 150 }}
            >
              <option value="all">All makes</option>
              {makes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={{ width: 160 }}
            >
              <option value="all">All families</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {(search.trim() || category !== "all" || make !== "all") && (
              <button
                className="btn-ghost"
                style={{ fontSize: 11 }}
                onClick={() => {
                  setSearch("");
                  setCategory("all");
                  setMake("all");
                }}
              >
                Clear filters
              </button>
            )}
          </div>

          {loadError && (
            <div
              style={{
                marginBottom: 10,
                padding: "8px 12px",
                borderRadius: 6,
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.3)",
                fontSize: 11,
                color: "var(--accent-red)",
              }}
            >
              ⚠ {loadError}
              <button
                onClick={load}
                style={{
                  marginLeft: 8,
                  fontSize: 11,
                  color: "var(--accent)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                Retry
              </button>
            </div>
          )}

          {deleteError && (
            <div
              style={{
                marginBottom: 8,
                fontSize: 11,
                color: "var(--accent-red)",
              }}
            >
              {deleteError}
            </div>
          )}

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Make</th>
                  <th>Family</th>
                  <th>Item code</th>
                  <th>HSN</th>
                  <th style={{ textAlign: "right" }}>MOQ</th>
                  <th style={{ textAlign: "right" }}>List price</th>
                  <th>Warranty</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={9}
                      style={{
                        textAlign: "center",
                        padding: 20,
                        color: "var(--text-muted)",
                      }}
                    >
                      Loading…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      style={{
                        textAlign: "center",
                        padding: 20,
                        color: "var(--text-muted)",
                      }}
                    >
                      {products.length === 0
                        ? "No products in the catalogue yet — add your first item above."
                        : "No items match your search."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 500 }}>{p.model}</td>
                      <td style={{ color: "var(--text-muted)" }}>
                        {p.make || "—"}
                      </td>
                      <td style={{ color: "var(--text-muted)" }}>
                        {p.category || "—"}
                      </td>
                      <td style={{ color: "var(--text-muted)" }}>
                        {p.itemCode || "—"}
                      </td>
                      <td style={{ color: "var(--text-muted)" }}>
                        {p.hsn || "—"}
                      </td>
                      <td style={{ textAlign: "right" }}>{p.moq}</td>
                      <td style={{ textAlign: "right", fontWeight: 500 }}>
                        {fmtRs(p.listPrice)}
                      </td>
                      <td style={{ color: "var(--text-muted)" }}>
                        {p.warranty || "—"}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            className="btn-ghost"
                            style={{ fontSize: 10, padding: "3px 8px" }}
                            onClick={() => setEditing(p)}
                          >
                            Edit
                          </button>
                          <button
                            className="btn-ghost"
                            style={{
                              fontSize: 10,
                              padding: "3px 8px",
                              color: "var(--accent-red)",
                            }}
                            onClick={() => handleDelete(p)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
