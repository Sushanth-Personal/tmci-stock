"use client";
// src/components/RecordSale.tsx
//
// Full invoice builder. Flow:
//   1. Search / create customer (stored in Supabase)
//   2. Add line items (model, qty, rate, discount, serial numbers)
//      — or Import from Claude JSON / Excel via 📥 Import Invoice
//   3. Save invoice → Supabase (status: pending_dispatch)
//   4. Stock is NOT touched here — only on dispatch (from dashboard)
//
// UPDATE: Serial numbers entered on each line are now verified live against
// /api/stock/serials — flags serials that are already sold, don't exist in
// any open lot, or belong to a different model than the line item claims.
// This catches mismatches that can slip in via Zoho/Groq import (e.g. an
// imported model name that doesn't match the serial's actual lot).

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import InvoiceImport, { ImportedInvoice } from "@/components/InvoiceImport";
import GroqSaleScanner from "@/components/GroqSaleScanner";

interface Props {
  products: any[];
  onSuccess: () => void;
}

interface Customer {
  id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstin?: string;
  phone?: string;
  email?: string;
}

interface LineItem {
  model: string;
  itemCode: string;
  hsn: string;
  description: string;
  qty: number;
  unitSalePrice: number;
  discount: number;
  serialNumbers: string[];
  warranty: string;
}

const FG = ({ label, children, full, note }: any) => (
  <div style={{ gridColumn: full ? "1/-1" : undefined }}>
    <label>
      {label}
      {note && (
        <span
          style={{ color: "var(--text-muted)", fontSize: 10, marginLeft: 5 }}
        >
          {note}
        </span>
      )}
    </label>
    {children}
  </div>
);

