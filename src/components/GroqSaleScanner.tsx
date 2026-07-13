// src/components/GroqSaleScanner.tsx
//
// Free (Groq API) scanner for SALES invoices — e.g. a screenshot/PDF-export
// of a Zoho Books invoice, or any other vendor/customer invoice photo.
// Same pattern as GroqPurchaseScanner.tsx, adapted for the sale side:
//   - Output shape matches ImportedInvoice (from InvoiceImport.tsx), so it
//     plugs straight into RecordSale.tsx's existing handleImported() — no
//     changes needed to that logic.
//   - Same item-code/HSN verification against Supabase before confirming.
//
// MODEL NOTE (July 2026): using qwen/qwen3.6-27b — Groq's current
// vision-capable model after llama-4-scout was deprecated. Check
// https://console.groq.com/docs/vision if this starts failing with a
// "model decommissioned" error.

"use client";
import { useState, useRef, useCallback, useMemo } from "react";
import type { ImportedInvoice } from "@/components/InvoiceImport";
import { pdfFileToImageFile, getPdfPageCount } from "@/lib/pdfToImage";

const GROQ_VISION_MODEL = "qwen/qwen3.6-27b";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

interface ExtractedLineItem {
  model: string;
  description: string;
  hsn: string;
  itemCode: string;
  qty: number;
  unitPrice: number;
  discount: number;
  total: number;
  serialNumbers: string;
}

interface ExtractedInvoice extends ImportedInvoice {
  confidence: "high" | "medium" | "low";
  warnings: string[];
}

interface CodeCheck {
  model: string;
  matchedProduct: any | null;
  itemCode: {
    scanned: string;
    existing: string;
    status: "new" | "match" | "conflict";
  } | null;
  hsn: {
    scanned: string;
    existing: string;
    status: "new" | "match" | "conflict";
  } | null;
}

interface Props {
  products: any[];
  onExtracted: (data: ImportedInvoice) => void;
  onClose: () => void;
}

// ─── Generic "did you mean" matching (same logic as RecordSale.tsx) ───────
// No hardcoded aliases — finds the closest existing catalogue model(s) to
// whatever the scanner extracted, so any naming mismatch (renamed SKU,
// OCR slip, bare/ambiguous name that got split into -01/-02 variants,
// etc.) gets a helpful nudge instead of a silent "not in catalogue".

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

