// src/app/api/scan-zoho-link/route.ts
//
// Fetches a pasted Zoho invoice/payment link and extracts structured
// invoice data if Zoho's page happens to embed it as JSON.
//
// UPDATE: Added a transformed-URL fast path BEFORE the raw-URL fast path.
// A working Google Apps Script (fillFromZohoLink) for this same account
// always converts CInvoiceID / CEstimateID links to the /api/v3/ endpoint
// before fetching, e.g.:
//   .../secure?CInvoiceID=XYZ#/securepayment
//     -> .../api/v3/clientinvoices/secure?CInvoiceID=XYZ
// That script reliably gets clean JSON back. This route previously only
// tried the raw URL as-is, which may not reliably return embedded JSON —
// so we now try the /api/v3/ transform FIRST, then fall back to the raw
// URL fast path, then fall back further to HTML scraping.
//
// Known shape (Zoho Books invoice JSON, either at top level or nested under
// "invoice"):
//   invoice_number, date, due_date, customer_name, reference_number,
//   subject, sub_total, tax_total, total, line_items: [{ name, description,
//   rate, quantity, discount, item_total, tax_percentage, ... }]
// GSTIN is NOT a top-level field — it's embedded as text inside the
// html_string's billing-address block ("GSTIN 32AAECT4944P1ZW"), so we
// regex it out of there.
// HSN is also not present on line_items in this payload — RecordSale.tsx
// already falls back to the catalogue's own HSN for a matched model, so
// this is left blank here rather than guessed.
//
// This is still fetched via a direct server-side fetch() that bypasses
// robots.txt (a voluntary convention, not an enforcement mechanism) — only
// appropriate for your OWN invoices, not scraping others' Zoho data. And
// this remains fragile: it depends entirely on Zoho continuing to return
// this payload in this shape, which could change without notice.

import { NextResponse } from "next/server";

const ALLOWED_HOST_SUFFIXES = [
  ".zoho.com",
  ".zoho.in",
  ".zohosecurepay.in",
  "zoho.com",
  "zoho.in",
  "zohosecurepay.in",
];

function isAllowedZohoUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    const ok = ALLOWED_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(suffix),
    );
    return ok ? u : null;
  } catch {
    return null;
  }
}

// Mirrors the Apps Script's transformZohoUrl(): converts a CInvoiceID /
// CEstimateID secure-payment link into Zoho's /api/v3/ JSON endpoint.
// Returns null if the URL doesn't match a known pattern (nothing to transform).
function transformToApiUrl(raw: string): string | null {
  // Strip any URL fragment (#/securepayment etc.) before transforming —
  // matches the Apps Script's .split("#")[0].
  const withoutFragment = raw.split("#")[0];

  if (withoutFragment.includes("/api/v3/")) {
    // Already an API URL.
    return withoutFragment;
  }
  if (withoutFragment.includes("CInvoiceID")) {
    return withoutFragment.replace(
      "/secure?",
      "/api/v3/clientinvoices/secure?",
    );
  }
  if (withoutFragment.includes("CEstimateID")) {
    return withoutFragment.replace(
      "/secure?",
      "/api/v3/clientestimates/secure?",
    );
  }
  return null;
}

// Look for common SPA hydration patterns where an app drops its initial
// state as JSON into the raw HTML (present before any client JS runs).
function extractEmbeddedJson(html: string): any[] {
  const found: any[] = [];
  const singlePatterns = [
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/,
    /window\.initialData\s*=\s*(\{[\s\S]*?\});/,
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/,
  ];
  for (const pattern of singlePatterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        found.push(JSON.parse(match[1]));
      } catch {
        // not valid JSON, skip
      }
    }
  }

  // Generic <script type="application/json"> blocks — this is where the
  // real Zoho invoice payload was found in practice.
  const jsonScriptRe =
    /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = jsonScriptRe.exec(html)) !== null) {
    try {
      found.push(JSON.parse(m[1]));
    } catch {
      // not valid JSON, skip
    }
  }

  return found;
}

