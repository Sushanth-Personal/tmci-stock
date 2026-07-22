"use client";
// src/components/CatalogQuickAddModal.tsx
//
// Shown when saving an invoice that references one or more models not
// yet in the product catalogue. Rather than silently auto-adding them
// (which turns typos and one-off names into permanent catalogue clutter)
// or silently ignoring them (which means the next person typing the same
// model gets no autosuggest), this asks: per item, add it to the
// catalogue or skip it — with the price/category pre-filled from what
// was typed on the invoice line so it's a one-click confirm in the
// common case.

import { useState } from "react";

export interface UnmatchedDraft {
  model: string;
  hsn: string;
  description: string;
  unitSalePrice: number;
  warranty: string;
}

interface DraftState extends UnmatchedDraft {
  include: boolean;
  category: string;
  itemCode: string;
  moq: number;
}

const CATEGORIES = ["DMM", "ACC", "AMP", "EPROD", "Other"];

export default function CatalogQuickAddModal({
  items,
  onResolve,
  onCancel,
}: {
  items: UnmatchedDraft[];
  onResolve: (addedCount: number) => void;
  onCancel: () => void;
}) {
  const [drafts, setDrafts] = useState<DraftState[]>(
    items.map((it) => ({
      ...it,
      include: true,
      category: "DMM",
      itemCode: "",
      moq: 1,
    })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const update = (model: string, patch: Partial<DraftState>) =>
    setDrafts((prev) =>
      prev.map((d) => (d.model === model ? { ...d, ...patch } : d)),
    );

  const proceed = async (addSelected: boolean) => {
    setSaving(true);
    setError("");
    let added = 0;
    try {
      if (addSelected) {
        const toAdd = drafts.filter((d) => d.include);
        for (const d of toAdd) {
          if (!d.unitSalePrice || d.unitSalePrice <= 0) continue; // skip, can't set list price to 0
          try {
            const res = await fetch("/api/products", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: d.model,
                itemCode: d.itemCode || undefined,
                hsn: d.hsn || undefined,
                category: d.category,
                listPrice: d.unitSalePrice,
                warranty: d.warranty || undefined,
                description: d.description || undefined,
                moq: d.moq || 1,
              }),
            });
            if (res.ok) added++;
            // If it fails (e.g. someone else added the same model in the
            // meantime), don't block the invoice save over it — just move on.
          } catch {
            // network hiccup on one item — don't block the whole invoice
          }
        }
      }
      onResolve(added);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.8)",
        zIndex: 260,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          width: "100%",
          maxWidth: 640,
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            Add these to your product catalogue?
          </div>
          <div
            style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}
          >
            {items.length === 1 ? "This item isn't" : "These items aren't"} in
            your catalogue yet. Adding them means they'll auto-suggest next time
            someone types the model on a sale or purchase.
          </div>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {drafts.map((d) => (
            <div
              key={d.model}
              style={{
                background: "var(--bg-input)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "10px 12px",
                opacity: d.include ? 1 : 0.5,
              }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={d.include}
                  onChange={(e) =>
                    update(d.model, { include: e.target.checked })
                  }
                  style={{ width: "auto" }}
                />
                <span style={{ fontWeight: 600, fontSize: 13 }}>{d.model}</span>
              </label>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 8,
                }}
              >
                <div>
                  <label style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    List price (₹)
                  </label>
                  <input
                    type="number"
                    value={d.unitSalePrice || ""}
                    disabled={!d.include}
                    onChange={(e) =>
                      update(d.model, { unitSalePrice: +e.target.value || 0 })
                    }
                    style={{ fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    Product family
                  </label>
                  <select
                    value={d.category}
                    disabled={!d.include}
                    onChange={(e) =>
                      update(d.model, { category: e.target.value })
                    }
                    style={{ fontSize: 12 }}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    HSN code
                  </label>
                  <input
                    value={d.hsn}
                    disabled={!d.include}
                    onChange={(e) => update(d.model, { hsn: e.target.value })}
                    style={{ fontSize: 12 }}
                  />
                </div>
              </div>
              {!d.unitSalePrice && d.include && (
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--accent-amber)",
                    marginTop: 6,
                  }}
                >
                  ⚠ Needs a list price above 0 to be added — otherwise it'll be
                  skipped.
                </div>
              )}
            </div>
          ))}
        </div>

        {error && (
          <div
            style={{
              padding: "8px 18px",
              fontSize: 11,
              color: "var(--accent-red)",
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
            padding: "12px 18px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
            flexWrap: "wrap",
          }}
        >
          <button className="btn-ghost" onClick={onCancel} disabled={saving}>
            ← Back to invoice
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn-ghost"
              onClick={() => proceed(false)}
              disabled={saving}
            >
              Skip — save invoice only
            </button>
            <button
              className="btn-primary"
              onClick={() => proceed(true)}
              disabled={saving}
            >
              {saving ? "Adding…" : "✓ Add selected & save invoice"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
