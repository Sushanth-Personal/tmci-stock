"use client";
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

const COMPANY = {
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
  bank: {
    name: "STATE BANK OF INDIA",
    account: "67299135280",
    branch: "PPB INDIRANAGAR, BANGALORE",
    ifsc: "SBIN0070679",
  },
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
  return TENS[t] + (o ? " " + ONES[o] : "");
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

function isIntraStateKerala(customer: any): boolean {
  const state = String(
    customer?.billing_state || customer?.state || "",
  ).toLowerCase();
  return state.includes("kerala");
}

export default function InvoicePaper({
  invoice,
}: {
  invoice: InvoicePaperData;
}) {
  const intraState = isIntraStateKerala(invoice.customer_snapshot);
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
    <div className="ip-paper">
      <style>{`
        .ip-paper {
          background: #ffffff; color: #1a1a1a; width: 100%; max-width: 860px;
          margin: 0 auto;
          box-shadow: 0 8px 30px rgba(0,0,0,0.4);
          font-family: Arial, Helvetica, sans-serif;
          padding: 34px 40px;
          font-size: 12.5px;
          line-height: 1.5;
        }
        .ip-hr { border: none; border-top: 1.5px solid #333; margin: 14px 0; }
        .ip-meta-table { border-collapse: collapse; width: 100%; }
        .ip-meta-table td { border: none; padding: 2px 0; font-size: 12.5px; vertical-align: top; }
        .ip-meta-label { font-weight: 700; width: 130px; }
        .ip-billship {
          display: grid; grid-template-columns: 1fr 1fr;
          border: 1px solid #333;
        }
        .ip-billship-col { padding: 8px 12px; }
        .ip-billship-col + .ip-billship-col { border-left: 1px solid #333; }
        .ip-billship-label {
          font-weight: 700; font-size: 12px; background: #f2f2f2;
          margin: -8px -12px 8px -12px; padding: 6px 12px;
          border-bottom: 1px solid #333;
        }
        .ip-items-table { border-collapse: collapse; width: 100%; }
        .ip-items-table th, .ip-items-table td {
          border: 1px solid #333; padding: 6px 8px; font-size: 12px; vertical-align: top;
        }
        .ip-items-table th { font-weight: 700; text-align: left; }
        .ip-totals-table { border-collapse: collapse; width: 100%; }
        .ip-totals-table td { border: none; padding: 3px 0; font-size: 12.5px; }
        .ip-totals-table tr.ip-total-row td {
          border-top: 1.5px solid #333; padding-top: 6px; font-weight: 700; font-size: 13.5px;
        }
      `}</style>

      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div style={{ display: "flex", gap: 14 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              border: "3px solid #1a2a6c",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 11,
              color: "#1a2a6c",
              flexShrink: 0,
            }}
          >
            TMCI
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.5 }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
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
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: "0.05em",
            color: "#1a1a1a",
          }}
        >
          INVOICE
        </div>
      </div>

      <hr className="ip-hr" />

      {/* Invoice meta */}
      <table className="ip-meta-table">
        <tbody>
          <tr>
            <td className="ip-meta-label">Invoice Number</td>
            <td>: {invoice.invoice_number}</td>
            <td className="ip-meta-label" style={{ width: 110 }}>
              Place Of Supply
            </td>
            <td>: {COMPANY.gstState}</td>
          </tr>
          <tr>
            <td className="ip-meta-label">Invoice Date</td>
            <td>: {fmtDateDMY(invoice.invoice_date)}</td>
            <td />
            <td />
          </tr>
          <tr>
            <td className="ip-meta-label">Terms</td>
            <td>: Due on Receipt</td>
            <td />
            <td />
          </tr>
          <tr>
            <td className="ip-meta-label">Due Date</td>
            <td>: {fmtDateDMY(invoice.due_date)}</td>
            <td />
            <td />
          </tr>
        </tbody>
      </table>

      <hr className="ip-hr" />

      {/* Bill To / Ship To */}
      <div className="ip-billship">
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
      {invoice.notes && (
        <div style={{ fontSize: 12, margin: "14px 0" }}>
          <strong>Subject :</strong>
          <br />
          {invoice.notes}
        </div>
      )}

      {/* Line items */}
      <table className="ip-items-table" style={{ marginTop: 12 }}>
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
                  <div style={{ fontWeight: 700 }}>{l.model}</div>
                  {l.description && <div>{l.description}</div>}
                  {l.serialNumbers?.filter(Boolean).map((sn, si) => (
                    <div key={si}>S/N:{sn}</div>
                  ))}
                </td>
                <td>{l.hsn}</td>
                <td style={{ textAlign: "right" }}>{l.qty.toFixed(2)}</td>
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
        <div style={{ fontSize: 12, flex: 1 }}>
          <div style={{ marginBottom: 10 }}>
            <strong>Total In Words</strong>
            <br />
            <em>{amountInWords(invoice.total)}</em>
          </div>
          <div>Bank Name: {COMPANY.bank.name}</div>
          <div>Account Number: {COMPANY.bank.account}</div>
          <div>Branch Name: {COMPANY.bank.branch}</div>
          <div>IFSC Code: {COMPANY.bank.ifsc}</div>
        </div>

        <div style={{ width: 260, fontSize: 12 }}>
          <table className="ip-totals-table">
            <tbody>
              <tr>
                <td>Sub Total</td>
                <td style={{ textAlign: "right" }}>{fmt2(invoice.subtotal)}</td>
              </tr>
              {intraState ? (
                <>
                  <tr>
                    <td>CGST ({halfRate}%)</td>
                    <td style={{ textAlign: "right" }}>
                      {fmt2(invoice.gst_amount / 2)}
                    </td>
                  </tr>
                  <tr>
                    <td>SGST ({halfRate}%)</td>
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
                <td style={{ textAlign: "right" }}>Rs.{fmt2(invoice.total)}</td>
              </tr>
            </tbody>
          </table>
          <div
            style={{
              marginTop: 60,
              borderTop: "1px solid #1a1a1a",
              paddingTop: 4,
              textAlign: "center",
              fontSize: 11,
            }}
          >
            Authorized Signatory
          </div>
        </div>
      </div>
    </div>
  );
}
