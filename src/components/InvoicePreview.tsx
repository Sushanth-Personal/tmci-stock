"use client";
// src/components/InvoicePreview.tsx
//
// A dedicated "print preview" screen: searchable invoice list on the left,
// a pixel-close replica of TMCI's actual printed invoice layout on the
// right (matches the Zoho Books PDF export exactly — letterhead, Bill
// To/Ship To, HSN table with CGST/SGST split, amount in words, bank
// details, signatory line).
//
// This is presentational only — it reads existing invoices via
// /api/invoices and renders them in this fixed paper layout. It does not
// replace the operational Invoices.tsx screen (search/dispatch/cancel etc).

import { useState, useEffect, useMemo } from "react";

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

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  customer_snapshot: any;
  location: string;
  line_items: LineItem[];
  subtotal: number;
  gst_rate: number;
  gst_amount: number;
  total: number;
  notes: string | null;
  status: string;
}

// ── Company letterhead constants (from the actual TMCI invoice PDF) ──────────
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

// ── Indian-numbering number-to-words (Rupees / Paise) ────────────────────────
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

// Indian grouping: crore, lakh, thousand, hundred
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

// Is this an intra-state (Kerala-to-Kerala) sale? Business is in Kerala, so
// CGST+SGST applies within-state; otherwise it's IGST across state lines —
// same real-world GST rule the source PDF's layout assumes.
function isIntraStateKerala(customer: any): boolean {
  const state = String(
    customer?.billing_state || customer?.state || "",
  ).toLowerCase();
  return state.includes("kerala");
}