function extractMetaTags(html: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const metaRegex =
    /<meta[^>]+(?:property|name)=["']([^"']+)["'][^>]+content=["']([^"']*)["']/g;
  let m;
  while ((m = metaRegex.exec(html)) !== null) {
    meta[m[1]] = m[2];
  }
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/);
  if (titleMatch) meta["title"] = titleMatch[1];
  return meta;
}

// Recognise the confirmed Zoho Books invoice JSON shape and map it to the
// same shape RecordSale.tsx's ImportedInvoice expects.
function mapZohoInvoiceJson(raw: any): any | null {
  if (!raw || typeof raw !== "object") return null;
  if (!raw.invoice_number || !Array.isArray(raw.line_items)) return null;

  // GSTIN lives inside the rendered billing-address HTML, not as its own field.
  let gstin = "";
  if (typeof raw.html_string === "string") {
    const gm = raw.html_string.match(/GSTIN[:\s]*([0-9A-Z]{15})/i);
    if (gm) gstin = gm[1].toUpperCase();
  }

  const lineItems = raw.line_items.map((li: any) => {
    let description = String(li.description ?? "");
    let serialNumbers = "";
    // Serials are often appended to the description in various formats:
    // "Digital Clamp Meter\nS no: 72830818WS, 72830819WS"
    // "Digital MultimeterS/N: 71872116WS & 71872101WS"
    // "...S/N 72761762WS, 72761756WS"
    const snMatch = description.match(
      /S\s*[\/.]?\s*(?:no\.?|n)\.?:?\s*([A-Za-z0-9,&\s]+)$/i,
    );
    if (snMatch) {
      serialNumbers = snMatch[1]
        .split(/[,&]/)
        .map((s: string) => s.trim())
        .filter(Boolean)
        .join(", ");
      description = description.slice(0, snMatch.index).trim();
    }

    const model = String(li.name ?? "")
      .replace(/^fluke\s+/i, "")
      .trim();

    return {
      model,
      description,
      hsn: "", // not in this payload — RecordSale falls back to catalogue HSN
      qty: Number(li.quantity) || 1,
      unitPrice: Number(li.rate) || 0,
      discount: Number(li.discount) || 0,
      total: Number(li.item_total) || 0,
      serialNumbers,
    };
  });

  const subtotal = Number(raw.sub_total) || 0;
  const gstAmount = Number(raw.tax_total) || 0;
  const gstRate = subtotal > 0 ? Math.round((gstAmount / subtotal) * 100) : 18;

  return {
    invoiceNumber: raw.invoice_number,
    invoiceDate: raw.date ?? "",
    dueDate: raw.due_date ?? raw.date ?? "",
    vendorOrCustomer: raw.customer_name ?? "",
    gstin,
    poNumber: raw.reference_number ?? "",
    lineItems,
    subtotal,
    gstRate,
    gstAmount,
    total: Number(raw.total) || 0,
    notes: raw.subject ?? "",
  };
}

