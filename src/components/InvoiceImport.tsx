// src/components/InvoiceImport.tsx
// Zero-cost invoice import:
//   1. Copy the prompt → paste into claude.ai with your invoice PDF/image/Zoho link
//   2. Claude returns JSON → paste it here → form auto-fills
//   3. Or upload an Excel file (.xlsx) with the invoice line items
// No API key needed.

"use client";
import { useState, useRef } from "react";
import * as XLSX from "xlsx";

export interface ImportedLineItem {
  model: string;
  description?: string;
  hsn?: string;
  qty: number;
  unitPrice: number;
  discount?: number;
  total?: number;
  serialNumbers?: string;
}

export interface ImportedInvoice {
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  vendorOrCustomer?: string;
  gstin?: string;
  poNumber?: string;
  lineItems: ImportedLineItem[];
  subtotal?: number;
  gstRate?: number;
  gstAmount?: number;
  total?: number;
  notes?: string;
}

interface Props {
  mode: "purchase" | "sale";
  products: any[];
  onImported: (data: ImportedInvoice) => void;
  onClose: () => void;
}

const buildPrompt = (
  mode: "purchase" | "sale",
  productList: string,
) => `Extract all data from this ${mode === "purchase" ? "purchase/vendor" : "sales"} invoice (image, PDF, or link).

Our product catalogue — match model names to these EXACTLY:
${productList}

Return ONLY this JSON (no explanation, no markdown fences):
{
  "invoiceNumber": "",
  "invoiceDate": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD",
  "vendorOrCustomer": "",
  "gstin": "",
  "poNumber": "",
  "lineItems": [
    {
      "model": "",
      "description": "",
      "hsn": "",
      "qty": 0,
      "unitPrice": 0,
      "discount": 0,
      "total": 0,
      "serialNumbers": ""
    }
  ],
  "subtotal": 0,
  "gstRate": 18,
  "gstAmount": 0,
  "total": 0,
  "notes": ""
}

Rules:
- unitPrice = ex-GST rate per unit shown on the invoice
- Strip "Fluke" prefix from model names (e.g. "Fluke 101" → "101", "Fluke 59 Mini" → "59 MINI")
- Model names must match the catalogue EXACTLY including case (e.g. "59 MINI" not "59 Mini")
- serialNumbers: comma-separated if listed (e.g. "72690288WS, 72690287WS")
- notes = the invoice's "Subject" line ONLY (e.g. "Supply of Fluke Clamp Meter and Multimeter"). Do NOT put vendor details, GST breakdown, or payment terms in notes.
- vendorOrCustomer = the "Bill To" party name (the customer), NOT the company issuing the invoice
- gstin = the Bill To party's GSTIN, not the issuer's
- All amounts as plain numbers, no commas or ₹ symbols
- Date as YYYY-MM-DD
- dueDate = the invoice's "Due Date" field; if not shown, use the invoiceDate`;