function fmt(v: number) {
  return v.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function emptyLine(): LineItem {
  return {
    model: "",
    itemCode: "",
    hsn: "",
    description: "",
    qty: 1,
    unitSalePrice: 0,
    discount: 0,
    serialNumbers: [""],
    warranty: "",
  };
}

// ─── Model match check (catalogue) ─────────────────────────────────────────────
function isModelMatched(products: any[], model: string): boolean {
  if (!model.trim()) return true; // don't warn on empty/new rows
  return products.some((p) => p.model.toLowerCase() === model.toLowerCase());
}

// ─── Generic "did you mean" matching ───────────────────────────────────────
// No hardcoded aliases — just finds the closest existing catalogue model(s)
// to whatever was typed/scanned, so any future naming mismatch gets a
// helpful nudge instead of a silent "not in catalogue".

// Levenshtein distance — small, no dependency needed for product-name-length strings.
function levenshtein(a: string, b: string): number {
  const m = a.length,
    n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array(n + 1)
      .fill(0)
      .map((_, j) => (i === 0 ? j : 0)),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// Normalises for comparison: lowercase, collapse whitespace/punctuation
// so "15B Max", "15B-MAX", "15b  max" etc. all compare the same way.
function normForMatch(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s\-_/()+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Returns the catalogue product(s) most likely to be what the user meant,
// or [] if nothing is close enough to be worth suggesting.
function findSimilarProducts(products: any[], typed: string, max = 2): any[] {
  const query = normForMatch(typed);
  if (!query) return [];

  const scored = products.map((p) => {
    const cand = normForMatch(p.model);
    let score: number;

    // Exact normalized match (e.g. only punctuation/case differed) — treat as
    // a near-perfect suggestion even if the raw strings didn't match.
    if (cand === query) {
      score = 0;
    } else if (cand.startsWith(query) || query.startsWith(cand)) {
      // Prefix / substring relationship (e.g. "15B Max" -> "15B Max-01 (TL75)")
      // is a very strong signal — Fluke's "-01 default variant" pattern.
      score = 0.5;
    } else if (cand.includes(query) || query.includes(cand)) {
      score = 1;
    } else {
      // Otherwise fall back to edit distance, normalised by length so short
      // and long model names are comparable.
      const dist = levenshtein(query, cand);
      const normalizedDist = dist / Math.max(query.length, cand.length);
      score = 2 + normalizedDist; // offset so substring matches always rank above
    }

    // Tie-breaking nudge: when a bare/ambiguous name (e.g. "15B Max") could
    // mean either a numbered variant ("-01 (TL75)") or a bundled accessory
    // set ("... Kit"), the numbered variant is the actual default SKU and
    // should be suggested first. Small enough to only matter within the
    // same score tier, never enough to override a genuinely closer match.
    if (/\bkit\b|\bcombo\b|\bset\b/.test(cand)) score += 0.05;
    if (/-0\d\b|\b0\d\b/.test(cand)) score -= 0.05;

    return { p, score };
  });

  return scored
    .filter((s) => s.score <= 2.35) // cutoff — tune if it feels too loose/strict
    .sort((a, b) => a.score - b.score)
    .slice(0, max)
    .map((s) => s.p);
}

// ─── Serial number stock verification ──────────────────────────────────────────
type SerialStatus =
  | "checking"
  | "in_stock"
  | "sold"
  | "not_found"
  | "wrong_model"
  | "idle";

const SERIAL_STATUS_META: Record<
  Exclude<SerialStatus, "idle">,
  { text: string; color: string }
> = {
  checking: { text: "checking…", color: "var(--text-muted)" },
  in_stock: { text: "✓ in stock", color: "var(--accent-green)" },
  sold: { text: "✕ already sold", color: "var(--accent-red)" },
  not_found: { text: "⚠ not found in stock", color: "var(--accent-amber)" },
  wrong_model: {
    text: "⚠ belongs to a different model",
    color: "var(--accent-amber)",
  },
};

// ─── Customer searchbox ────────────────────────────────────────────────────────
function CustomerSearch({
  onSelect,
  selected,
  hasError,
}: {
  onSelect: (c: Customer | null) => void;
  selected: Customer | null;
  hasError?: boolean;
}) {
  const [query, setQuery] = useState(selected?.name ?? "");
  const [results, setResults] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [nc, setNc] = useState<Omit<Customer, "id">>({
    name: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    gstin: "",
    phone: "",
    email: "",
  });
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  useEffect(() => {
    if (selected) setQuery(selected.name);
  }, [selected]);

  const search = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/customers?q=${encodeURIComponent(q)}`);
      const d = await r.json();
      setResults(d.customers ?? []);
    } catch {}
    setLoading(false);
  }, []);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    setOpen(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(v), 250);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowNewForm(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const choose = (c: Customer) => {
    onSelect(c);
    setQuery(c.name);
    setOpen(false);
    setShowNewForm(false);
  };

  const clearSelection = () => {
    onSelect(null);
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  const saveNew = async () => {
    if (!nc.name.trim()) {
      setSaveErr("Name is required");
      return;
    }
    setSaving(true);
    setSaveErr("");
    try {
      const r = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nc),
      });
      const d = await r.json();
      if (!r.ok) {
        setSaveErr(d.error || "Failed");
        setSaving(false);
        return;
      }
      choose(d.customer);
      setShowNewForm(false);
      setNc({
        name: "",
        address: "",
        city: "",
        state: "",
        pincode: "",
        gstin: "",
        phone: "",
        email: "",
      });
    } catch {
      setSaveErr("Network error");
    }
    setSaving(false);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      {selected ? (
        <div
          style={{
            background: "rgba(59,130,246,0.08)",
            border: "1px solid rgba(59,130,246,0.3)",
            borderRadius: 8,
            padding: "10px 12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{selected.name}</div>
            {selected.address && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginTop: 2,
                }}
              >
                {[
                  selected.address,
                  selected.city,
                  selected.state,
                  selected.pincode,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </div>
            )}
            {selected.gstin && (
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                GSTIN: {selected.gstin}
              </div>
            )}
            {(selected.phone || selected.email) && (
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {[selected.phone, selected.email].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>
          <button
            onClick={clearSelection}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              padding: "0 4px",
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      ) : (
        <>
          <input
            type="text"
            value={query}
            placeholder="Search customer by name or GSTIN…"
            onChange={handleInput}
            onFocus={() => {
              setOpen(true);
              if (!query) search("");
            }}
            style={{
              borderColor: hasError ? "var(--accent-red)" : undefined,
              boxShadow: hasError ? "0 0 0 1px var(--accent-red)" : undefined,
            }}
          />
          {hasError && (
            <div
              style={{
                fontSize: 11,
                color: "var(--accent-red)",
                marginTop: 4,
              }}
            >
              Customer is required
            </div>
          )}
          {open && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                right: 0,
                zIndex: 50,
                background: "var(--bg-input)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                overflow: "hidden",
              }}
            >
              {loading && (
                <div
                  style={{
                    padding: "8px 12px",
                    fontSize: 11,
                    color: "var(--text-muted)",
                  }}
                >
                  Searching…
                </div>
              )}
              {!loading &&
                results.map((c) => (
                  <div
                    key={c.id}
                    onMouseDown={() => choose(c)}
                    style={{
                      padding: "9px 12px",
                      cursor: "pointer",
                      borderBottom: "1px solid var(--border)",
                      fontSize: 12,
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background =
                        "rgba(59,130,246,0.1)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <div style={{ fontWeight: 500 }}>{c.name}</div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                      {[c.city, c.state].filter(Boolean).join(", ")}
                      {c.gstin ? ` · GSTIN: ${c.gstin}` : ""}
                    </div>
                  </div>
                ))}
              {!loading && !showNewForm && (
                <div
                  onMouseDown={() => {
                    setShowNewForm(true);
                    setNc((n) => ({ ...n, name: query }));
                  }}
                  style={{
                    padding: "9px 12px",
                    cursor: "pointer",
                    fontSize: 12,
                    color: "var(--accent)",
                    fontWeight: 500,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "rgba(59,130,246,0.08)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  + Add new customer
                </div>
              )}
            </div>
          )}

          {showNewForm && (
            <div
              style={{
                marginTop: 8,
                background: "var(--bg-input)",
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
                New customer
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                }}
              >
                <FG label="Company / Customer name" full>
                  <input
                    autoFocus
                    value={nc.name}
                    onChange={(e) =>
                      setNc((n) => ({ ...n, name: e.target.value }))
                    }
                    placeholder="e.g. Matha Electronics"
                  />
                </FG>
                <FG label="Address" full>
                  <input
                    value={nc.address}
                    onChange={(e) =>
                      setNc((n) => ({ ...n, address: e.target.value }))
                    }
                    placeholder="Street address"
                  />
                </FG>
                <FG label="City">
                  <input
                    value={nc.city}
                    onChange={(e) =>
                      setNc((n) => ({ ...n, city: e.target.value }))
                    }
                    placeholder="e.g. Ernakulam"
                  />
                </FG>
                <FG label="State">
                  <input
                    value={nc.state}
                    onChange={(e) =>
                      setNc((n) => ({ ...n, state: e.target.value }))
                    }
                    placeholder="e.g. Kerala"
                  />
                </FG>
                <FG label="Pincode">
                  <input
                    value={nc.pincode}
                    onChange={(e) =>
                      setNc((n) => ({ ...n, pincode: e.target.value }))
                    }
                    placeholder="682016"
                  />
                </FG>
                <FG label="GSTIN">
                  <input
                    value={nc.gstin}
                    onChange={(e) =>
                      setNc((n) => ({
                        ...n,
                        gstin: e.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="32ACEPJ7316E1Z2"
                  />
                </FG>
                <FG label="Phone">
                  <input
                    value={nc.phone}
                    onChange={(e) =>
                      setNc((n) => ({ ...n, phone: e.target.value }))
                    }
                    placeholder="9591119333"
                  />
                </FG>
                <FG label="Email">
                  <input
                    type="email"
                    value={nc.email}
                    onChange={(e) =>
                      setNc((n) => ({ ...n, email: e.target.value }))
                    }
                    placeholder="buyer@example.com"
                  />
                </FG>
              </div>
              {saveErr && (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 11,
                    color: "var(--accent-red)",
                  }}
                >
                  {saveErr}
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  justifyContent: "flex-end",
                  marginTop: 12,
                }}
              >
                <button
                  className="btn-ghost"
                  style={{ fontSize: 11 }}
                  onClick={() => setShowNewForm(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  style={{ fontSize: 11 }}
                  onClick={saveNew}
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save customer"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Model combobox ────────────────────────────────────────────────────────────
function ModelCombobox({
  products,
  value,
  onSelect,
}: {
  products: any[];
  value: string;
  onSelect: (p: any) => void;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products.slice(0, 12);
    return products.filter((p) => {
      return (
        String(p.model ?? "")
          .toLowerCase()
          .includes(q) ||
        String(p.category ?? "")
          .toLowerCase()
          .includes(q) ||
        String(p.itemCode ?? "")
          .toLowerCase()
          .includes(q)
      );
    });
  }, [products, query]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const choose = (p: any) => {
    setQuery(p.model);
    onSelect(p);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        type="text"
        value={query}
        placeholder="Search model…"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && filtered[hi]) {
            e.preventDefault();
            choose(filtered[hi]);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && filtered.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 60,
            background: "var(--bg-input)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            maxHeight: 220,
            overflowY: "auto",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        >
          {filtered.map((p, i) => (
            <div
              key={p.model}
              onMouseDown={() => choose(p)}
              onMouseEnter={() => setHi(i)}
              style={{
                padding: "7px 10px",
                fontSize: 12,
                cursor: "pointer",
                background: i === hi ? "rgba(59,130,246,0.15)" : "transparent",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span style={{ fontWeight: 500 }}>{p.model}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                {p.itemCode} · ₹{(p.listPrice || 0).toLocaleString("en-IN")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function RecordSale({ products, onSuccess }: Props) {
  const today = new Date().toISOString().split("T")[0];
  const yr = new Date().getFullYear();
  const defaultInvoiceNum = `${yr}-${yr + 1}-KL-`;

  const [invoiceNum, setInvoiceNum] = useState(defaultInvoiceNum);
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [location, setLocation] = useState("Kochi");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [gstRate, setGstRate] = useState(18);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [customerError, setCustomerError] = useState(false);

  // ── Invoice Import (Claude JSON / Excel) ──────────────────────────────────
  const [showImport, setShowImport] = useState(false);
  const [importNote, setImportNote] = useState("");

  // ── Groq scanner (free vision API) ────────────────────────────────────────
  const [showGroqScanner, setShowGroqScanner] = useState(false);

  // ── Serial number stock verification ──────────────────────────────────────
  // Key: `${lineIdx}-${serialIdx}` → status
  const [serialStatus, setSerialStatus] = useState<
    Record<string, SerialStatus>
  >({});
  const serialCheckTimers = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});
  const serialCheckSeq = useRef<Record<string, number>>({});

  const checkSerial = useCallback(
    async (
      lineIdx: number,
      snIdx: number,
      serial: string,
      expectedModel: string,
      expectedLocation: string,
    ) => {
      const key = `${lineIdx}-${snIdx}`;
      const trimmed = serial.trim();

      if (!trimmed) {
        setSerialStatus((s) => ({ ...s, [key]: "idle" }));
        return;
      }

      // Guard against race conditions: if the user keeps typing, only the
      // latest request for this key should be allowed to write a result.
      const seq = (serialCheckSeq.current[key] ?? 0) + 1;
      serialCheckSeq.current[key] = seq;

      setSerialStatus((s) => ({ ...s, [key]: "checking" }));
      try {
        const r = await fetch(
          `/api/stock/serials?q=${encodeURIComponent(trimmed)}`,
        );
        const d = await r.json();

        // Stale response — a newer check has since been fired for this key.
        if (serialCheckSeq.current[key] !== seq) return;

        const lotMatches = d.lotMatches ?? [];
        const saleMatches = d.saleMatches ?? [];

        // Already sold to someone — never valid to sell again.
        const soldMatch = saleMatches.find(
          (m: any) => m.serial.toLowerCase() === trimmed.toLowerCase(),
        );
        if (soldMatch) {
          setSerialStatus((s) => ({ ...s, [key]: "sold" }));
          return;
        }

        const exact = lotMatches.find(
          (m: any) => m.serial.toLowerCase() === trimmed.toLowerCase(),
        );

        if (!exact || Number(exact.lotRemainingQty) <= 0) {
          setSerialStatus((s) => ({ ...s, [key]: "not_found" }));
          return;
        }

        const modelOk =
          !expectedModel ||
          exact.model.toLowerCase() === expectedModel.toLowerCase();
        const locationOk =
          !expectedLocation ||
          exact.location.toLowerCase() === expectedLocation.toLowerCase();

        if (!modelOk || !locationOk) {
          setSerialStatus((s) => ({ ...s, [key]: "wrong_model" }));
          return;
        }

        setSerialStatus((s) => ({ ...s, [key]: "in_stock" }));
      } catch {
        if (serialCheckSeq.current[key] !== seq) return;
        setSerialStatus((s) => ({ ...s, [key]: "idle" }));
      }
    },
    [],
  );

  const handleImported = (data: ImportedInvoice) => {
    // Header fields
    if (data.invoiceNumber) setInvoiceNum(data.invoiceNumber);
    if (data.invoiceDate) setInvoiceDate(data.invoiceDate);
    if (data.dueDate) setDueDate(data.dueDate);
    else if (data.invoiceDate) setDueDate(data.invoiceDate);
    if (data.notes) setNotes(data.notes);
    if (data.gstRate) setGstRate(data.gstRate);

    // Map ALL line items — match against catalogue for itemCode/hsn/description
    const importedLines: LineItem[] = data.lineItems.map((item) => {
      const catalogueMatch = products.find(
        (p) =>
          String(p.model).toLowerCase() === String(item.model).toLowerCase(),
      );
      const qty = Math.max(1, Number(item.qty) || 1);

      // Serial numbers: comma-separated string → array, padded to qty
      const sns = (item.serialNumbers ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const serialNumbers = Array.from({ length: qty }, (_, i) => sns[i] ?? "");

      return {
        model: catalogueMatch?.model ?? item.model,
        itemCode: catalogueMatch?.itemCode ?? "",
        hsn: item.hsn || catalogueMatch?.hsn || "",
        description: item.description || catalogueMatch?.description || "",
        qty,
        unitSalePrice: Number(item.unitPrice) || 0,
        discount: Number(item.discount) || 0,
        serialNumbers,
        warranty: catalogueMatch?.warranty
          ? String(catalogueMatch.warranty)
          : "",
      };
    });

    if (importedLines.length > 0) {
      setLines(importedLines);
      // Reset old serial-check state — indices no longer correspond to
      // whatever was there before, and kick off checks for the freshly
      // imported serials so mismatches surface immediately.
      setSerialStatus({});
      serialCheckSeq.current = {};
      importedLines.forEach((line, lineIdx) => {
        line.serialNumbers.forEach((serial, snIdx) => {
          if (serial.trim()) {
            checkSerial(lineIdx, snIdx, serial, line.model, location);
          }
        });
      });
    }

    // Customer note — importing can't auto-select a Supabase customer,
    // so show a hint with the extracted name for manual selection
    if (data.vendorOrCustomer) {
      setImportNote(
        `Imported customer name: "${data.vendorOrCustomer}" — search and select them below (or add as new).`,
      );
    }

    setShowImport(false);
  };

  const subtotal = useMemo(
    () =>
      lines.reduce(
        (s, l) => s + l.qty * l.unitSalePrice * (1 - l.discount / 100),
        0,
      ),
    [lines],
  );
  const gstAmt = (subtotal * gstRate) / 100;
  const total = subtotal + gstAmt;

  const setLine = (i: number, patch: Partial<LineItem>) =>
    setLines((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    );

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (i: number) => {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
    // Drop any serial-status entries belonging to this line, and shift
    // down the keys for every line after it so they stay aligned with the
    // new (post-removal) indices.
    setSerialStatus((prev) => {
      const next: Record<string, SerialStatus> = {};
      for (const [key, status] of Object.entries(prev)) {
        const [lineIdxStr, snIdxStr] = key.split("-");
        const lineIdx = Number(lineIdxStr);
        if (lineIdx === i) continue;
        const newLineIdx = lineIdx > i ? lineIdx - 1 : lineIdx;
        next[`${newLineIdx}-${snIdxStr}`] = status;
      }
      return next;
    });
  };

  const onProductSelect = (i: number, p: any) => {
    const qty = lines[i].qty;
    setLine(i, {
      model: p.model,
      itemCode: p.itemCode ?? "",
      hsn: p.hsn ?? "",
      description: p.description ?? "",
      unitSalePrice: p.listPrice ?? 0,
      warranty: p.warranty ? String(p.warranty) : "",
      serialNumbers: Array.from({ length: qty }, () => ""),
    });
    // Model changed — clear stale serial statuses for this line and
    // re-check any serials that are still populated against the new model.
    setSerialStatus((prev) => {
      const next = { ...prev };
      for (let si = 0; si < qty; si++) delete next[`${i}-${si}`];
      return next;
    });
    lines[i].serialNumbers.forEach((serial, si) => {
      if (serial.trim()) checkSerial(i, si, serial, p.model, location);
    });
  };

  const handleQtyChange = (i: number, qty: number) => {
    const safe = Math.max(1, qty);
    const curr = lines[i].serialNumbers;
    const newSN =
      curr.length < safe
        ? [...curr, ...Array.from({ length: safe - curr.length }, () => "")]
        : curr.slice(0, safe);
    setLine(i, { qty: safe, serialNumbers: newSN });
    // Drop status entries for serial slots that no longer exist on this line.
    if (safe < curr.length) {
      setSerialStatus((prev) => {
        const next = { ...prev };
        for (let si = safe; si < curr.length; si++) delete next[`${i}-${si}`];
        return next;
      });
    }
  };

  const handleSerialChange = (lineIdx: number, snIdx: number, val: string) => {
    const sns = [...lines[lineIdx].serialNumbers];
    sns[snIdx] = val;
    setLine(lineIdx, { serialNumbers: sns });

    const key = `${lineIdx}-${snIdx}`;
    if (serialCheckTimers.current[key]) {
      clearTimeout(serialCheckTimers.current[key]);
    }
    // Optimistically clear the old status right away so a stale ✓/✕ badge
    // doesn't linger while the user is still typing.
    setSerialStatus((s) => ({ ...s, [key]: val.trim() ? "checking" : "idle" }));
    serialCheckTimers.current[key] = setTimeout(() => {
      checkSerial(lineIdx, snIdx, val, lines[lineIdx].model, location);
    }, 500);
  };

  // Re-check every populated serial when the dispatch location changes,
  // since a serial valid for Kochi may not be valid for Bangalore.
  useEffect(() => {
    lines.forEach((line, lineIdx) => {
      line.serialNumbers.forEach((serial, snIdx) => {
        if (serial.trim()) {
          checkSerial(lineIdx, snIdx, serial, line.model, location);
        }
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  // Clean up any pending debounce timers on unmount.
  useEffect(() => {
    const timers = serialCheckTimers.current;
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t));
    };
  }, []);

  const hasBlockingSerialIssues = useMemo(
    () =>
      Object.values(serialStatus).some(
        (s) => s === "sold" || s === "not_found" || s === "wrong_model",
      ),
    [serialStatus],
  );

  const handleSave = async () => {
    setCustomerError(false);
    if (!invoiceNum.trim()) {
      setError("Invoice number is required.");
      return;
    }
    if (!customer) {
      setError("Please select or create a customer.");
      setCustomerError(true);
      return;
    }
    setCustomerError(false);
    const validLines = lines.filter(
      (l) => l.model && l.qty > 0 && l.unitSalePrice > 0,
    );
    if (!validLines.length) {
      setError("Add at least one line item with model, qty, and sale price.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice_number: invoiceNum.trim(),
          invoice_date: invoiceDate,
          due_date: dueDate,
          customer_id: customer.id,
          customer_snapshot: customer,
          location,
          line_items: validLines.map((l) => ({
            model: l.model,
            itemCode: l.itemCode,
            hsn: l.hsn,
            description: l.description,
            qty: l.qty,
            unitSalePrice: l.unitSalePrice,
            discount: l.discount,
            serialNumbers: l.serialNumbers.filter((s) => s.trim()),
            warranty: l.warranty,
          })),
          subtotal,
          gst_rate: gstRate,
          gst_amount: gstAmt,
          total,
          notes: notes.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save invoice.");
        return;
      }

      setSuccess(
        `Invoice ${invoiceNum} saved — pending dispatch. Stock updates on dispatch.`,
      );
      setTimeout(() => {
        setSuccess("");
        onSuccess();
      }, 2000);
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  };

  const card: React.CSSProperties = {
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "12px 14px",
  };
  const sectionLabel: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 500,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 10,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <style>{`
        .rs-snfield { width: 100%; font-family: monospace; font-size: 11px !important; padding: 5px 8px !important; }
        .rs-line-grid { display: grid; gap: 8px; align-items: end; }
        @media (max-width: 720px) { .rs-line-grid { grid-template-columns: 1fr 1fr !important; } }
      `}</style>

      {/* ── Import modal ── */}
      {showImport && (
        <InvoiceImport
          mode="sale"
          products={products}
          onImported={handleImported}
          onClose={() => setShowImport(false)}
        />
      )}

      {/* ── Groq scanner modal (free) ── */}
      {showGroqScanner && (
        <GroqSaleScanner
          products={products}
          onExtracted={(data) => {
            handleImported(data);
            setShowGroqScanner(false);
          }}
          onClose={() => setShowGroqScanner(false)}
        />
      )}

      {/* Invoice header */}
      <div style={card}>
        <div
          style={{
            ...sectionLabel,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>Invoice details</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className="btn-ghost"
              style={{
                fontSize: 11,
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
              onClick={() => setShowImport(true)}
              type="button"
            >
              📥 Import Invoice (Claude JSON / Excel)
            </button>
            <button
              className="btn-ghost"
              style={{
                fontSize: 11,
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
              onClick={() => setShowGroqScanner(true)}
              type="button"
            >
              📸 Scan (Groq, free)
            </button>
          </div>
        </div>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
        >
          <FG label="Invoice number">
            <input
              value={invoiceNum}
              onChange={(e) => setInvoiceNum(e.target.value)}
              placeholder="e.g. 2026-2027-KL-025"
            />
          </FG>
          <FG label="Dispatch from">
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            >
              <option>Kochi</option>
              <option>Bangalore</option>
            </select>
          </FG>
          <FG label="Invoice date">
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
            />
          </FG>
          <FG label="Due date">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </FG>
          <FG label="GST rate">
            <select
              value={gstRate}
              onChange={(e) => setGstRate(+e.target.value)}
            >
              <option value={5}>5%</option>
              <option value={12}>12%</option>
              <option value={18}>18%</option>
              <option value={28}>28%</option>
            </select>
          </FG>
          <FG label="Subject / notes">
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Supply of Fluke 101 Digital Multimeter"
            />
          </FG>
        </div>
      </div>

      {/* Customer */}
      <div style={card}>
        <div style={sectionLabel}>Bill to / Ship to</div>
        {importNote && (
          <div
            style={{
              marginBottom: 8,
              padding: "8px 10px",
              borderRadius: 6,
              fontSize: 11,
              background: "rgba(59,130,246,0.08)",
              border: "1px solid rgba(59,130,246,0.3)",
              color: "var(--accent)",
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <span>💡 {importNote}</span>
            <button
              onClick={() => setImportNote("")}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
        )}
        <CustomerSearch
          selected={customer}
          onSelect={(c) => {
            setCustomer(c);
            if (c) setCustomerError(false);
          }}
          hasError={customerError}
        />
      </div>

      {/* Line items */}
      <div style={card}>
        <div
          style={{
            ...sectionLabel,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>Line items</span>
          <button
            className="btn-primary"
            style={{ fontSize: 11, padding: "3px 10px" }}
            onClick={addLine}
          >
            + Add item
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {lines.map((line, i) => {
            const effectivePrice =
              line.unitSalePrice * (1 - line.discount / 100);
            const lineTotal = effectivePrice * line.qty;
            const modelMatched = isModelMatched(products, line.model);
            const suggestions = !modelMatched
              ? findSimilarProducts(products, line.model)
              : [];

            return (
              <div
                key={i}
                style={{
                  background: "var(--bg-input)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "10px 12px",
                }}
              >
                {/* Line header */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                    flexWrap: "wrap",
                    gap: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    Item {i + 1}
                    {line.model && (
                      <span
                        style={{ color: "var(--text-dim)", fontWeight: 400 }}
                      >
                        {" "}
                        · {line.model}
                      </span>
                    )}
                    {line.model && !modelMatched && (
                      <span
                        style={{
                          fontSize: 9,
                          padding: "1px 7px",
                          borderRadius: 99,
                          background: "rgba(245,158,11,0.12)",
                          color: "var(--accent-amber)",
                          fontWeight: 700,
                          textTransform: "none",
                          letterSpacing: 0,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          flexWrap: "wrap",
                        }}
                      >
                        {suggestions.length > 0 ? (
                          <>
                            ⚠ not found — did you mean{" "}
                            {suggestions.map((s, si) => (
                              <span key={s.model}>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onProductSelect(i, s);
                                  }}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    padding: 0,
                                    color: "var(--accent-amber)",
                                    textDecoration: "underline",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                    fontSize: 9,
                                  }}
                                >
                                  {s.model}
                                </button>
                                {si < suggestions.length - 1 ? " or " : "?"}
                              </span>
                            ))}
                          </>
                        ) : (
                          "⚠ not in catalogue"
                        )}
                      </span>
                    )}
                    {line.model && modelMatched && (
                      <span
                        style={{
                          fontSize: 9,
                          padding: "1px 7px",
                          borderRadius: 99,
                          background: "rgba(34,197,94,0.1)",
                          color: "var(--accent-green)",
                          fontWeight: 700,
                          textTransform: "none",
                          letterSpacing: 0,
                        }}
                      >
                        ✓ matched
                      </span>
                    )}
                  </span>
                  {lines.length > 1 && (
                    <button
                      onClick={() => removeLine(i)}
                      style={{
                        background: "transparent",
                        border: "1px solid rgba(239,68,68,0.3)",
                        borderRadius: 4,
                        color: "var(--accent-red)",
                        fontSize: 10,
                        padding: "2px 7px",
                        cursor: "pointer",
                      }}
                    >
                      ✕ Remove
                    </button>
                  )}
                </div>

                {/* Main fields */}
                <div
                  className="rs-line-grid"
                  style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr" }}
                >
                  <FG label="Model / Product">
                    <div
                      style={{
                        borderRadius: 6,
                        boxShadow:
                          line.model && !modelMatched
                            ? "0 0 0 1px rgba(245,158,11,0.5)"
                            : undefined,
                      }}
                    >
                      <ModelCombobox
                        products={products}
                        value={line.model}
                        onSelect={(p) => onProductSelect(i, p)}
                      />
                    </div>
                  </FG>
                  <FG label="HSN code">
                    <input
                      value={line.hsn}
                      onChange={(e) => setLine(i, { hsn: e.target.value })}
                      placeholder="90303100"
                    />
                  </FG>
                  <FG label="Qty">
                    <input
                      type="number"
                      min={1}
                      value={line.qty}
                      onChange={(e) => handleQtyChange(i, +e.target.value || 1)}
                    />
                  </FG>
                  <FG label="Sale price/unit (₹)" note="ex-GST">
                    <input
                      type="number"
                      value={line.unitSalePrice || ""}
                      placeholder="e.g. 3450"
                      onChange={(e) =>
                        setLine(i, { unitSalePrice: +e.target.value || 0 })
                      }
                    />
                  </FG>
                  <FG label="Discount (%)">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={line.discount || ""}
                      placeholder="0"
                      onChange={(e) =>
                        setLine(i, {
                          discount: Math.min(100, +e.target.value || 0),
                        })
                      }
                    />
                  </FG>
                </div>

                {/* Description / warranty */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                    marginTop: 8,
                  }}
                >
                  <FG label="Description">
                    <input
                      value={line.description}
                      onChange={(e) =>
                        setLine(i, { description: e.target.value })
                      }
                      placeholder="e.g. Digital Multimeter"
                    />
                  </FG>
                  <FG label="Warranty">
                    <input
                      value={line.warranty}
                      onChange={(e) => setLine(i, { warranty: e.target.value })}
                      placeholder="e.g. 3 years"
                    />
                  </FG>
                </div>

                {/* Serial numbers — now with live stock verification */}
                {line.qty > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 6,
                        flexWrap: "wrap",
                        gap: 6,
                      }}
                    >
                      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                        Serial numbers — {line.qty} unit
                        {line.qty !== 1 ? "s" : ""}
                        <span style={{ marginLeft: 6, opacity: 0.7 }}>
                          (optional, leave blank if not applicable — entered
                          serials are checked against live stock)
                        </span>
                      </div>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: `repeat(${Math.min(line.qty, 4)}, 1fr)`,
                        gap: 6,
                      }}
                    >
                      {Array.from({ length: line.qty }).map((_, si) => {
                        const key = `${i}-${si}`;
                        const status = serialStatus[key] ?? "idle";
                        const badge =
                          status === "idle" ? null : SERIAL_STATUS_META[status];
                        const isProblem =
                          status === "sold" ||
                          status === "not_found" ||
                          status === "wrong_model";
                        return (
                          <div key={si}>
                            <div
                              style={{
                                fontSize: 9,
                                color: "var(--text-muted)",
                                marginBottom: 2,
                              }}
                            >
                              Unit {si + 1}
                            </div>
                            <input
                              className="rs-snfield"
                              value={line.serialNumbers[si] ?? ""}
                              placeholder="S/N"
                              onChange={(e) =>
                                handleSerialChange(i, si, e.target.value)
                              }
                              style={{
                                borderColor: isProblem
                                  ? "rgba(239,68,68,0.6)"
                                  : status === "in_stock"
                                    ? "rgba(34,197,94,0.5)"
                                    : undefined,
                              }}
                            />
                            {badge && (
                              <div
                                style={{
                                  fontSize: 9,
                                  color: badge.color,
                                  marginTop: 2,
                                  lineHeight: 1.4,
                                }}
                              >
                                {badge.text}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Line total */}
                {line.unitSalePrice > 0 && (
                  <div
                    style={{
                      marginTop: 8,
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 16,
                      fontSize: 11,
                      color: "var(--text-dim)",
                    }}
                  >
                    {line.discount > 0 && (
                      <span>
                        After {line.discount}% disc: ₹{fmt(effectivePrice)}/unit
                      </span>
                    )}
                    <span style={{ fontWeight: 600, color: "var(--text)" }}>
                      Line total (ex-GST): ₹{fmt(lineTotal)}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Totals block */}
        <div
          style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}
        >
          <div
            style={{
              background: "var(--bg-input)",
              borderRadius: 8,
              padding: "10px 16px",
              minWidth: 260,
              display: "flex",
              flexDirection: "column",
              gap: 5,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                color: "var(--text-dim)",
              }}
            >
              <span>Sub total (ex-GST)</span>
              <span>₹{fmt(subtotal)}</span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                color: "var(--text-dim)",
              }}
            >
              <span>GST ({gstRate}%)</span>
              <span>₹{fmt(gstAmt)}</span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 15,
                fontWeight: 700,
                color: "var(--accent-green)",
                borderTop: "1px solid var(--border)",
                paddingTop: 7,
                marginTop: 3,
              }}
            >
              <span>Total (incl. GST)</span>
              <span>₹{fmt(total)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Serial issue warning */}
      {hasBlockingSerialIssues && (
        <div
          style={{
            background: "rgba(239,68,68,0.07)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 12,
            color: "var(--accent-red)",
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
          }}
        >
          <span style={{ fontSize: 16, flexShrink: 0 }}>✕</span>
          <div>
            <div style={{ fontWeight: 600 }}>
              One or more serial numbers look wrong
            </div>
            <div style={{ marginTop: 2, fontSize: 11, opacity: 0.85 }}>
              Some entered serials are already sold, don't exist in any open
              lot, or belong to a different model/location than this line
              claims. Fix or clear them above — this won't block saving, but
              dispatch will fail later if the serial genuinely isn't available.
            </div>
          </div>
        </div>
      )}

      {/* Stock notice */}
      <div
        style={{
          background: "rgba(245,158,11,0.07)",
          border: "1px solid rgba(245,158,11,0.25)",
          borderRadius: 8,
          padding: "10px 14px",
          fontSize: 12,
          color: "var(--accent-amber)",
          display: "flex",
          gap: 8,
          alignItems: "flex-start",
        }}
      >
        <span style={{ fontSize: 16, flexShrink: 0 }}>⚠</span>
        <div>
          <div style={{ fontWeight: 600 }}>Stock will NOT be deducted yet</div>
          <div style={{ marginTop: 2, fontSize: 11, opacity: 0.85 }}>
            Saving marks this invoice as <strong>Pending Dispatch</strong>.
            Stock is deducted from FIFO lots only when you click{" "}
            <strong>Mark as Dispatched</strong> from the dashboard.
          </div>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.3)",
            fontSize: 12,
            color: "var(--accent-red)",
          }}
        >
          {error}
        </div>
      )}
      {success && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            background: "rgba(34,197,94,0.08)",
            border: "1px solid rgba(34,197,94,0.25)",
            fontSize: 12,
            color: "var(--accent-green)",
          }}
        >
          {success}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          className="btn-ghost"
          onClick={() => {
            setLines([emptyLine()]);
            setCustomer(null);
            setNotes("");
            setError("");
            setCustomerError(false);
            setImportNote("");
            setSerialStatus({});
            serialCheckSeq.current = {};
            Object.values(serialCheckTimers.current).forEach((t) =>
              clearTimeout(t),
            );
            serialCheckTimers.current = {};
          }}
        >
          Clear
        </button>
        <button className="btn-primary" onClick={handleSave} disabled={loading}>
          {loading ? "Saving…" : "Save invoice → pending dispatch"}
        </button>
      </div>
    </div>
  );
}
