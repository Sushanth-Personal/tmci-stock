// src/components/GroqPurchaseScanner.tsx
//
// Free alternative to InvoiceScanner.tsx (which uses the paid Anthropic API).
// Uses Groq's API — generous free developer tier, no card required — with a
// vision-capable model to OCR/extract a purchase bill from a photo.
//
// MODEL NOTE (as of July 2026): meta-llama/llama-4-scout-17b-16e-instruct,
// the obvious first choice, was deprecated by Groq on 17 June 2026. The
// model below (qwen/qwen3.6-27b) is what Groq's own docs point migrators to
// for vision use. Groq's model lineup changes often — if this scan starts
// failing with a "model decommissioned" error, check
// https://console.groq.com/docs/vision for the current vision model name
// and update GROQ_VISION_MODEL below.
//
// Output shape matches ImportedPurchaseBill (same as PurchaseImport.tsx's
// zero-cost JSON-paste flow), so this plugs straight into RecordPurchase's
// existing handleImported() — same review-per-item queue, same "manually
// verify before Add item → sheet" flow. No changes needed to that logic.

"use client";
import { useState, useRef, useCallback, useMemo } from "react";
import type { ImportedPurchaseBill } from "@/components/PurchaseImport";

const GROQ_VISION_MODEL = "qwen/qwen3.6-27b";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

interface ExtractedLineItem {
  model: string;
  description: string;
  hsn: string;
  itemCode: string;
  qty: number;
  listPrice: number;
  unitPrice: number;
  discountPct: number;
  total: number;
  serialNumbers: string;
}

// Per-line-item code verification state: what's already in Supabase vs what
// the scan found, and — if they conflict — which one the user picked.
interface CodeCheck {
  model: string;
  matchedProduct: any | null; // the catalogue row, if the model matched one
  itemCode: {
    scanned: string;
    existing: string;
    status: "new" | "match" | "conflict";
    resolved: "scanned" | "existing"; // which value wins, defaults sensibly
  } | null;
  hsn: {
    scanned: string;
    existing: string;
    status: "new" | "match" | "conflict";
    resolved: "scanned" | "existing";
  } | null;
}

interface ExtractedBill extends ImportedPurchaseBill {
  confidence: "high" | "medium" | "low";
  warnings: string[];
}

interface Props {
  products: any[];
  onExtracted: (data: ImportedPurchaseBill) => void;
  onClose: () => void;
}

