"use client";
import { useEffect, useState } from "react";
// src/components/InvoicePaper.tsx
//
// Shared, presentational-only component: renders one invoice as a
// pixel-close replica of TMCI's actual printed invoice (matches the real
// Zoho Books PDF export). Used by BOTH the standalone InvoicePreview.tsx
// browse screen AND embedded directly inside the operational
// Invoices.tsx detail panel — one layout, one place to fix, used
// everywhere it's shown.

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

export interface InvoicePaperData {
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  customer_snapshot: any;
  line_items: LineItem[];
  subtotal: number;
  gst_rate: number;
  gst_amount: number;
  total: number;
  notes: string | null;
}

// Everything below is user-editable in Settings — these are just the
// fallback values shown before that fetch resolves (or if it fails).
const FALLBACK_COMPANY = {
  name: "TMCI Technology Private Limited",
  companyId: "U52335KA2012PTC067266",
  addressLines: [
    "39/2475-B1, Suite I9, LR Towers, SJRRA 104,",
    "South Janatha Road, Palarivattom,",
    "Kochi Kerala 682025",
    "India",
  ],
  phone: "9591119333",
  email: "satheesh@tazkmazter.com",
  website: "www.tazkmazter.com",
  gstin: "32AAECT4944P1ZW",
  gstState: "Kerala (32)",
};

const FALLBACK_BANK = {
  name: "STATE BANK OF INDIA",
  account: "67299135280",
  branch: "PPB INDIRANAGAR, BANGALORE",
  ifsc: "SBIN0070679",
};

const fmtDateDMY = (raw: string) => {
  if (!raw) return "—";
  const d = new Date(String(raw).split("T")[0]);
  if (isNaN(d.getTime())) return raw;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
};

const fmt2 = (n: number) =>
  Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

function twoDigitsToWords(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  // Hyphenated like the actual invoice text: "Sixty-One", "Ninety-Two"
  return TENS[t] + (o ? "-" + ONES[o] : "");
}

function threeDigitsToWords(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  let out = "";
  if (h) out += ONES[h] + " Hundred";
  if (rest) out += (h ? " " : "") + twoDigitsToWords(rest);
  return out;
}

function integerToWordsIndian(n: number): string {
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = n;

  const parts: string[] = [];
  if (crore) parts.push(threeDigitsToWords(crore) + " Crore");
  if (lakh) parts.push(threeDigitsToWords(lakh) + " Lakh");
  if (thousand) parts.push(threeDigitsToWords(thousand) + " Thousand");
  if (hundred) parts.push(threeDigitsToWords(hundred));
  return parts.join(" ");
}

function amountInWords(total: number): string {
  const rupees = Math.floor(total);
  const paise = Math.round((total - rupees) * 100);
  const rupeeWords = integerToWordsIndian(rupees);
  if (paise > 0) {
    const paiseWords = twoDigitsToWords(paise) || integerToWordsIndian(paise);
    return `Indian Rupee ${rupeeWords} and ${paiseWords} Paise Only`;
  }
  return `Indian Rupee ${rupeeWords} Only`;
}

function isIntraState(customerState: string, companyGstState: string): boolean {
  // Compares the customer's billing state against the company's OWN
  // registered GST state (e.g. "Kerala (32)" -> "kerala") — works for any
  // business, in any state, not just one hardcoded to Kerala.
  const custState = String(customerState || "")
    .toLowerCase()
    .trim();
  const homeState = String(companyGstState || "")
    .replace(/\s*\(.*\)\s*$/, "") // strip trailing "(32)" style code
    .toLowerCase()
    .trim();
  if (!custState || !homeState) return true; // default to intra-state if unknown
  return custState.includes(homeState) || homeState.includes(custState);
}

