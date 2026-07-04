// src/components/InvoiceScanner.tsx
// AI Invoice Scanner using Claude claude-sonnet-4-6 via Anthropic API
// Cost: ~₹1.40/scan. Add credits at console.anthropic.com (no monthly fee).
// Env var needed: NEXT_PUBLIC_ANTHROPIC_API_KEY

"use client";
import { useState, useRef, useCallback } from "react";

interface ExtractedLineItem {
  model: string;
  description: string;
  hsn: string;
  qty: number;
  unitPrice: number;
  discount: number;
  total: number;
}

interface ExtractedInvoice {
  invoiceNumber: string;
  invoiceDate: string;
  vendorOrCustomer: string;
  gstin: string;
  poNumber: string;
  lineItems: ExtractedLineItem[];
  subtotal: number;
  gstRate: number;
  gstAmount: number;
  total: number;
  notes: string;
  confidence: "high" | "medium" | "low";
  warnings: string[];
}

interface Props {
  mode: "purchase" | "sale";
  products: any[];
  onExtracted: (data: ExtractedInvoice) => void;
  onClose: () => void;
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export default function InvoiceScanner({
  mode,
  products,
  onExtracted,
  onClose,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedInvoice | null>(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setExtracted(null);
    setError("");
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    if (f.type.startsWith("image/")) {
      reader.readAsDataURL(f);
    } else {
      setPreview("pdf");
    }
  }, []);

  const scanInvoice = async () => {
    if (!file) return;
    setScanning(true);
    setError("");

    const apiKey = process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY;
    if (!apiKey) {
      setError(
        "NEXT_PUBLIC_ANTHROPIC_API_KEY is not set. Add it to .env.local and Vercel environment variables.",
      );
      setScanning(false);
      return;
    }

    // Claude only supports images (not PDF directly in messages API)
    // For PDFs, we show a helpful error asking to screenshot instead
    if (file.type === "application/pdf") {
      setError(
        "PDF not supported directly — please take a screenshot of the invoice and upload that instead.",
      );
      setScanning(false);
      return;
    }

    const productList = products
      .slice(0, 80)
      .map((p) => p.model)
      .join(", ");

    const prompt = `You are an invoice data extractor for TMCI Technology, an authorised Fluke products dealer in India.

Extract ALL data from this ${mode === "purchase" ? "purchase/vendor" : "sales"} invoice image.

Known product models in our catalogue — match extracted names to these exactly where possible:
${productList}

Return ONLY valid JSON. No markdown fences, no explanation, no extra text:
{
  "invoiceNumber": "string",
  "invoiceDate": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD",
  "vendorOrCustomer": "company name",
  "gstin": "GSTIN or empty string",
  "poNumber": "PO number or empty string",
  "lineItems": [
    {
      "model": "matched catalogue model or extracted text",
      "description": "product description",
      "hsn": "HSN code or empty string",
      "qty": 1,
      "unitPrice": 0,
      "discount": 0,
      "total": 0
    }
  ],
  "subtotal": 0,
  "gstRate": 18,
  "gstAmount": 0,
  "total": 0,
  "notes": "the Subject line only",
  "confidence": "high",
  "warnings": []
}

Rules:
- unitPrice = ex-GST price per unit AFTER any discount applied
- If list price + discount% shown separately: unitPrice = listPrice × (1 - discount/100), set discount field to that %
- Match model names to catalogue EXACTLY including case (e.g. "Fluke 289" → "289", "Fluke 59 Mini" → "59 MINI")
- notes = the invoice's "Subject" line ONLY (e.g. "Supply of Fluke Clamp Meter and Multimeter"). Do NOT put vendor details, GST breakdown, or payment terms in notes
- vendorOrCustomer = the "Bill To" party name (the customer), NOT the company issuing the invoice
- gstin = the Bill To party's GSTIN, not the issuer's
- If GST rate not visible assume 18
- All amounts as plain numbers — no ₹ symbol, no commas
- Date as YYYY-MM-DD
- dueDate = the invoice's "Due Date" field; if not shown, use the invoiceDate
- confidence: "high" if scan is clear, "medium" if some fields uncertain, "low" if very blurry`;

    // File → base64
    const toBase64 = (f: File): Promise<string> =>
      new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve((r.result as string).split(",")[1]);
        r.onerror = reject;
        r.readAsDataURL(f);
      });