export default function GroqPurchaseScanner({
  products,
  onExtracted,
  onClose,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedBill | null>(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // model -> { itemCode?: "scanned"|"existing", hsn?: "scanned"|"existing" }
  // User's picks for any conflicting fields. Defaults to "existing" (safer —
  // never silently overwrite a value already in Supabase without the user
  // explicitly choosing the scanned one).
  const [resolutions, setResolutions] = useState<
    Record<
      string,
      { itemCode?: "scanned" | "existing"; hsn?: "scanned" | "existing" }
    >
  >({});
  const [applyingCodes, setApplyingCodes] = useState(false);

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setExtracted(null);
    setError("");
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

    if (file.type === "application/pdf") {
      setError(
        "PDF not supported directly — please take a screenshot of the bill and upload that instead.",
      );
      setScanning(false);
      return;
    }

    const productList = products
      .slice(0, 100)
      .map((p) => `${p.model} (₹${p.listPrice})`)
      .join(", ");

    const prompt = `Extract all data from this purchase bill / vendor invoice / PO image for TMCI Technology, an authorised Fluke products dealer in India. This is likely an official Fluke Technologies tax invoice.

KNOWN INVOICE FORMAT — Fluke's own invoices list each line item as:
  "FLK-<model>/<code>(<item code>)" or "FLUKE-<model>/<code>(<item code>)"
  followed on the next line by "LP Rate : <number>"
Examples actually seen on real Fluke invoices:
  "FLK-15B MAX-01/APC(5336066)" with "LP Rate : 12300"  -> model "15B MAX-01 (TL75)", itemCode "5336066"
  "FLK-15B MAX-02/..." would be model "15B MAX-02 (TL31)" (the "-02" suffix means TL31 lead set, "-01" means TL75)
  "FLUKE-302+/APAC(5293800)" with "LP Rate : 9400"       -> model "302+", itemCode "5293800"
  "FLUKE-317/IN(4092675)" with "LP Rate : 23400"         -> model "317", itemCode "4092675"
  "FLUKE-9062(2435077)" with "LP Rate : 31300"           -> model "9062", itemCode "2435077"
  "FLUKE-TC01A 25HZ(5518338)" with "LP Rate : 34700"     -> model "TC01A", itemCode "5518338"
The "/APC", "/APAC", "/IN", "25HZ" etc. are internal Fluke SKU region/variant codes — IGNORE them, they are
NOT part of the model name. The number in parentheses IS Fluke's item code for that specific model/variant
— extract it into the "itemCode" field. The HSN/SAC code is a SEPARATE column on the invoice (usually
8-digit, e.g. 90303100) — do not confuse it with the item code in parentheses.

CRITICAL — use "LP Rate" as your primary disambiguation signal:
"LP Rate" is Fluke's own list price for that exact model, and it should closely match the "List Price"
in the catalogue below for the correct model. If your first guess at a model name doesn't have a
catalogue list price reasonably close to the invoice's "LP Rate", you have the WRONG model — search the
catalogue again for a model whose list price actually matches "LP Rate", rather than guessing based on
surface similarity of the model code. Do not confuse unrelated product codes just because a couple of
characters look similar (e.g. never map anything to "2AC" or "59 MINI" unless the model text on the
invoice unambiguously reads exactly that).

Our product catalogue — match extracted model names to these EXACTLY (including case), model: list price:
${productList}

Return ONLY this JSON object, no other text:
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
      "itemCode": "",
      "qty": 1,
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
  "notes": "",
  "confidence": "high",
  "warnings": []
}

Rules:
- unitPrice = the FINAL ex-GST rate actually charged per unit shown in the "Rate" column (this is usually
  LOWER than "LP Rate" — LP Rate is list price, Rate is the discounted price actually billed)
- listPrice = the "LP Rate" value shown under each item (this is the reference list price, used for
  matching, separate from the actual billed "Rate")
- discountPct = derived from (listPrice - unitPrice) / listPrice * 100
- qty = read directly from the "Qty" column, do not guess — double check it against Taxable Amount ÷ Rate,
  they must match
- Double-check every digit of unitPrice carefully — Fluke unit prices for professional test equipment are
  almost always between ₹2,000 and ₹1,60,000. If a price looks like it's missing a digit (e.g. reads as
  ₹2,022 when the line item's Taxable Amount implies it should be ₹20,222), re-read that cell.
- itemCode = the number in parentheses after the model code on the invoice line (e.g. "5336066")
- Strip "Fluke"/"FLK"/"FLUKE-" prefixes from model names
- Model names must match the catalogue EXACTLY including case
- vendor = the SELLER/supplier issuing this bill (NOT TMCI Technology) — who we're buying FROM
- location = which warehouse received the stock: "Kochi" or "Bangalore" (default "Kochi" if unclear)
- serialNumbers = leave empty string unless actual unit serial numbers (not batch/order refs) are listed
- courierCharges = any shipping/freight charge shown separately (0 if none)
- All amounts as plain numbers, no commas or currency symbols
- Date as YYYY-MM-DD
- confidence: "high" if every model matched its LP Rate cleanly, "medium" if 1-2 were ambiguous, "low" if
  several models could not be confidently matched against the catalogue's list prices
- warnings: list any line item where you were not fully confident of the model match, quoting the raw
  text you saw and which catalogue model you guessed`;

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
          // qwen3.6-27b is a reasoning model — by default it wraps its
          // thinking in <think> tags before answering. Combined with
          // json_object mode, that reasoning text leaks into the output and
          // fails Groq's strict JSON validation ("Failed to validate JSON").
          // Groq's docs require reasoning_format to be 'parsed' or 'hidden'
          // whenever JSON mode is used — 'hidden' drops the thinking
          // entirely, which is what we want for a plain extraction task.
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
            `Model "${GROQ_VISION_MODEL}" has been retired by Groq. Check console.groq.com/docs/vision for the current vision model and update GROQ_VISION_MODEL in GroqPurchaseScanner.tsx.`,
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

      let parsed: ExtractedBill;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        setError(
          "AI returned invalid JSON. Try a clearer, straighter photo of the bill.",
        );
        console.error("[GroqPurchaseScanner] Bad JSON:", cleaned.slice(0, 300));
        setScanning(false);
        return;
      }

      if (!Array.isArray(parsed.lineItems)) parsed.lineItems = [];
      parsed.lineItems = parsed.lineItems.map((item: any) => ({
        model: item.model ?? "",
        description: item.description ?? "",
        hsn: item.hsn ?? "",
        itemCode: String(item.itemCode ?? "").trim(),
        qty: Number(item.qty) || 1,
        listPrice: Number(item.listPrice) || Number(item.unitPrice) || 0,
        unitPrice: Number(item.unitPrice) || 0,
        discountPct: Number(item.discountPct) || 0,
        total:
          Number(item.total) ||
          (Number(item.unitPrice) || 0) * (Number(item.qty) || 1),
        serialNumbers: String(item.serialNumbers ?? ""),
      }));
      parsed.subtotal = Number(parsed.subtotal) || 0;
      parsed.gstRate = Number(parsed.gstRate) || 18;
      parsed.gstAmount = Number(parsed.gstAmount) || 0;
      parsed.total = Number(parsed.total) || 0;
      parsed.courierCharges = Number(parsed.courierCharges) || 0;
      parsed.location = parsed.location === "Bangalore" ? "Bangalore" : "Kochi";
      if (!Array.isArray(parsed.warnings)) parsed.warnings = [];

      setExtracted(parsed);
    } catch (networkErr: any) {
      setError(`Network error: ${networkErr.message}`);
    }

    setScanning(false);
  };

  const updateItem = (i: number, field: keyof ExtractedLineItem, val: any) => {
    if (!extracted) return;
    const items = [...extracted.lineItems] as ExtractedLineItem[];
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
          listPrice: 0,
          unitPrice: 0,
          discountPct: 0,
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

  // Compare each scanned line item's itemCode/HSN against what's already in
  // Supabase for that model. Drives the verification panel below.
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
        if (!scanned) return null; // nothing scanned, nothing to check
        if (!existing)
          return { scanned, existing: "", status: "new", resolved: "scanned" };
        if (existing.trim() === scanned.trim())
          return { scanned, existing, status: "match", resolved: "existing" };
        return { scanned, existing, status: "conflict", resolved: "existing" };
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

  // Applies every "new" field and every user-resolved conflict to Supabase
  // via PATCH /api/products, then hands off to onExtracted as normal.
  const confirmAndProceed = async () => {
    if (!extracted) return;
    setApplyingCodes(true);
    try {
      for (const check of codeChecks) {
        if (!check.matchedProduct) continue; // model didn't match catalogue — nothing to patch

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
            console.error(
              "[GroqPurchaseScanner] Failed to patch product code:",
              e,
            );
            // Non-fatal — the purchase itself still proceeds even if a
            // catalogue code update fails; user can fix it manually later.
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
              📸 Scan Purchase Bill (Groq — free)
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
              Upload a photo of the vendor bill — AI extracts line items, review
              before adding to sheet
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
                {file ? file.name : "Drop bill here or click to browse"}
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
                  alt="Bill preview"
                  style={{
                    width: "100%",
                    display: "block",
                    objectFit: "contain",
                  }}
                />
              </div>
            )}

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
              disabled={!file || scanning}
              style={{ fontSize: 13, padding: "10px 16px" }}
            >
              {scanning ? "⏳ Scanning with Groq…" : "⚡ Scan Bill (free)"}
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
              to Vercel env vars. No card required — Groq's developer tier is
              free with rate limits.
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
              <strong style={{ color: "var(--text-dim)" }}>
                Security note:
              </strong>{" "}
              this key is exposed client-side (same pattern as the existing
              Claude scanner). Fine for a small internal tool, but don't reuse a
              key you care about elsewhere.
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
                    { label: "Vendor", key: "vendor" },
                    { label: "Invoice No", key: "invoiceNumber" },
                    { label: "PO Number", key: "poNumber" },
                    { label: "Date (YYYY-MM-DD)", key: "invoiceDate" },
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
                        } as ExtractedBill)
                      }
                      style={{ fontSize: 12 }}
                    />
                  </div>
                ))}
                <div>
                  <label
                    style={{
                      fontSize: 10,
                      color: "var(--text-muted)",
                      display: "block",
                      marginBottom: 2,
                    }}
                  >
                    Location
                  </label>
                  <select
                    value={extracted.location}
                    onChange={(e) =>
                      setExtracted({
                        ...extracted,
                        location: e.target.value as "Kochi" | "Bangalore",
                      })
                    }
                    style={{ fontSize: 12 }}
                  >
                    <option>Kochi</option>
                    <option>Bangalore</option>
                  </select>
                </div>
                <div>
                  <label
                    style={{
                      fontSize: 10,
                      color: "var(--text-muted)",
                      display: "block",
                      marginBottom: 2,
                    }}
                  >
                    Courier charges (₹)
                  </label>
                  <input
                    type="number"
                    value={extracted.courierCharges ?? 0}
                    onChange={(e) =>
                      setExtracted({
                        ...extracted,
                        courierCharges: Number(e.target.value) || 0,
                      })
                    }
                    style={{ fontSize: 12 }}
                  />
                </div>
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
                                    list="groq-scanner-model-list"
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
                                    value={item.discountPct}
                                    onChange={(e) =>
                                      updateItem(
                                        i,
                                        "discountPct",
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
                    <datalist id="groq-scanner-model-list">
                      {products.map((p) => (
                        <option key={p.model} value={p.model} />
                      ))}
                    </datalist>
                  </div>
                </div>

                {extracted.lineItems.some(
                  (item: any) =>
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
                            // conflict
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
                  : "✓ Use this data → load into Purchase form"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