export default function InvoicePaper({
  invoice,
}: {
  invoice: InvoicePaperData;
}) {
  const [companySettings, setCompanySettings] = useState<any>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d.settings) setCompanySettings(d.settings);
      })
      .catch(() => {}); // silently fall back to defaults below
  }, []);

  const bank = companySettings
    ? {
        name: companySettings.bank_name,
        account: companySettings.account_number,
        branch: companySettings.branch_name,
        ifsc: companySettings.ifsc_code,
      }
    : FALLBACK_BANK;
  const logoUrl = companySettings?.logo_url ?? null;

  const COMPANY = companySettings
    ? {
        name: companySettings.company_name,
        companyId: companySettings.company_id,
        addressLines: [
          companySettings.address_line1,
          companySettings.address_line2,
          companySettings.address_line3,
          companySettings.address_line4,
        ].filter(Boolean),
        phone: companySettings.phone,
        email: companySettings.email,
        website: companySettings.website,
        gstin: companySettings.gstin,
        gstState: companySettings.gst_state,
      }
    : FALLBACK_COMPANY;

  const customerState =
    invoice.customer_snapshot?.billing_state ||
    invoice.customer_snapshot?.state ||
    "";
  const intraState = isIntraState(customerState, COMPANY.gstState);
  const halfRate = (invoice.gst_rate ?? 18) / 2;
  const customer = invoice.customer_snapshot;
  const billTo = customer
    ? [
        customer.billing_address || customer.address,
        customer.billing_city || customer.city,
        customer.billing_state || customer.state,
        customer.billing_pincode || customer.pincode,
      ]
        .filter(Boolean)
        .join(", ")
    : "";

  return (
    <div>
      {/* Toolbar — hidden when actually printing/saving as PDF, so it
          never shows up in the output itself. */}
      <div
        className="ip-no-print"
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 10,
          maxWidth: 860,
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        <button
          onClick={() => window.print()}
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: "7px 14px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--accent)",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          ⬇ Download / Print PDF
        </button>
      </div>

      <div className="ip-paper">
        <style>{`
        /* Printing / "Save as PDF": hide everything on the page except
           this invoice paper, and let it fill the printed page cleanly.
           No extra libraries needed — this uses the browser's own
           print-to-PDF, which preserves text/fonts exactly (unlike
           canvas-based exporters). */
        @media print {
          @page { size: A4; margin: 12mm; }
          .ip-no-print { display: none !important; }
          body * { visibility: hidden; }
          .ip-paper, .ip-paper * { visibility: visible; }
          .ip-paper {
            position: absolute; left: 0; top: 0; width: 100%;
            box-shadow: none !important; max-width: none !important;
            padding: 0 !important;
          }
          /* The min-height below is only for the on-screen "blank space
             below the signature" look — it's TALLER than one printable A4
             page, so left as-is it forces an empty second page on export.
             Let printed output size to its actual content instead. */
          .ip-inner { min-height: 0 !important; }
        }
        /* NOTE: every rule below uses !important because the app's global
           dark-theme styles (table, th, td, backgrounds, text colors) bleed
           into this component otherwise — the paper must stay white with
           dark text regardless of the surrounding theme. */
        .ip-paper {
          background: #ffffff !important; color: #1a1a1a !important;
          width: 100%; max-width: 860px; margin: 0 auto;
          font-family: Arial, Helvetica, sans-serif;
          padding: 34px 40px;
          font-size: 14px;
          line-height: 1.5;
        }
        .ip-paper * { color: #1a1a1a; }
        .ip-inner {
          border: 1.5px solid #333;
          min-height: 1450px; /* real A4 proportions at this width — the
                                 actual invoice leaves this much blank
                                 space below the signature line */
          display: flex;
          flex-direction: column;
        }
        .ip-header-block { display: flex; justify-content: space-between; align-items: flex-start; padding: 14px 16px; }
        .ip-meta-block {
          display: grid; grid-template-columns: 1fr 1fr;
          border-top: 1.5px solid #333; border-bottom: 1.5px solid #333;
        }
        .ip-meta-left { padding: 8px 12px; }
        .ip-meta-right { padding: 8px 12px; border-left: 1.5px solid #333; }
        .ip-meta-row { display: flex; font-size: 14px; padding: 2px 0; }
        .ip-meta-row .k { width: 120px; flex-shrink: 0; }
        .ip-meta-row .v { font-weight: 700; }
        .ip-section { padding: 10px 16px 40px; }
        .ip-hr { border: none; border-top: 1.5px solid #333; margin: 14px 0; }
        .ip-meta-table { border-collapse: collapse !important; width: 100% !important; }
        .ip-meta-table td {
          border: none !important; padding: 2px 0 !important;
          font-size: 13.5px !important; vertical-align: top !important;
          background: transparent !important; color: #1a1a1a !important;
        }
        .ip-meta-label { font-weight: 700; width: 130px; }
        .ip-billship {
          display: grid; grid-template-columns: 1fr 1fr;
          border: 1px solid #333;
        }
        .ip-billship-col { padding: 8px 12px; }
        .ip-billship-col + .ip-billship-col { border-left: 1px solid #333; }
        .ip-billship-label {
          font-weight: 700; font-size: 13.5px; background: #f2f2f2 !important;
          margin: -8px -12px 8px -12px; padding: 6px 12px;
          border-bottom: 1px solid #333;
        }
        .ip-items-table { border-collapse: collapse !important; width: 100% !important; }
        .ip-items-table th, .ip-items-table td {
          border: 1px solid #333 !important; padding: 6px 8px !important;
          font-size: 13px !important; vertical-align: top !important;
          color: #1a1a1a !important;
        }
        .ip-items-table th {
          font-weight: 700 !important; text-align: left !important;
          background: #ffffff !important;
          text-transform: none !important; letter-spacing: 0 !important;
        }
        .ip-items-table td { background: #ffffff !important; }
        .ip-items-table tbody tr:hover td { background: #ffffff !important; }
        .ip-totals-table { border-collapse: collapse !important; width: 100% !important; }
        .ip-totals-table td {
          border: none !important; padding: 3px 0 !important;
          font-size: 13.5px !important; background: transparent !important;
          color: #1a1a1a !important;
        }
        .ip-totals-table tr.ip-total-row td {
          border-top: 1.5px solid #333 !important; padding-top: 6px !important;
          font-weight: 700 !important; font-size: 13.5px !important;
        }
      `}</style>

        <div className="ip-inner">
          {/* Header */}
          <div className="ip-header-block">
            <div style={{ display: "flex", gap: 14 }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  border: logoUrl ? "none" : "3px solid #1a2a6c",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: 12,
                  color: "#1a2a6c",
                  flexShrink: 0,
                  overflow: "hidden",
                }}
              >
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt="Company logo"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                    }}
                  />
                ) : (
                  "TMCI"
                )}
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
                  {COMPANY.name}
                </div>
                <div>Company ID : {COMPANY.companyId}</div>
                {COMPANY.addressLines.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
                <div>{COMPANY.phone}</div>
                <div>{COMPANY.email}</div>
                <div>{COMPANY.website}</div>
                <div>GSTIN: {COMPANY.gstin}</div>
              </div>
            </div>
            <div
              style={{
                fontSize: 32,
                fontWeight: 700,
                letterSpacing: "0.05em",
                color: "#1a1a1a",
              }}
            >
              INVOICE
            </div>
          </div>

          {/* Invoice meta — bordered two-pane row exactly like the PDF:
          left pane has the invoice fields with BOLD values, right pane has
          Place Of Supply. */}
          <div className="ip-meta-block">
            <div className="ip-meta-left">
              <div className="ip-meta-row">
                <span className="k">Invoice Number</span>
                <span className="v">: {invoice.invoice_number}</span>
              </div>
              <div className="ip-meta-row">
                <span className="k">Invoice Date</span>
                <span className="v">: {fmtDateDMY(invoice.invoice_date)}</span>
              </div>
              <div className="ip-meta-row">
                <span className="k">Terms</span>
                <span className="v">: Due on Receipt</span>
              </div>
              <div className="ip-meta-row">
                <span className="k">Due Date</span>
                <span className="v">: {fmtDateDMY(invoice.due_date)}</span>
              </div>
              {(invoice as any).po_number && (
                <div className="ip-meta-row">
                  <span className="k">P.O. Number</span>
                  <span className="v">: {(invoice as any).po_number}</span>
                </div>
              )}
            </div>
            <div className="ip-meta-right">
              <div className="ip-meta-row">
                <span className="k">Place Of Supply</span>
                <span className="v">: {COMPANY.gstState}</span>
              </div>
            </div>
          </div>

          {/* Bill To / Ship To */}
          <div
            className="ip-billship"
            style={{ border: "none", borderBottom: "1.5px solid #333" }}
          >
            <div className="ip-billship-col">
              <div className="ip-billship-label">Bill To</div>
              <div style={{ fontWeight: 700, color: "#1a4fa0" }}>
                {customer?.display_name || customer?.name}
              </div>
              <div>{billTo}</div>
              <div>India</div>
              {customer?.gstin && <div>GSTIN {customer.gstin}</div>}
            </div>
            <div className="ip-billship-col">
              <div className="ip-billship-label">Ship To</div>
              <div style={{ fontWeight: 700 }}>
                {customer?.display_name || customer?.name}
              </div>
              <div>{billTo}</div>
              <div>India</div>
              {customer?.gstin && <div>GSTIN {customer.gstin}</div>}
            </div>
          </div>

          {/* Subject */}
          <div className="ip-section">
            {invoice.notes && (
              <div style={{ fontSize: 13, marginBottom: 12 }}>
                Subject :
                <br />
                {invoice.notes}
              </div>
            )}

            {/* Line items */}
            <table className="ip-items-table">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>S.No</th>
                  <th>Item &amp; Description</th>
                  <th style={{ width: 80 }}>HSN / SAC</th>
                  <th style={{ width: 50, textAlign: "right" }}>Qty</th>
                  <th style={{ width: 80, textAlign: "right" }}>Rate</th>
                  {intraState ? (
                    <>
                      <th style={{ width: 80, textAlign: "right" }}>CGST</th>
                      <th style={{ width: 80, textAlign: "right" }}>SGST</th>
                    </>
                  ) : (
                    <th style={{ width: 90, textAlign: "right" }}>IGST</th>
                  )}
                  <th style={{ width: 90, textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.line_items.map((l, i) => {
                  const eff = l.unitSalePrice * (1 - (l.discount ?? 0) / 100);
                  const lineAmount = eff * l.qty;
                  const lineTax = (lineAmount * invoice.gst_rate) / 100;
                  const half = lineTax / 2;
                  return (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>
                        <div>{l.model}</div>
                        {l.description && <div>{l.description}</div>}
                        {(l.serialNumbers?.filter(Boolean).length ?? 0) > 0 && (
                          <div>
                            S/N: {l.serialNumbers.filter(Boolean).join(" & ")}
                          </div>
                        )}
                      </td>
                      <td>{l.hsn}</td>
                      <td style={{ textAlign: "right" }}>
                        {l.qty.toFixed(2)}
                        <br />
                        pcs
                      </td>
                      <td style={{ textAlign: "right" }}>{fmt2(eff)}</td>
                      {intraState ? (
                        <>
                          <td style={{ textAlign: "right" }}>{fmt2(half)}</td>
                          <td style={{ textAlign: "right" }}>{fmt2(half)}</td>
                        </>
                      ) : (
                        <td style={{ textAlign: "right" }}>{fmt2(lineTax)}</td>
                      )}
                      <td style={{ textAlign: "right" }}>{fmt2(lineAmount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Totals + amount in words + bank details */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 16,
                gap: 20,
              }}
            >
              <div style={{ fontSize: 13, flex: 1 }}>
                <div style={{ marginBottom: 10 }}>
                  <strong>Total In Words</strong>
                  <br />
                  <em>{amountInWords(invoice.total)}</em>
                </div>
                <div>Bank Name: {bank.name}</div>
                <div>Account Number: {bank.account}</div>
                <div>Branch Name: {bank.branch}</div>
                <div>IFSC Code: {bank.ifsc}</div>
              </div>

              <div style={{ width: 270, fontSize: 13 }}>
                <table className="ip-totals-table">
                  <tbody>
                    <tr>
                      <td>Sub Total</td>
                      <td style={{ textAlign: "right" }}>
                        {fmt2(invoice.subtotal)}
                      </td>
                    </tr>
                    {intraState ? (
                      <>
                        <tr>
                          <td>
                            CGST{halfRate} ({halfRate}%)
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {fmt2(invoice.gst_amount / 2)}
                          </td>
                        </tr>
                        <tr>
                          <td>
                            SGST{halfRate} ({halfRate}%)
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {fmt2(invoice.gst_amount / 2)}
                          </td>
                        </tr>
                      </>
                    ) : (
                      <tr>
                        <td>IGST ({invoice.gst_rate}%)</td>
                        <td style={{ textAlign: "right" }}>
                          {fmt2(invoice.gst_amount)}
                        </td>
                      </tr>
                    )}
                    <tr className="ip-total-row">
                      <td>Total</td>
                      <td style={{ textAlign: "right" }}>
                        Rs.{fmt2(invoice.total)}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <div
                  style={{
                    marginTop: 60,
                    borderTop: "1px solid #1a1a1a",
                    paddingTop: 4,
                    textAlign: "center",
                    fontSize: 12,
                  }}
                >
                  Authorized Signatory
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