export default function InvoicePreview() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/invoices?limit=200")
      .then((r) => r.json())
      .then((d) => {
        const list: Invoice[] = d.invoices ?? [];
        setInvoices(list);
        if (list.length > 0) setSelectedId(list[0].id);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return invoices;
    const q = search.toLowerCase();
    return invoices.filter((inv) => {
      const name =
        inv.customer_snapshot?.display_name ||
        inv.customer_snapshot?.name ||
        "";
      return (
        inv.invoice_number.toLowerCase().includes(q) ||
        name.toLowerCase().includes(q) ||
        inv.line_items.some((l) => l.model?.toLowerCase().includes(q))
      );
    });
  }, [invoices, search]);

  const selected = invoices.find((i) => i.id === selectedId) ?? null;
  const intraState = selected
    ? isIntraStateKerala(selected.customer_snapshot)
    : true;
  const halfRate = (selected?.gst_rate ?? 18) / 2;

  const customer = selected?.customer_snapshot;
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
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      <style>{`
        .ip-list-item { padding: 10px 12px; border-bottom: 1px solid var(--border); cursor: pointer; }
        .ip-list-item:hover { background: rgba(255,255,255,0.03); }
        .ip-list-item.active { background: rgba(59,130,246,0.08); border-left: 2px solid var(--accent); }
        .ip-paper-scroll { flex: 1; overflow: auto; background: #3a3d45; padding: 24px; display: flex; justify-content: center; }
        .ip-paper {
          background: #ffffff; color: #1a1a1a; width: 900px; max-width: 100%;
          box-shadow: 0 8px 30px rgba(0,0,0,0.4); font-family: "Times New Roman", Georgia, serif;
          padding: 32px 36px;
        }
        .ip-paper table { border-collapse: collapse; width: 100%; }
        .ip-paper th, .ip-paper td { border: 1px solid #999; padding: 6px 8px; font-size: 12px; }
        .ip-paper th { background: #f2f2f2; font-weight: 700; text-align: left; }
      `}</style>

      {/* Left: invoice list */}
      <div
        style={{
          width: 300,
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <input
            placeholder="Search invoice #, customer, product…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div
              style={{ padding: 16, fontSize: 12, color: "var(--text-muted)" }}
            >
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div
              style={{ padding: 16, fontSize: 12, color: "var(--text-muted)" }}
            >
              No invoices found.
            </div>
          ) : (
            filtered.map((inv) => {
              const name =
                inv.customer_snapshot?.display_name ||
                inv.customer_snapshot?.name ||
                "—";
              return (
                <div
                  key={inv.id}
                  className={`ip-list-item${selectedId === inv.id ? " active" : ""}`}
                  onClick={() => setSelectedId(inv.id)}
                >
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{name}</div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      marginTop: 2,
                    }}
                  >
                    {inv.invoice_number} · {fmtDateDMY(inv.invoice_date)}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--accent-green)",
                      marginTop: 3,
                    }}
                  >
                    ₹{fmt2(inv.total)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right: pixel-close print-style preview */}
      <div className="ip-paper-scroll">
        {!selected ? (
          <div style={{ color: "#ccc", fontSize: 13, alignSelf: "center" }}>
            Select an invoice to preview
          </div>
        ) : (
          <div className="ip-paper">
            {/* Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                borderBottom: "2px solid #1a1a1a",
                paddingBottom: 12,
                marginBottom: 12,
              }}
            >
              <div style={{ display: "flex", gap: 14 }}>
                {/* Simple placeholder logo mark */}
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
                  <div
                    style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}
                  >
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

            {/* Invoice meta */}
            <table style={{ marginBottom: 0 }}>
              <tbody>
                <tr>
                  <td style={{ width: "50%" }}>
                    <strong>Invoice Number</strong>
                  </td>
                  <td>: {selected.invoice_number}</td>
                  <td style={{ width: "20%" }}>
                    <strong>Place Of Supply</strong>
                  </td>
                  <td>: {COMPANY.gstState}</td>
                </tr>
                <tr>
                  <td>
                    <strong>Invoice Date</strong>
                  </td>
                  <td>: {fmtDateDMY(selected.invoice_date)}</td>
                  <td />
                  <td />
                </tr>
                <tr>
                  <td>
                    <strong>Terms</strong>
                  </td>
                  <td>: Due on Receipt</td>
                  <td />
                  <td />
                </tr>
                <tr>
                  <td>
                    <strong>Due Date</strong>
                  </td>
                  <td>: {fmtDateDMY(selected.due_date)}</td>
                  <td />
                  <td />
                </tr>
              </tbody>
            </table>

            {/* Bill To / Ship To */}
            <table style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th style={{ width: "50%" }}>Bill To</th>
                  <th>Ship To</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ verticalAlign: "top" }}>
                    <div style={{ fontWeight: 700, color: "#1a4fa0" }}>
                      {customer?.display_name || customer?.name}
                    </div>
                    <div>{billTo}</div>
                    <div>India</div>
                    {customer?.gstin && <div>GSTIN {customer.gstin}</div>}
                  </td>
                  <td style={{ verticalAlign: "top" }}>
                    <div style={{ fontWeight: 700 }}>
                      {customer?.display_name || customer?.name}
                    </div>
                    <div>{billTo}</div>
                    <div>India</div>
                    {customer?.gstin && <div>GSTIN {customer.gstin}</div>}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Subject */}
            {selected.notes && (
              <div style={{ fontSize: 12, margin: "12px 0" }}>
                <strong>Subject :</strong>
                <br />
                {selected.notes}
              </div>
            )}

            {/* Line items */}
            <table style={{ marginTop: 10 }}>
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
                {selected.line_items.map((l, i) => {
                  const eff = l.unitSalePrice * (1 - (l.discount ?? 0) / 100);
                  const lineAmount = eff * l.qty;
                  const lineTax = (lineAmount * selected.gst_rate) / 100;
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
                marginTop: 14,
                gap: 20,
              }}
            >
              <div style={{ fontSize: 12, flex: 1 }}>
                <div style={{ marginBottom: 10 }}>
                  <strong>Total In Words</strong>
                  <br />
                  <em>{amountInWords(selected.total)}</em>
                </div>
                <div>Bank Name: {COMPANY.bank.name}</div>
                <div>Account Number: {COMPANY.bank.account}</div>
                <div>Branch Name: {COMPANY.bank.branch}</div>
                <div>IFSC Code: {COMPANY.bank.ifsc}</div>
              </div>

              <div style={{ width: 260, fontSize: 12 }}>
                <table>
                  <tbody>
                    <tr>
                      <td>Sub Total</td>
                      <td style={{ textAlign: "right" }}>
                        {fmt2(selected.subtotal)}
                      </td>
                    </tr>
                    {intraState ? (
                      <>
                        <tr>
                          <td>
                            CGST{halfRate.toFixed(0)} ({halfRate}%)
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {fmt2(selected.gst_amount / 2)}
                          </td>
                        </tr>
                        <tr>
                          <td>
                            SGST{halfRate.toFixed(0)} ({halfRate}%)
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {fmt2(selected.gst_amount / 2)}
                          </td>
                        </tr>
                      </>
                    ) : (
                      <tr>
                        <td>IGST ({selected.gst_rate}%)</td>
                        <td style={{ textAlign: "right" }}>
                          {fmt2(selected.gst_amount)}
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td style={{ fontWeight: 700 }}>Total</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>
                        Rs.{fmt2(selected.total)}
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
                    fontSize: 11,
                  }}
                >
                  Authorized Signatory
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