    let base64: string;
    try {
      base64 = await toBase64(file);
    } catch {
      setError("Could not read the file. Please try again.");
      setScanning(false);
      return;
    }

    // Normalise mime type to what Claude accepts
    let mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" =
      "image/jpeg";
    if (file.type === "image/png") mediaType = "image/png";
    else if (file.type === "image/gif") mediaType = "image/gif";
    else if (file.type === "image/webp") mediaType = "image/webp";

    try {
      const res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-request-header": "true", // required for browser calls
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 2048,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: mediaType,
                    data: base64,
                  },
                },
                {
                  type: "text",
                  text: prompt,
                },
              ],
            },
          ],
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg: string = errBody?.error?.message ?? `HTTP ${res.status}`;

        if (res.status === 401) {
          setError(
            "Invalid API key. Check NEXT_PUBLIC_ANTHROPIC_API_KEY in your environment variables.",
          );
        } else if (res.status === 429) {
          setError("Rate limit hit. Wait a few seconds and try again.");
        } else if (res.status === 400 && msg.includes("credit")) {
          setError(
            "No credits remaining. Add credits at console.anthropic.com.",
          );
        } else {
          setError(`Scan failed: ${msg}`);
        }
        setScanning(false);
        return;
      }

      const data = await res.json();
      const text: string = data?.content?.[0]?.text ?? "";

      if (!text) {
        setError("Empty response. Please try again.");
        setScanning(false);
        return;
      }

      // Strip markdown fences just in case
      const cleaned = text
        .replace(/^```json[\r\n]*/i, "")
        .replace(/^```[\r\n]*/i, "")
        .replace(/[\r\n]*```$/i, "")
        .trim();

      let parsed: ExtractedInvoice;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        setError(
          "AI returned invalid JSON. Try a clearer, straighter photo of the invoice.",
        );
        console.error("[InvoiceScanner] Bad JSON:", cleaned.slice(0, 300));
        setScanning(false);
        return;
      }

      // Normalise all fields
      if (!Array.isArray(parsed.lineItems)) parsed.lineItems = [];
      parsed.lineItems = parsed.lineItems.map((item) => ({
        ...item,
        qty: Number(item.qty) || 1,
        unitPrice: Number(item.unitPrice) || 0,
        discount: Number(item.discount) || 0,
        total:
          Number(item.total) ||
          (Number(item.unitPrice) || 0) * (Number(item.qty) || 1),
      }));
      parsed.subtotal = Number(parsed.subtotal) || 0;
      parsed.gstRate = Number(parsed.gstRate) || 18;
      parsed.gstAmount = Number(parsed.gstAmount) || 0;
      parsed.total = Number(parsed.total) || 0;
      if (!Array.isArray(parsed.warnings)) parsed.warnings = [];

      setExtracted(parsed);
    } catch (networkErr: any) {
      setError(`Network error: ${networkErr.message}`);
    }

    setScanning(false);
  };

  const updateItem = (i: number, field: keyof ExtractedLineItem, val: any) => {
    if (!extracted) return;
    const items = [...extracted.lineItems];
    const updated = { ...items[i], [field]: val };
    if (field === "qty" || field === "unitPrice") {
      updated.total = Number(updated.qty) * Number(updated.unitPrice);
    }
    items[i] = updated;
    setExtracted({ ...extracted, lineItems: items });
  };

  const addItem = () => {
    if (!extracted) return;
    setExtracted({
      ...extracted,
      lineItems: [
        ...extracted.lineItems,
        {
          model: "",
          description: "",
          hsn: "",
          qty: 1,
          unitPrice: 0,
          discount: 0,
          total: 0,
        },
      ],
    });
  };

  const removeItem = (i: number) => {
    if (!extracted) return;
    setExtracted({
      ...extracted,
      lineItems: extracted.lineItems.filter((_, idx) => idx !== i),
    });
  };

  const conf = extracted?.confidence ?? "medium";
  const cs = {
    high: {
      color: "var(--accent-green)",
      bg: "rgba(34,197,94,0.08)",
      border: "rgba(34,197,94,0.25)",
    },
    medium: {
      color: "var(--accent-amber)",
      bg: "rgba(245,158,11,0.08)",
      border: "rgba(245,158,11,0.25)",
    },
    low: {
      color: "var(--accent-red)",
      bg: "rgba(239,68,68,0.08)",
      border: "rgba(239,68,68,0.25)",
    },
  }[conf];

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
          maxWidth: 920,
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
              🤖 AI Invoice Scanner
              <span
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  marginLeft: 8,
                  fontWeight: 400,
                }}
              >
                Claude Sonnet · ~₹1.40/scan
              </span>
            </div>
            <div
              style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}
            >
              Upload a {mode === "purchase" ? "purchase/vendor" : "sales"}{" "}
              invoice image — AI extracts all line items for review
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
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{ flex: 1, overflowY: "auto", display: "flex", minHeight: 0 }}
        >
          {/* Left: upload */}
          <div
            style={{
              width: extracted ? 300 : "100%",
              flexShrink: 0,
              borderRight: extracted ? "1px solid var(--border)" : "none",
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {/* Drop zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files[0];
                if (f) handleFile(f);
              }}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`,
                borderRadius: 10,
                padding: "24px 16px",
                textAlign: "center",
                cursor: "pointer",
                background: dragOver
                  ? "rgba(59,130,246,0.06)"
                  : "var(--bg-input)",
                transition: "all 0.15s",
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
              <div
                style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}
              >
                {file ? file.name : "Drop invoice here or click to browse"}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginTop: 4,
                }}
              >
                PNG · JPG · WEBP · (screenshot PDFs)
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </div>

            {/* Preview */}
            {preview && preview !== "pdf" && (
              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  overflow: "hidden",
                  maxHeight: 260,
                }}
              >
                <img
                  src={preview}
                  alt="Invoice preview"
                  style={{
                    width: "100%",
                    display: "block",
                    objectFit: "contain",
                  }}
                />
              </div>
            )}

            {/* Error */}
            {error && (
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  fontSize: 11,
                  lineHeight: 1.6,
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  color: "var(--accent-red)",
                }}
              >
                {error}
              </div>
            )}

            {/* Scan button */}
            <button
              className="btn-primary"
              onClick={scanInvoice}
              disabled={!file || scanning}
              style={{ fontSize: 13, padding: "10px 16px" }}
            >
              {scanning ? "⏳ Scanning with Claude…" : "⚡ Scan Invoice"}
            </button>

            {/* Setup note */}
            <div
              style={{
                fontSize: 10,
                color: "var(--text-muted)",
                lineHeight: 1.7,
                padding: "8px 10px",
                background: "var(--bg-input)",
                borderRadius: 6,
              }}
            >
              <strong style={{ color: "var(--text-dim)" }}>Setup:</strong> Add{" "}
              <code
                style={{
                  fontSize: 10,
                  background: "var(--bg-card)",
                  padding: "1px 4px",
                  borderRadius: 3,
                }}
              >
                NEXT_PUBLIC_ANTHROPIC_API_KEY
              </code>{" "}
              to Vercel env vars. Get API key at{" "}
              <strong style={{ color: "var(--text-dim)" }}>
                console.anthropic.com
              </strong>
              . Add $5 credits — lasts months at this usage.
            </div>

            <div
              style={{
                fontSize: 10,
                color: "var(--text-muted)",
                lineHeight: 1.7,
                padding: "8px 10px",
                background: "var(--bg-input)",
                borderRadius: 6,
              }}
            >
              <strong style={{ color: "var(--text-dim)" }}>Tips:</strong> Good
              lighting, no glare, all text in frame. For PDFs — take a
              screenshot and upload that.
            </div>
          </div>

          {/* Right: review extracted data */}
          {extracted && (
            <div
              style={{
                flex: 1,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                minWidth: 0,
              }}
            >
              {/* Confidence */}
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: cs.bg,
                  border: `1px solid ${cs.border}`,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{ fontSize: 12, fontWeight: 600, color: cs.color }}
                >
                  {conf === "high" ? "✓" : "⚠"} {conf.toUpperCase()} CONFIDENCE
                </span>
                {extracted.warnings.map((w, i) => (
                  <span
                    key={i}
                    style={{ fontSize: 10, color: "var(--accent-amber)" }}
                  >
                    · {w}
                  </span>
                ))}
              </div>

              {/* Header fields */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                  background: "var(--bg-input)",
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                {(
                  [
                    {
                      label: mode === "purchase" ? "Vendor" : "Customer",
                      key: "vendorOrCustomer",
                    },
                    { label: "Invoice No", key: "invoiceNumber" },
                    { label: "Date (YYYY-MM-DD)", key: "invoiceDate" },
                    { label: "GSTIN", key: "gstin" },
                    { label: "PO / Ref No", key: "poNumber" },
                    { label: "Notes", key: "notes" },
                  ] as const
                ).map(({ label, key }) => (
                  <div key={key}>
                    <label
                      style={{
                        fontSize: 10,
                        color: "var(--text-muted)",
                        display: "block",
                        marginBottom: 2,
                      }}
                    >
                      {label}
                    </label>
                    <input
                      value={(extracted as any)[key] ?? ""}
                      onChange={(e) =>
                        setExtracted({
                          ...extracted,
                          [key]: e.target.value,
                        } as ExtractedInvoice)
                      }
                      style={{ fontSize: 12 }}
                    />
                  </div>
                ))}
              </div>

              {/* Line items */}
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Line Items ({extracted.lineItems.length})
                  </div>
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 11, padding: "3px 10px" }}
                    onClick={addItem}
                  >
                    + Add row
                  </button>
                </div>

                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ minWidth: 660 }}>
                      <thead>
                        <tr>
                          <th style={{ minWidth: 130 }}>Model</th>
                          <th style={{ minWidth: 80 }}>HSN</th>
                          <th style={{ textAlign: "right", width: 55 }}>Qty</th>
                          <th style={{ textAlign: "right", width: 110 }}>
                            Unit Price ₹
                          </th>
                          <th style={{ textAlign: "right", width: 65 }}>
                            Disc %
                          </th>
                          <th style={{ textAlign: "right", width: 100 }}>
                            Total ₹
                          </th>
                          <th style={{ width: 30 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {extracted.lineItems.map((item, i) => {
                          const unmatched =
                            item.model &&
                            !products.find(
                              (p) =>
                                p.model.toLowerCase() ===
                                item.model.toLowerCase(),
                            );
                          return (
                            <tr
                              key={i}
                              style={{
                                background: unmatched
                                  ? "rgba(245,158,11,0.04)"
                                  : "transparent",
                              }}
                            >
                              <td>
                                <input
                                  value={item.model}
                                  onChange={(e) =>
                                    updateItem(i, "model", e.target.value)
                                  }
                                  list="scanner-model-list"
                                  placeholder="Model name"
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 500,
                                    borderColor: unmatched
                                      ? "rgba(245,158,11,0.5)"
                                      : undefined,
                                  }}
                                />
                              </td>
                              <td>
                                <input
                                  value={item.hsn}
                                  onChange={(e) =>
                                    updateItem(i, "hsn", e.target.value)
                                  }
                                  placeholder="HSN"
                                  style={{ fontSize: 11 }}
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min={1}
                                  value={item.qty}
                                  onChange={(e) =>
                                    updateItem(i, "qty", +e.target.value || 1)
                                  }
                                  style={{ textAlign: "right", fontSize: 12 }}
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min={0}
                                  value={item.unitPrice}
                                  onChange={(e) =>
                                    updateItem(
                                      i,
                                      "unitPrice",
                                      +e.target.value || 0,
                                    )
                                  }
                                  style={{ textAlign: "right", fontSize: 12 }}
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={item.discount}
                                  onChange={(e) =>
                                    updateItem(
                                      i,
                                      "discount",
                                      +e.target.value || 0,
                                    )
                                  }
                                  style={{ textAlign: "right", fontSize: 12 }}
                                />
                              </td>
                              <td
                                style={{
                                  textAlign: "right",
                                  fontWeight: 500,
                                  fontSize: 12,
                                  padding: "6px 10px",
                                }}
                              >
                                ₹
                                {item.total.toLocaleString("en-IN", {
                                  maximumFractionDigits: 0,
                                })}
                              </td>
                              <td>
                                <button
                                  onClick={() => removeItem(i)}
                                  style={{
                                    background: "transparent",
                                    border: "none",
                                    color: "var(--accent-red)",
                                    cursor: "pointer",
                                    fontSize: 14,
                                    padding: "0 4px",
                                  }}
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <datalist id="scanner-model-list">
                      {products.map((p) => (
                        <option key={p.model} value={p.model} />
                      ))}
                    </datalist>
                  </div>
                </div>

                {extracted.lineItems.some(
                  (item) =>
                    item.model &&
                    !products.find(
                      (p) => p.model.toLowerCase() === item.model.toLowerCase(),
                    ),
                ) && (
                  <div
                    style={{
                      marginTop: 6,
                      padding: "7px 10px",
                      borderRadius: 6,
                      fontSize: 11,
                      background: "rgba(245,158,11,0.07)",
                      border: "1px solid rgba(245,158,11,0.25)",
                      color: "var(--accent-amber)",
                    }}
                  >
                    ⚠ Highlighted models don't exactly match your catalogue —
                    fix them above before confirming.
                  </div>
                )}
              </div>

              {/* Totals */}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <div
                  style={{
                    background: "var(--bg-input)",
                    borderRadius: 8,
                    padding: "10px 14px",
                    minWidth: 240,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
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
                    <span>Sub-total (ex-GST)</span>
                    <span>
                      ₹
                      {extracted.subtotal.toLocaleString("en-IN", {
                        maximumFractionDigits: 0,
                      })}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 12,
                      color: "var(--text-dim)",
                    }}
                  >
                    <span>GST ({extracted.gstRate}%)</span>
                    <span>
                      ₹
                      {extracted.gstAmount.toLocaleString("en-IN", {
                        maximumFractionDigits: 0,
                      })}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 15,
                      fontWeight: 700,
                      color: "var(--accent-green)",
                      borderTop: "1px solid var(--border)",
                      paddingTop: 6,
                      marginTop: 2,
                    }}
                  >
                    <span>Total (incl. GST)</span>
                    <span>
                      ₹
                      {extracted.total.toLocaleString("en-IN", {
                        maximumFractionDigits: 0,
                      })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Confirm */}
              <button
                className="btn-primary"
                onClick={() => onExtracted(extracted)}
                disabled={extracted.lineItems.length === 0}
                style={{
                  fontSize: 13,
                  padding: "10px 16px",
                  background: "var(--accent-green)",
                }}
              >
                ✓ Use this data → fill{" "}
                {mode === "purchase" ? "Purchase" : "Sale"} form
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
