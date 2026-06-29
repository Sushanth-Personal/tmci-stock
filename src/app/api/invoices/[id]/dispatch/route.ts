// src/app/api/invoices/[id]/dispatch/route.ts
//
// PATCH /api/invoices/<uuid>/dispatch
//
// This is the moment stock gets deducted.
// For each line item in the invoice:
//   1. consumeFifo(itemCode, location, qty)  → deducts from oldest lots
//   2. syncStockRow(...)                     → updates Stock rollup sheet
//   3. appendRows(SHEETS.TRANSACTIONS, ...)  → logs a Sale transaction row
// Then marks the invoice status = "dispatched" in Supabase.
//
// If ANY step fails the API returns an error — partial states are possible
// on network failures so the UI should reload and show current state before retrying.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  fetchProducts,
  fetchStock,
  getNextTxnId,
  consumeFifo,
  syncStockRow,
  appendRows,
  SHEETS,
} from "@/lib/sheets";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = getSupabase();

    // 1. Load invoice from Supabase
    const { data: invoice, error: fetchErr } = await supabase
      .from("sale_invoices")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    if (invoice.status === "dispatched") {
      return NextResponse.json(
        { error: "Invoice already dispatched" },
        { status: 409 },
      );
    }

    if (invoice.status === "cancelled") {
      return NextResponse.json(
        { error: "Cannot dispatch a cancelled invoice" },
        { status: 409 },
      );
    }

    const lineItems: Array<{
      model: string;
      itemCode: string;
      hsn: string;
      qty: number;
      unitSalePrice: number;
      discount: number;
      serialNumbers: string[];
    }> = invoice.line_items;

    if (!lineItems?.length) {
      return NextResponse.json(
        { error: "Invoice has no line items" },
        { status: 400 },
      );
    }

    const products = await fetchProducts();
    const stock = await fetchStock();
    const location = invoice.location;

    // 2. Pre-flight: check stock availability for all lines before touching anything
    for (const line of lineItems) {
      const stockRows = stock.filter(
        (s) => s.itemCode === line.itemCode && s.location === location,
      );
      const available = stockRows.reduce((s, r) => s + r.currentStock, 0);
      if (available < line.qty) {
        return NextResponse.json(
          {
            error: `Insufficient stock for ${line.model} at ${location}. Available: ${available}, required: ${line.qty}`,
          },
          { status: 400 },
        );
      }
    }

    // 3. Process each line item
    const txnResults: Array<{
      model: string;
      txnId: string;
      costPrice: number;
      margin: number;
    }> = [];

    // Reload stock fresh before processing (avoid stale values between lines)
    let currentStock = await fetchStock();
    const customerName =
      invoice.customer_snapshot?.name ??
      invoice.customer_snapshot?.companyName ??
      "";

    for (const line of lineItems) {
      const product = products.find(
        (p) => p.itemCode === line.itemCode || p.model === line.model,
      );
      if (!product) {
        return NextResponse.json(
          { error: `Product not found: ${line.model}` },
          { status: 404 },
        );
      }

      // FIFO consumption
      const fifoResult = await consumeFifo(
        product.itemCode,
        location,
        line.qty,
      );

      // Effective unit sale price after discount
      const effectiveUnitPrice =
        line.unitSalePrice * (1 - (line.discount ?? 0) / 100);
      const lineTotal = effectiveUnitPrice * line.qty;
      const txnId = await getNextTxnId();
      const costPrice = +fifoResult.weightedCost.toFixed(2);
      const margin =
        effectiveUnitPrice > 0
          ? ((effectiveUnitPrice - costPrice) / effectiveUnitPrice) * 100
          : 0;

      // Log transaction row — include invoice number in poOrInvoice field
      await appendRows(SHEETS.TRANSACTIONS, "A:M", [
        [
          txnId,
          invoice.invoice_date,
          "Sale",
          product.itemCode,
          line.model,
          location,
          line.qty,
          effectiveUnitPrice,
          lineTotal,
          customerName,
          invoice.invoice_number,
          "Dispatched",
          costPrice,
        ],
      ]);

      // Update Stock rollup
      const existingStockRow = currentStock.find(
        (s) => s.itemCode === product.itemCode && s.location === location,
      );
      const newCurrentStock = (existingStockRow?.currentStock ?? 0) - line.qty;

      await syncStockRow(
        product.itemCode,
        line.model,
        product.description,
        location as "Kochi" | "Bangalore",
        0,
        line.qty,
        newCurrentStock,
      );

      // Update local stock snapshot so next line sees updated numbers
      currentStock = await fetchStock();

      txnResults.push({ model: line.model, txnId, costPrice, margin });
    }

    // 4. Log each charge as a "Charges" transaction row in Google Sheets.
    //    These rows carry no itemCode/model and do not touch FIFO lots or stock.
    //    They exist purely for P&L visibility in the Transactions sheet.
    const charges: Array<{ label: string; amount: number }> =
      invoice.charges ?? [];

    for (const charge of charges) {
      if (!charge.amount || charge.amount <= 0) continue;
      const chargeTxnId = await getNextTxnId();
      const chargeGst = +(charge.amount * (invoice.gst_rate / 100)).toFixed(2);
      const chargeTotal = +(charge.amount + chargeGst).toFixed(2);

      await appendRows(SHEETS.TRANSACTIONS, "A:M", [
        [
          chargeTxnId,
          invoice.invoice_date,
          "Charges", // Type = Charges (distinct from Sale)
          "", // itemCode — not applicable
          charge.label, // model column repurposed as charge label
          location,
          1, // qty = 1 (lump-sum charge)
          charge.amount, // unit price = charge amount ex-GST
          chargeTotal, // total incl. GST
          customerName,
          invoice.invoice_number,
          "Dispatched",
          "", // costPrice — not applicable
        ],
      ]);
    }

    // 5. Mark invoice as dispatched in Supabase
    const { error: updateErr } = await supabase
      .from("sale_invoices")
      .update({
        status: "dispatched",
        dispatched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateErr) throw updateErr;

    return NextResponse.json({
      success: true,
      invoiceId: id,
      invoiceNumber: invoice.invoice_number,
      transactions: txnResults,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/invoices/<uuid>/dispatch?action=cancel — cancel instead
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = getSupabase();

    const { data: invoice, error: fetchErr } = await supabase
      .from("sale_invoices")
      .select("status")
      .eq("id", id)
      .single();

    if (fetchErr || !invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    if (invoice.status === "dispatched") {
      return NextResponse.json(
        { error: "Cannot cancel an already-dispatched invoice" },
        { status: 409 },
      );
    }

    const { error: updateErr } = await supabase
      .from("sale_invoices")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", id);

    if (updateErr) throw updateErr;

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