export default function InvoiceImport({
  mode,
  products,
  onImported,
  onClose,
}: Props) {
  const [tab, setTab] = useState<"json" | "excel">("json");
  const [jsonText, setJsonText] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const productList = products
    .slice(0, 100)
    .map((p) => p.model)
    .join(", ");
  const prompt = buildPrompt(mode, productList);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement("textarea");
      ta.value = prompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // ── Parse pasted JSON ──────────────────────────────────────────────────────
  const handleJsonImport = () => {
    setError("");
    if (!jsonText.trim()) {
      setError("Paste the JSON first.");
      return;
    }

    // Strip markdown fences if user copied them from Claude
    const cleaned = jsonText
      .replace(/^```json[\r\n]*/im, "")
      .replace(/^```[\r\n]*/im, "")
      .replace(/[\r\n]*```\s*$/im, "")
      .trim();

    let parsed: ImportedInvoice;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e: any) {
      setError(
        `Invalid JSON: ${e.message}. Make sure you copied the complete JSON from Claude.`,
      );
      return;
    }

    if (!Array.isArray(parsed.lineItems) || parsed.lineItems.length === 0) {
      setError(
        "JSON has no lineItems array. Copy the complete JSON output from Claude.",
      );
      return;
    }

    // Normalise numbers
    parsed.lineItems = parsed.lineItems.map((item) => ({
      ...item,
      qty: Number(item.qty) || 1,
      unitPrice: Number(item.unitPrice) || 0,
      discount: Number(item.discount) || 0,
      total:
        Number(item.total) ||
        (Number(item.unitPrice) || 0) * (Number(item.qty) || 1),
    }));

    onImported(parsed);
  };

  // ── Parse Excel upload ─────────────────────────────────────────────────────
  const handleExcelFile = async (file: File) => {
    setError("");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

      if (rows.length === 0) {
        setError("Excel sheet is empty.");
        return;
      }

      // Map columns flexibly — accept common header variations
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const findCol = (row: any, ...names: string[]) => {
        for (const key of Object.keys(row)) {
          if (names.some((n) => norm(key).includes(norm(n)))) return row[key];
        }
        return "";
      };

      const lineItems: ImportedLineItem[] = rows
        .map((row) => {
          const model = String(
            findCol(row, "model", "item", "product", "description") || "",
          ).trim();
          const qty = Number(findCol(row, "qty", "quantity", "pcs")) || 0;
          const unitPrice =
            Number(findCol(row, "rate", "unitprice", "price", "unit")) || 0;
          const hsn = String(findCol(row, "hsn", "sac") || "").trim();
          const discount = Number(findCol(row, "discount", "disc")) || 0;
          const total =
            Number(findCol(row, "total", "amount")) || qty * unitPrice;
          const serialNumbers = String(
            findCol(row, "serial", "sno", "sn") || "",
          ).trim();
          return { model, hsn, qty, unitPrice, discount, total, serialNumbers };
        })
        .filter((item) => item.model && item.qty > 0);

      if (lineItems.length === 0) {
        setError(
          "No valid rows found. Excel needs columns like: Model, Qty, Rate (or Unit Price). " +
            "Optional: HSN, Discount, Total, Serial Numbers.",
        );
        return;
      }

      onImported({ lineItems });
    } catch (e: any) {
      setError(`Could not read Excel: ${e.message}`);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.82)",
        zIndex: 200,
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
          width: "100%",
          maxWidth: 720,
          maxHeight: "95vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              📥 Import Invoice Data
            </div>
            <div
              style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}
            >
              Zero cost — use Claude.ai to extract, paste JSON here. Or upload
              Excel.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 22,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {/* ── Step 1: Copy prompt ── */}
          <div
            style={{
              background: "var(--bg-input)",
              borderRadius: 10,
              padding: 14,
              border: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <div
                style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}
              >
                Step 1 — Copy this prompt
              </div>
              <button
                className="btn-primary"
                style={{
                  fontSize: 12,
                  padding: "6px 14px",
                  background: copied ? "var(--accent-green)" : undefined,
                }}
                onClick={copyPrompt}
              >
                {copied ? "✓ Copied!" : "📋 Copy Prompt"}
              </button>
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-dim)",
                lineHeight: 1.7,
              }}
            >
              1. Click <strong>Copy Prompt</strong> above
              <br />
              2. Open <strong>claude.ai</strong> → new chat
              <br />
              3. Attach your invoice (PDF / photo / screenshot) or paste the
              Zoho link
              <br />
              4. Paste the prompt and send
              <br />
              5. Copy the JSON Claude returns → paste in Step 2 below
            </div>
            {/* Collapsed preview of prompt */}
            <details style={{ marginTop: 8 }}>
              <summary
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  cursor: "pointer",
                }}
              >
                Preview prompt
              </summary>
              <pre
                style={{
                  fontSize: 9.5,
                  color: "var(--text-muted)",
                  whiteSpace: "pre-wrap",
                  marginTop: 6,
                  maxHeight: 160,
                  overflowY: "auto",
                  background: "var(--bg-card)",
                  padding: 8,
                  borderRadius: 6,
                }}
              >
                {prompt}
              </pre>
            </details>
          </div>

          {/* ── Step 2: tabs ── */}
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--text)",
                marginBottom: 8,
              }}
            >
              Step 2 — Import the data
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <button
                className={tab === "json" ? "btn-primary" : "btn-ghost"}
                style={{ fontSize: 12, padding: "6px 14px" }}
                onClick={() => {
                  setTab("json");
                  setError("");
                }}
              >
                📋 Paste JSON
              </button>
              <button
                className={tab === "excel" ? "btn-primary" : "btn-ghost"}
                style={{ fontSize: 12, padding: "6px 14px" }}
                onClick={() => {
                  setTab("excel");
                  setError("");
                }}
              >
                📊 Upload Excel
              </button>
            </div>

            {tab === "json" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <textarea
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                  placeholder={
                    'Paste the JSON from Claude here…\n\n{\n  "invoiceNumber": "2026-2027-KL-028",\n  "lineItems": [...]\n}'
                  }
                  style={{
                    width: "100%",
                    minHeight: 180,
                    fontSize: 11.5,
                    fontFamily: "ui-monospace, monospace",
                    background: "var(--bg-input)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: 10,
                    color: "var(--text)",
                    resize: "vertical",
                  }}
                />
                <button
                  className="btn-primary"
                  style={{
                    fontSize: 13,
                    padding: "9px 16px",
                    background: "var(--accent-green)",
                  }}
                  onClick={handleJsonImport}
                >
                  ✓ Import JSON → fill form
                </button>
              </div>
            )}

            {tab === "excel" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div
                  onClick={() => fileRef.current?.click()}
                  style={{
                    border: "2px dashed var(--border)",
                    borderRadius: 10,
                    padding: "26px 16px",
                    textAlign: "center",
                    cursor: "pointer",
                    background: "var(--bg-input)",
                  }}
                >
                  <div style={{ fontSize: 30, marginBottom: 6 }}>📊</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    Click to upload .xlsx / .xls / .csv
                  </div>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: "var(--text-muted)",
                      marginTop: 6,
                      lineHeight: 1.6,
                    }}
                  >
                    Required columns: <strong>Model, Qty, Rate</strong>
                    <br />
                    Optional: HSN, Discount, Total, Serial Numbers
                    <br />
                    Column names are matched flexibly — "Unit Price", "Rate",
                    "Price" all work
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleExcelFile(f);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {error && (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                fontSize: 11.5,
                lineHeight: 1.6,
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.3)",
                color: "var(--accent-red)",
              }}
            >
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