// Returns the catalogue product(s) most likely to be what was meant,
// or [] if nothing is close enough to be worth suggesting.
function findSimilarProducts(products: any[], typed: string, max = 2): any[] {
  const query = normForMatch(typed);
  if (!query) return [];

  const scored = products.map((p) => {
    const cand = normForMatch(p.model);
    let score: number;

    // Exact normalized match (only punctuation/case differed) — near-perfect.
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

// ─── Serial-number-embedded-in-description recovery ────────────────────────
// The AI model is told to split serials into their own field, but sometimes
// lumps them into the description instead, e.g.:
//   "Phase Rotation Indicator S/N :72830364WS"
// This regex catches "S/N", "S no", "S.No" etc. with any spacing/colon
// placement, and pulls the trailing serial(s) out into serialNumbers.
const SERIAL_SUFFIX_RE =
  /S\s*[\/.]?\s*(?:no\.?|n)\.?\s*:?\s*([A-Za-z0-9,&\s]+)$/i;

function extractSerialFromDescription(
  description: string,
  existingSerials: string,
): { description: string; serialNumbers: string } {
  // Already has serials (from the model or Zoho's own JSON) — leave as-is.
  if (existingSerials && existingSerials.trim()) {
    return { description, serialNumbers: existingSerials };
  }
  const match = description.match(SERIAL_SUFFIX_RE);
  if (!match || match.index === undefined) {
    return { description, serialNumbers: existingSerials };
  }
  const extracted = match[1]
    .split(/[,&]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
  if (!extracted) return { description, serialNumbers: existingSerials };
  const cleanedDescription = description.slice(0, match.index).trim();
  return { description: cleanedDescription, serialNumbers: extracted };
}

export default function GroqSaleScanner({
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

  const [resolutions, setResolutions] = useState<
    Record<
      string,
      { itemCode?: "scanned" | "existing"; hsn?: "scanned" | "existing" }
    >
  >({});
  const [applyingCodes, setApplyingCodes] = useState(false);
  const [converting, setConverting] = useState(false);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  // ── Best-effort Zoho link import (see /api/scan-zoho-link for caveats) ──
  const [zohoUrl, setZohoUrl] = useState("");
  const [linkFetching, setLinkFetching] = useState(false);
  const [linkResult, setLinkResult] = useState<{
    success: boolean;
    structuredDataFound: boolean;
    message: string;
    meta?: Record<string, string>;
    rawEmbeddedData?: any[];
  } | null>(null);

  const tryZohoLink = async () => {
    if (!zohoUrl.trim()) return;
    setLinkFetching(true);
    setLinkResult(null);
    setError("");
    try {
      const res = await fetch("/api/scan-zoho-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: zohoUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not fetch that link.");
        setLinkFetching(false);
        return;
      }

      // If the route recognised Zoho's actual invoice JSON shape, this is
      // EXACT data (not AI-guessed) — route it straight into the same
      // review table as an image scan, with high confidence and no
      // warnings, since there's no OCR uncertainty involved.
      if (data.matchedInvoice) {
        const inv = data.matchedInvoice;
        const lineItems = (inv.lineItems ?? []).map((li: any) => {
          const { description, serialNumbers } = extractSerialFromDescription(
            li.description ?? "",
            String(li.serialNumbers ?? ""),
          );
          return {
            model: li.model ?? "",
            description,
            hsn: li.hsn ?? "",
            itemCode: li.itemCode ?? "",
            qty: Number(li.qty) || 1,
            unitPrice: Number(li.unitPrice) || 0,
            discount: Number(li.discount) || 0,
            total:
              Number(li.total) ||
              (Number(li.unitPrice) || 0) * (Number(li.qty) || 1),
            serialNumbers,
          };
        });

        setExtracted({
          invoiceNumber: inv.invoiceNumber ?? "",
          invoiceDate: inv.invoiceDate ?? "",
          dueDate: inv.dueDate ?? "",
          vendorOrCustomer: inv.vendorOrCustomer ?? "",
          gstin: inv.gstin ?? "",
          poNumber: inv.poNumber ?? "",
          lineItems,
          subtotal: inv.subtotal ?? 0,
          gstRate: inv.gstRate ?? 18,
          gstAmount: inv.gstAmount ?? 0,
          total: inv.total ?? 0,
          notes: inv.notes ?? "",
          confidence: "high",
          warnings: [
            "Pulled directly from Zoho's own data — no OCR guessing involved.",
          ],
        });
        setLinkFetching(false);
        return;
      }

      setLinkResult(data);
    } catch (e: any) {
      setError(`Network error: ${e.message}`);
    }
    setLinkFetching(false);
  };

  const handleFile = useCallback(async (f: File) => {
    setExtracted(null);
    setError("");
    setPdfPageCount(null);

    if (f.type === "application/pdf") {
      setConverting(true);
      try {
        const pageCount = await getPdfPageCount(f);
        setPdfPageCount(pageCount);
        if (pageCount > 1) {
          setError(
            `This PDF has ${pageCount} pages — only page 1 will be scanned. ` +
              `If the invoice is on a different page, split the PDF first or screenshot that page instead.`,
          );
        }
        const imageFile = await pdfFileToImageFile(f, { pageNumber: 1 });
        setFile(imageFile);
        const reader = new FileReader();
        reader.onload = (e) => setPreview(e.target?.result as string);
        reader.readAsDataURL(imageFile);
      } catch (err: any) {
        setError(`Could not convert PDF: ${err.message}`);
      } finally {
        setConverting(false);
      }
      return;
    }

    setFile(f);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(f);
  }, []);

  const scanInvoice = async () => {
    if (!file) return;
    setScanning(true);
    setError("");

    const apiKey = process.env.NEXT_PUBLIC_GROQ_API_KEY;
    if (!apiKey) {
      setError(
        "NEXT_PUBLIC_GROQ_API_KEY is not set. Get a free key at console.groq.com/keys and add it to .env.local and your Vercel environment variables.",
      );
      setScanning(false);
      return;
    }

    const productList = products
      .slice(0, 100)
      .map((p) => `${p.model} (₹${p.listPrice})`)
      .join(", ");

    const prompt = `Extract all data from this sales invoice image for TMCI Technology, an authorised Fluke products dealer in India. This may be a screenshot or PDF export of an invoice from Zoho Books or a similar system.

Our product catalogue — match extracted model names to these EXACTLY (including case), model: list price:
${productList}

CRITICAL — use list price to cross-check your model match:
Each catalogue entry shows its list price in brackets. If the invoice shows a "rate" close to one of
these list prices (or a reasonable discount off it), use that to confirm you've matched the right model —
do not guess a model based on surface similarity of the item name alone.

Return ONLY this JSON object, no other text:
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
      "itemCode": "",
      "qty": 1,
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
  "notes": "",
  "confidence": "high",
  "warnings": []
}

Rules:
- unitPrice = the ex-GST rate per unit actually charged, shown in the invoice's rate/price column
- discount = discount % applied, if shown or derivable; 0 if none
- itemCode = any internal item/SKU code shown near the line item (in parentheses, a separate code
  column, etc.) — leave empty string if none is shown
- qty = read directly from the Qty column; sanity-check against Taxable Amount ÷ Rate
- Double-check every digit of unitPrice — Fluke test equipment prices are almost always between
  ₹2,000 and ₹1,60,000. Re-read any price that looks like it's missing a digit.
- Strip "Fluke" prefix from model names (e.g. "Fluke 101" -> "101", "Fluke 59 Mini" -> "59 MINI")
- Model names must match the catalogue EXACTLY including case
- vendorOrCustomer = the "Bill To" party's name (the CUSTOMER being billed), NOT TMCI Technology
- gstin = the Bill To party's GSTIN, not the issuer's
- poNumber = any PO/reference number shown, else empty string
- notes = the invoice's subject/description line only, not payment terms or address details
- serialNumbers = comma-separated if listed, else empty string
- dueDate = the invoice's due date; if not shown, use invoiceDate
- All amounts as plain numbers, no commas or currency symbols
- Date as YYYY-MM-DD
- confidence: "high" if every model matched cleanly, "medium" if 1-2 were uncertain, "low" if several
  models could not be confidently matched
- warnings: list any line item you weren't fully confident about, quoting the raw text and your guess`;

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

    let mediaType = "image/jpeg";
    if (file.type === "image/png") mediaType = "image/png";
    else if (file.type === "image/webp") mediaType = "image/webp";
    else if (file.type === "image/gif") mediaType = "image/gif";

    try {
      const res = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: GROQ_VISION_MODEL,
          response_format: { type: "json_object" },
          // Required whenever json_object mode is combined with a reasoning
          // model — otherwise <think> tokens leak into the output and break
          // JSON validation. See GroqPurchaseScanner.tsx for the same fix.
          reasoning_effort: "none",
          reasoning_format: "hidden",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mediaType};base64,${base64}`,
                  },
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
            "Invalid API key. Check NEXT_PUBLIC_GROQ_API_KEY in your environment variables.",
          );
        } else if (res.status === 429) {
          setError(
            "Rate limit hit on Groq's free tier. Wait a few seconds and try again.",
          );
        } else if (msg.toLowerCase().includes("decommission")) {
          setError(
            `Model "${GROQ_VISION_MODEL}" has been retired by Groq. Check console.groq.com/docs/vision for the current vision model and update GROQ_VISION_MODEL in GroqSaleScanner.tsx.`,
          );
        } else {
          setError(`Scan failed: ${msg}`);
        }
        setScanning(false);
        return;
      }

      const data = await res.json();
      const text: string = data?.choices?.[0]?.message?.content ?? "";

      if (!text) {
        setError("Empty response. Please try again.");
        setScanning(false);
        return;
      }

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
        console.error("[GroqSaleScanner] Bad JSON:", cleaned.slice(0, 300));
        setScanning(false);
        return;
      }

      if (!Array.isArray(parsed.lineItems)) parsed.lineItems = [];
      parsed.lineItems = parsed.lineItems.map((item: any) => {
        const { description, serialNumbers } = extractSerialFromDescription(
          item.description ?? "",
          String(item.serialNumbers ?? ""),
        );
        return {
          model: item.model ?? "",
          description,
          hsn: item.hsn ?? "",
          itemCode: String(item.itemCode ?? "").trim(),
          qty: Number(item.qty) || 1,
          unitPrice: Number(item.unitPrice) || 0,
          discount: Number(item.discount) || 0,
          total:
            Number(item.total) ||
            (Number(item.unitPrice) || 0) * (Number(item.qty) || 1),
          serialNumbers,
        };
      });
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
    const items = [...(extracted.lineItems as ExtractedLineItem[])];
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
          itemCode: "",
          qty: 1,
          unitPrice: 0,
          discount: 0,
          total: 0,
          serialNumbers: "",
        } as any,
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

  const codeChecks: CodeCheck[] = useMemo(() => {
    if (!extracted) return [];
    return (extracted.lineItems as ExtractedLineItem[]).map((item) => {
      const matched = products.find(
        (p) => p.model.toLowerCase() === item.model.toLowerCase(),
      );

      const buildField = (
        scanned: string,
        existing: string,
      ): CodeCheck["itemCode"] => {
        if (!scanned) return null;
        if (!existing) return { scanned, existing: "", status: "new" };
        if (existing.trim() === scanned.trim())
          return { scanned, existing, status: "match" };
        return { scanned, existing, status: "conflict" };
      };

      return {
        model: item.model,
        matchedProduct: matched ?? null,
        itemCode: matched
          ? buildField(item.itemCode, matched.itemCode ?? "")
          : null,
        hsn: matched ? buildField(item.hsn, matched.hsn ?? "") : null,
      };
    });
  }, [extracted, products]);

  const unresolvedConflicts = codeChecks.filter(
    (c) =>
      (c.itemCode?.status === "conflict" && !resolutions[c.model]?.itemCode) ||
      (c.hsn?.status === "conflict" && !resolutions[c.model]?.hsn),
  );

  const pickResolution = (
    model: string,
    field: "itemCode" | "hsn",
    choice: "scanned" | "existing",
  ) => {
    setResolutions((prev) => ({
      ...prev,
      [model]: { ...prev[model], [field]: choice },
    }));
  };

  const confirmAndProceed = async () => {
    if (!extracted) return;
    setApplyingCodes(true);
    try {
      for (const check of codeChecks) {
        if (!check.matchedProduct) continue;

        const patch: { model: string; itemCode?: string; hsn?: string } = {
          model: check.model,
        };

        if (check.itemCode) {
          if (check.itemCode.status === "new") {
            patch.itemCode = check.itemCode.scanned;
          } else if (check.itemCode.status === "conflict") {
            const choice = resolutions[check.model]?.itemCode ?? "existing";
            if (choice === "scanned") patch.itemCode = check.itemCode.scanned;
          }
        }
        if (check.hsn) {
          if (check.hsn.status === "new") {
            patch.hsn = check.hsn.scanned;
          } else if (check.hsn.status === "conflict") {
            const choice = resolutions[check.model]?.hsn ?? "existing";
            if (choice === "scanned") patch.hsn = check.hsn.scanned;
          }
        }

        if (patch.itemCode !== undefined || patch.hsn !== undefined) {
          try {
            await fetch("/api/products", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(patch),
            });
          } catch (e) {
            console.error("[GroqSaleScanner] Failed to patch product code:", e);
          }
        }
      }
    } finally {
      setApplyingCodes(false);
      onExtracted(extracted);
    }
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
          maxWidth: 1040,
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
              📸 Scan Sale Invoice (Groq — free)
              <span
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  marginLeft: 8,
                  fontWeight: 400,
                }}
              >
                {GROQ_VISION_MODEL}
              </span>
            </div>
            <div
              style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}
            >
              Upload a screenshot/photo of an invoice (e.g. from Zoho Books) —
              AI extracts customer &amp; line items, review before importing
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
                PNG · JPG · WEBP · PDF (first page auto-converted){" "}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </div>

            {preview && (
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

            {/* ── OR: paste a Zoho link (best-effort, see caveats below) ── */}
            <div
              style={{
                borderTop: "1px solid var(--border)",
                paddingTop: 12,
                marginTop: 2,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 8,
                }}
              >
                Or paste a Zoho link (best-effort)
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  value={zohoUrl}
                  onChange={(e) => setZohoUrl(e.target.value)}
                  placeholder="https://zohosecurepay.in/..."
                  style={{ fontSize: 11, flex: 1 }}
                />
                <button
                  className="btn-ghost"
                  onClick={tryZohoLink}
                  disabled={!zohoUrl.trim() || linkFetching}
                  style={{ fontSize: 11, padding: "6px 12px", flexShrink: 0 }}
                >
                  {linkFetching ? "…" : "Try"}
                </button>
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  marginTop: 6,
                  lineHeight: 1.6,
                }}
              >
                Zoho embeds the real invoice data on this page for their own PDF
                renderer — when found, this is{" "}
                <strong>exact data, not AI-guessed</strong>, and skips straight
                to review below. Depends on Zoho continuing to embed it this
                way, so the screenshot method is still the fallback if this
                stops working.
              </div>

              {linkResult && (
                <div
                  style={{
                    marginTop: 8,
                    padding: "8px 10px",
                    borderRadius: 6,
                    fontSize: 11,
                    lineHeight: 1.6,
                    background: linkResult.structuredDataFound
                      ? "rgba(34,197,94,0.08)"
                      : "rgba(245,158,11,0.08)",
                    border: `1px solid ${
                      linkResult.structuredDataFound
                        ? "rgba(34,197,94,0.25)"
                        : "rgba(245,158,11,0.25)"
                    }`,
                    color: linkResult.structuredDataFound
                      ? "var(--accent-green)"
                      : "var(--accent-amber)",
                  }}
                >
                  {linkResult.message}
                  {linkResult.meta?.title && (
                    <div style={{ marginTop: 4, color: "var(--text-dim)" }}>
                      Page title: {linkResult.meta.title}
                    </div>
                  )}
                  {linkResult.structuredDataFound && (
                    <div
                      style={{
                        marginTop: 6,
                        fontFamily: "monospace",
                        fontSize: 10,
                        maxHeight: 120,
                        overflowY: "auto",
                        background: "var(--bg-card)",
                        padding: 6,
                        borderRadius: 4,
                        color: "var(--text-muted)",
                      }}
                    >
                      {JSON.stringify(
                        linkResult.rawEmbeddedData,
                        null,
                        2,
                      ).slice(0, 800)}
                    </div>
                  )}
                </div>
              )}
            </div>

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

            <button
              className="btn-primary"
              onClick={scanInvoice}
              disabled={!file || scanning || converting}
              style={{ fontSize: 13, padding: "10px 16px" }}
            >
              {converting
                ? "📄 Converting PDF…"
                : scanning
                  ? "⏳ Scanning with Groq…"
                  : "⚡ Scan Invoice (free)"}
            </button>

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
              <strong style={{ color: "var(--text-dim)" }}>Setup:</strong> Get a
              free key at{" "}
              <strong style={{ color: "var(--text-dim)" }}>
                console.groq.com/keys
              </strong>
              , add it as{" "}
              <code
                style={{
                  fontSize: 10,
                  background: "var(--bg-card)",
                  padding: "1px 4px",
                  borderRadius: 3,
                }}
              >
                NEXT_PUBLIC_GROQ_API_KEY
              </code>{" "}
              (same key as the purchase scanner — no separate setup needed if
              you already added it there).
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
              <strong style={{ color: "var(--text-dim)" }}>Note:</strong> after
              importing, you'll still need to search/select the actual customer
              record below — the scanned name can't auto-match a Supabase
              customer, same as the JSON/Excel import.
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
                    { label: "Customer", key: "vendorOrCustomer" },
                    { label: "Invoice No", key: "invoiceNumber" },
                    { label: "Date (YYYY-MM-DD)", key: "invoiceDate" },
                    { label: "Due date", key: "dueDate" },
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
                    <table style={{ minWidth: 860 }}>
                      <thead>
                        <tr>
                          <th style={{ minWidth: 150 }}>Model</th>
                          <th style={{ minWidth: 90 }}>HSN</th>
                          <th style={{ minWidth: 100 }}>Item Code</th>
                          <th style={{ textAlign: "right", width: 80 }}>Qty</th>
                          <th style={{ textAlign: "right", width: 120 }}>
                            Unit Price ₹
                          </th>
                          <th style={{ textAlign: "right", width: 70 }}>
                            Disc %
                          </th>
                          <th style={{ textAlign: "right", width: 110 }}>
                            Total ₹
                          </th>
                          <th style={{ minWidth: 130 }}>Serials</th>
                          <th style={{ width: 34 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(extracted.lineItems as ExtractedLineItem[]).map(
                          (item, i) => {
                            const unmatched =
                              !!item.model?.trim() &&
                              !products.find(
                                (p) =>
                                  String(p.model ?? "")
                                    .trim()
                                    .toLowerCase() ===
                                  item.model.trim().toLowerCase(),
                              );
                            const suggestions = unmatched
                              ? findSimilarProducts(products, item.model)
                              : [];
                            return (
                              <tr
                                key={i}
                                style={{
                                  background: unmatched
                                    ? "rgba(245,158,11,0.06)"
                                    : "transparent",
                                }}
                              >
                                <td>
                                  <input
                                    value={item.model}
                                    onChange={(e) =>
                                      updateItem(i, "model", e.target.value)
                                    }
                                    list="groq-sale-scanner-model-list"
                                    placeholder="Model name"
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 500,
                                      borderColor: unmatched
                                        ? "rgba(245,158,11,0.8)"
                                        : undefined,
                                      background: unmatched
                                        ? "rgba(245,158,11,0.08)"
                                        : undefined,
                                    }}
                                  />
                                  {unmatched && (
                                    <div
                                      style={{
                                        fontSize: 10,
                                        marginTop: 3,
                                        color: "var(--accent-amber)",
                                        lineHeight: 1.5,
                                      }}
                                    >
                                      {suggestions.length > 0 ? (
                                        <>
                                          not found — did you mean{" "}
                                          {suggestions.map((s, si) => (
                                            <span key={s.model}>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  updateItem(
                                                    i,
                                                    "model",
                                                    s.model,
                                                  );
                                                  updateItem(
                                                    i,
                                                    "hsn",
                                                    s.hsn ?? "",
                                                  );
                                                  updateItem(
                                                    i,
                                                    "itemCode",
                                                    s.itemCode ?? "",
                                                  );
                                                }}
                                                style={{
                                                  background: "none",
                                                  border: "none",
                                                  padding: 0,
                                                  color: "var(--accent-amber)",
                                                  textDecoration: "underline",
                                                  fontWeight: 700,
                                                  cursor: "pointer",
                                                  fontSize: 10,
                                                }}
                                              >
                                                {s.model}
                                              </button>
                                              {si < suggestions.length - 1
                                                ? " or "
                                                : "?"}
                                            </span>
                                          ))}
                                        </>
                                      ) : (
                                        "⚠ no close match in catalogue"
                                      )}
                                    </div>
                                  )}
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
                                    value={item.itemCode}
                                    onChange={(e) =>
                                      updateItem(i, "itemCode", e.target.value)
                                    }
                                    placeholder="Item code"
                                    style={{
                                      fontSize: 11,
                                      fontFamily: "monospace",
                                    }}
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
                                    style={{
                                      textAlign: "right",
                                      fontSize: 13,
                                      fontWeight: 600,
                                      padding: "6px 8px",
                                      minWidth: 64,
                                    }}
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
                                  <input
                                    value={item.serialNumbers}
                                    onChange={(e) =>
                                      updateItem(
                                        i,
                                        "serialNumbers",
                                        e.target.value,
                                      )
                                    }
                                    placeholder="comma-separated"
                                    style={{
                                      fontSize: 10,
                                      fontFamily: "monospace",
                                    }}
                                  />
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
                          },
                        )}
                      </tbody>
                    </table>
                    <datalist id="groq-sale-scanner-model-list">
                      {products.map((p) => (
                        <option key={p.model} value={p.model} />
                      ))}
                    </datalist>
                  </div>
                </div>

                {extracted.lineItems.some(
                  (item: any) =>
                    item.model?.trim() &&
                    !products.find(
                      (p) =>
                        String(p.model ?? "")
                          .trim()
                          .toLowerCase() === item.model.trim().toLowerCase(),
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
                    click a suggestion above or fix them manually before
                    confirming.
                  </div>
                )}
              </div>

              {/* ── Item Code / HSN verification against Supabase ── */}
              {codeChecks.some((c) => c.itemCode || c.hsn) && (
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      marginBottom: 8,
                    }}
                  >
                    🔍 Item Code / HSN check (against catalogue)
                  </div>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 6 }}
                  >
                    {codeChecks.map((check, i) => {
                      if (!check.itemCode && !check.hsn) return null;
                      const fields: Array<["itemCode" | "hsn", string]> = [
                        ["itemCode", "Item Code"],
                        ["hsn", "HSN"],
                      ];
                      return (
                        <div
                          key={i}
                          style={{
                            background: "var(--bg-input)",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            padding: "8px 12px",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              marginBottom: 6,
                            }}
                          >
                            {check.model}
                          </div>
                          {fields.map(([key, label]) => {
                            const f = check[key];
                            if (!f) return null;
                            if (f.status === "match") {
                              return (
                                <div
                                  key={key}
                                  style={{
                                    fontSize: 11,
                                    color: "var(--accent-green)",
                                    marginBottom: 3,
                                  }}
                                >
                                  ✓ {label} matches: <code>{f.existing}</code>
                                </div>
                              );
                            }
                            if (f.status === "new") {
                              return (
                                <div
                                  key={key}
                                  style={{
                                    fontSize: 11,
                                    color: "var(--accent)",
                                    marginBottom: 3,
                                  }}
                                >
                                  + {label} not in catalogue yet — will add:{" "}
                                  <code>{f.scanned}</code>
                                </div>
                              );
                            }
                            const picked =
                              resolutions[check.model]?.[key] ?? "existing";
                            return (
                              <div
                                key={key}
                                style={{
                                  marginBottom: 4,
                                  padding: "6px 8px",
                                  borderRadius: 6,
                                  background: "rgba(245,158,11,0.08)",
                                  border: "1px solid rgba(245,158,11,0.25)",
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: "var(--accent-amber)",
                                    marginBottom: 5,
                                    fontWeight: 500,
                                  }}
                                >
                                  ⚠ {label} conflict — which is correct?
                                </div>
                                <div
                                  style={{
                                    display: "flex",
                                    gap: 6,
                                    flexWrap: "wrap",
                                  }}
                                >
                                  <button
                                    onClick={() =>
                                      pickResolution(
                                        check.model,
                                        key,
                                        "existing",
                                      )
                                    }
                                    style={{
                                      fontSize: 11,
                                      padding: "4px 9px",
                                      borderRadius: 5,
                                      cursor: "pointer",
                                      border:
                                        picked === "existing"
                                          ? "1.5px solid var(--accent)"
                                          : "1px solid var(--border)",
                                      background:
                                        picked === "existing"
                                          ? "rgba(59,130,246,0.12)"
                                          : "transparent",
                                      color:
                                        picked === "existing"
                                          ? "var(--accent)"
                                          : "var(--text-dim)",
                                    }}
                                  >
                                    {picked === "existing" ? "✓ " : ""}Keep
                                    existing:{" "}
                                    <code>{f.existing || "(blank)"}</code>
                                  </button>
                                  <button
                                    onClick={() =>
                                      pickResolution(
                                        check.model,
                                        key,
                                        "scanned",
                                      )
                                    }
                                    style={{
                                      fontSize: 11,
                                      padding: "4px 9px",
                                      borderRadius: 5,
                                      cursor: "pointer",
                                      border:
                                        picked === "scanned"
                                          ? "1.5px solid var(--accent)"
                                          : "1px solid var(--border)",
                                      background:
                                        picked === "scanned"
                                          ? "rgba(59,130,246,0.12)"
                                          : "transparent",
                                      color:
                                        picked === "scanned"
                                          ? "var(--accent)"
                                          : "var(--text-dim)",
                                    }}
                                  >
                                    {picked === "scanned" ? "✓ " : ""}Use
                                    scanned: <code>{f.scanned}</code>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                  {unresolvedConflicts.length > 0 && (
                    <div
                      style={{
                        marginTop: 8,
                        padding: "7px 10px",
                        borderRadius: 6,
                        fontSize: 11,
                        background: "rgba(245,158,11,0.07)",
                        border: "1px solid rgba(245,158,11,0.25)",
                        color: "var(--accent-amber)",
                      }}
                    >
                      ⚠ {unresolvedConflicts.length} conflict
                      {unresolvedConflicts.length !== 1 ? "s" : ""} above still
                      need a choice before you can proceed. (Defaults to "Keep
                      existing" if you don't pick.)
                    </div>
                  )}
                </div>
              )}

              <button
                className="btn-primary"
                onClick={confirmAndProceed}
                disabled={extracted.lineItems.length === 0 || applyingCodes}
                style={{
                  fontSize: 13,
                  padding: "10px 16px",
                  background: "var(--accent-green)",
                }}
              >
                {applyingCodes
                  ? "Updating catalogue codes…"
                  : "✓ Use this data → fill Sale form"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
