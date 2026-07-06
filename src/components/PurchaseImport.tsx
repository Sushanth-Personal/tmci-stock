// src/components/PurchaseImport.tsx
// Zero-cost BULK purchase bill import — mirrors InvoiceImport.tsx but for purchases.
//   1. Copy the prompt → paste into claude.ai with your vendor invoice/PO PDF or image
//   2. Claude returns JSON → paste it here → ALL line items populate in RecordPurchase
//   3. Or upload an Excel file (.xlsx) with the purchase line items
// No API key needed — uses your existing claude.ai access.

"use client";
import { useState, useRef } from "react";
import * as XLSX from "xlsx";

export interface ImportedPurchaseLineItem {
  model: string;
  description?: string;
  hsn?: string;
  qty: number;
  listPrice?: number;
  unitPrice: number; // final price paid per unit, ex-GST, after all discounts
  discountPct?: number; // total discount % if derivable, else 0
  total?: number;
  serialNumbers?: string;
}

export interface ImportedPurchaseBill {
  poNumber?: string;
  invoiceNumber?: string; // vendor's invoice/bill number
  invoiceDate?: string;
  vendor?: string;
  location?: "Kochi" | "Bangalore";
  lineItems: ImportedPurchaseLineItem[];
  subtotal?: number;
  gstRate?: number;
  gstAmount?: number;
  total?: number;
  courierCharges?: number;
  notes?: string;
}

interface Props {
  products: any[];
  onImported: (data: ImportedPurchaseBill) => void;
  onClose: () => void;
}

const buildPurchasePrompt = (
  productList: string,
) => `Extract all data from this purchase bill / vendor invoice / PO (image, PDF, or link).

Our product catalogue — match model names to these EXACTLY (including case):
${productList}

Return ONLY this JSON (no explanation, no markdown fences):
{
  "poNumber": "",
  "invoiceNumber": "",
  "invoiceDate": "YYYY-MM-DD",
  "vendor": "",
  "location": "Kochi",
  "lineItems": [
    {
      "model": "",
      "description": "",
      "hsn": "",
      "qty": 0,
      "listPrice": 0,
      "unitPrice": 0,
      "discountPct": 0,
      "total": 0,
      "serialNumbers": ""
    }
  ],
  "subtotal": 0,
  "gstRate": 18,
  "gstAmount": 0,
  "total": 0,
  "courierCharges": 0,
  "notes": ""
}

Rules:
- unitPrice = the FINAL ex-GST price actually paid per unit (after any discount applied)
- listPrice = the original list/MRP price before discount, if shown separately (else same as unitPrice)
- discountPct = the discount % applied, derived from (listPrice - unitPrice) / listPrice × 100 if not stated directly
- Strip "Fluke" prefix from model names (e.g. "Fluke 101" → "101", "Fluke 59 Mini" → "59 MINI")
- Model names must match the catalogue EXACTLY including case (e.g. "59 MINI" not "59 Mini", "302+" not "302 +")
- vendor = the SELLER/supplier issuing this bill (NOT us, TMCI Technology) — the company we are BUYING from
- location = which of our warehouses received the stock: "Kochi" or "Bangalore" (default "Kochi" if unclear)
- serialNumbers: comma-separated if listed on the bill (e.g. "72690288WS, 72690287WS")
- notes = the bill's subject/description line only, not vendor details or payment terms
- courierCharges = any shipping/freight/courier charge shown separately (0 if none)
- All amounts as plain numbers, no commas or ₹ symbols
- Date as YYYY-MM-DD`;

export default function PurchaseImport({
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
  const prompt = buildPurchasePrompt(productList);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
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

  const handleJsonImport = () => {
    setError("");
    if (!jsonText.trim()) {
      setError("Paste the JSON first.");
      return;
    }

    const cleaned = jsonText
      .replace(/^```json[\r\n]*/im, "")
      .replace(/^```[\r\n]*/im, "")
      .replace(/[\r\n]*```\s*$/im, "")
      .trim();

    let parsed: ImportedPurchaseBill;
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

    parsed.lineItems = parsed.lineItems.map((item) => ({
      ...item,
      qty: Number(item.qty) || 1,
      listPrice: Number(item.listPrice) || Number(item.unitPrice) || 0,
      unitPrice: Number(item.unitPrice) || 0,
      discountPct: Number(item.discountPct) || 0,
      total:
        Number(item.total) ||
        (Number(item.unitPrice) || 0) * (Number(item.qty) || 1),
    }));

    onImported(parsed);
  };

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

      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const findCol = (row: any, ...names: string[]) => {
        for (const key of Object.keys(row)) {
          if (names.some((n) => norm(key).includes(norm(n)))) return row[key];
        }
        return "";
      };

      const lineItems: ImportedPurchaseLineItem[] = rows
        .map((row) => {
          const model = String(
            findCol(row, "model", "item", "product", "description") || "",
          ).trim();
          const qty = Number(findCol(row, "qty", "quantity", "pcs")) || 0;
          const listPrice = Number(findCol(row, "listprice", "mrp")) || 0;
          const unitPrice =
            Number(
              findCol(row, "rate", "unitprice", "price", "unit", "netrate"),
            ) || listPrice;
          const hsn = String(findCol(row, "hsn", "sac") || "").trim();
          const discountPct = Number(findCol(row, "discount", "disc")) || 0;
          const total =
            Number(findCol(row, "total", "amount")) || qty * unitPrice;
          const serialNumbers = String(
            findCol(row, "serial", "sno", "sn") || "",
          ).trim();
          return {
            model,
            hsn,
            qty,
            listPrice: listPrice || unitPrice,
            unitPrice,
            discountPct,
            total,
            serialNumbers,
          };
        })
        .filter((item) => item.model && item.qty > 0);

      if (lineItems.length === 0) {
        setError(
          "No valid rows found. Excel needs columns like: Model, Qty, Rate (or Unit Price). " +
            "Optional: HSN, List Price, Discount, Total, Serial Numbers.",
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
              📥 Import Purchase Bill
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
          {/* Step 1 */}
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
              3. Attach the vendor's bill / PO (PDF / photo / screenshot)
              <br />
              4. Paste the prompt and send
              <br />
              5. Copy the JSON Claude returns → paste in Step 2 below
            </div>
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

          {/* Step 2 */}
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
                    'Paste the JSON from Claude here…\n\n{\n  "vendor": "Shreyans Enterprises",\n  "lineItems": [...]\n}'
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
                    Optional: HSN, List Price, Discount, Total, Serial Numbers
                    <br />
                    Column names are matched flexibly — "Unit Price", "Rate",
                    "Net Rate" all work
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