// Tries to fetch a URL and parse it as raw JSON. Returns the parsed object
// on success, or null on any failure (network error, non-JSON body, etc.)
// so the caller can fall through to the next strategy.
async function tryFetchJson(
  url: string,
  label: string,
): Promise<{ json: any; html: string } | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json, text/html, */*",
      },
      redirect: "follow",
    });

    const text = await res.text();
    console.log(
      `[scan-zoho-link] [${label}] fetched:`,
      url,
      "| status:",
      res.status,
      "| response length:",
      text.length,
      "| first 300 chars:",
      text.slice(0, 300),
    );

    if (!res.ok) return { json: null, html: text };

    try {
      const parsed = JSON.parse(text);
      console.log(
        `[scan-zoho-link] [${label}] parsed as JSON. Top-level keys:`,
        Object.keys(parsed),
      );
      return { json: parsed, html: text };
    } catch {
      console.log(`[scan-zoho-link] [${label}] not raw JSON`);
      return { json: null, html: text };
    }
  } catch (fetchErr: any) {
    console.log(`[scan-zoho-link] [${label}] fetch failed:`, fetchErr.message);
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }

    const validUrl = isAllowedZohoUrl(url);
    if (!validUrl) {
      return NextResponse.json(
        {
          error:
            "Only zoho.com / zoho.in / zohosecurepay.in links are accepted.",
        },
        { status: 400 },
      );
    }

    const rawUrlNoFragment = url.split("#")[0];
    const apiUrl = transformToApiUrl(url);

    // ── STRATEGY 1: Transformed /api/v3/ endpoint (matches working Apps Script) ──
    if (apiUrl && apiUrl !== rawUrlNoFragment) {
      const attempt = await tryFetchJson(apiUrl, "api-transform");
      if (attempt?.json) {
        const candidate =
          attempt.json.invoice ?? attempt.json.estimate ?? attempt.json;
        const mapped = mapZohoInvoiceJson(candidate);
        if (mapped) {
          console.log(
            "[scan-zoho-link] SUCCESS via /api/v3/ transform:",
            mapped.invoiceNumber,
          );
          return NextResponse.json({
            success: true,
            structuredDataFound: true,
            matchedInvoice: mapped,
            message: `Extracted invoice ${mapped.invoiceNumber} from Zoho's /api/v3/ endpoint — exact data, not AI-guessed.`,
          });
        }
        // Got JSON but didn't match known shape — surface it for inspection
        // rather than silently discarding, but keep trying other strategies too.
        console.log(
          "[scan-zoho-link] /api/v3/ response didn't match known invoice shape, keys:",
          candidate && typeof candidate === "object"
            ? Object.keys(candidate)
            : candidate,
        );
      }
    }

    // ── STRATEGY 2: Raw URL fast path (previous behaviour) ──────────────────
    const rawAttempt = await tryFetchJson(rawUrlNoFragment, "raw-url");
    if (!rawAttempt) {
      return NextResponse.json(
        { error: "Could not reach Zoho on any endpoint." },
        { status: 502 },
      );
    }

    if (rawAttempt.json) {
      const candidate = rawAttempt.json.invoice ?? rawAttempt.json;
      const mapped = mapZohoInvoiceJson(candidate);
      if (mapped) {
        return NextResponse.json({
          success: true,
          structuredDataFound: true,
          matchedInvoice: mapped,
          message: `Extracted invoice ${mapped.invoiceNumber} directly from Zoho's JSON API response — this is exact, not AI-guessed.`,
        });
      }
      return NextResponse.json({
        success: true,
        structuredDataFound: true,
        rawEmbeddedData: [rawAttempt.json],
        message:
          "Response was valid JSON but didn't match the known Zoho invoice shape — inspect rawEmbeddedData below.",
      });
    }

    // ── STRATEGY 3: HTML scraping fallback ──────────────────────────────────
    const html = rawAttempt.html;
    const embeddedJson = extractEmbeddedJson(html);
    const meta = extractMetaTags(html);

    console.log(
      "[scan-zoho-link] HTML extraction found",
      embeddedJson.length,
      "embedded JSON blob(s)",
    );

    let mappedInvoice: any = null;
    for (const blob of embeddedJson) {
      mappedInvoice = mapZohoInvoiceJson(blob);
      if (mappedInvoice) break;
      if (blob && typeof blob === "object") {
        for (const key of Object.keys(blob)) {
          const nested = mapZohoInvoiceJson(blob[key]);
          if (nested) {
            mappedInvoice = nested;
            break;
          }
        }
      }
      if (mappedInvoice) break;
    }

    if (mappedInvoice) {
      return NextResponse.json({
        success: true,
        structuredDataFound: true,
        matchedInvoice: mappedInvoice,
        message: `Extracted invoice ${mappedInvoice.invoiceNumber} directly from Zoho's data — this is exact, not AI-guessed.`,
      });
    }

    if (embeddedJson.length === 0) {
      return NextResponse.json({
        success: false,
        structuredDataFound: false,
        meta,
        triedApiTransform: !!apiUrl,
        message:
          "No structured invoice data could be extracted from this page via the /api/v3/ endpoint, raw JSON, or HTML scraping. " +
          "Please use the screenshot/PDF scanner instead.",
      });
    }

    return NextResponse.json({
      success: true,
      structuredDataFound: true,
      meta,
      rawEmbeddedData: embeddedJson,
      message:
        "Found embedded JSON but it didn't match the known Zoho invoice shape — inspect rawEmbeddedData below.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[scan-zoho-link] unhandled error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
