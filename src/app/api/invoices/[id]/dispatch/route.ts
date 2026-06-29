// src/app/api/invoices/[id]/dispatch/route.ts
//
// PATCH — dispatch an invoice
//   1. FIFO consumption from Supabase `lots` table
//   2. Update Supabase `stock` table (current_stock, sold)
//   3. Insert rows into Supabase `transactions` table
//   4. Mark invoice as dispatched in Supabase `sale_invoices`
//
// Zero Google Sheets dependency — Supabase is the source of truth.
//
// DELETE — cancel a pending invoice (no stock was touched, no reversal needed)

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

// ─── FIFO consumption (Supabase lots table) ───────────────────────────────────
async function consumeFifoSupabase(
  supabase: ReturnType<typeof getSupabase>,
  model: string,
  location: string,
  qty: number,
): Promise<{
  weightedCost: number;
  breakdown: Array<{ lotId: string; qtyTaken: number; unitPrice: number }>;
}> {
  // Fetch open lots for this model+location, oldest first
  const { data: lots, error } = await supabase
    .from("lots")
    .select("lot_id, date, remaining_qty, unit_purchase_price")
    .eq("model", model)
    .eq("location", location)
    .gt("remaining_qty", 0)
    .order("date", { ascending: true })
    .order("lot_id", { ascending: true });

  if (error) throw new Error(`Lots fetch failed: ${error.message}`);
  if (!lots || lots.length === 0)
    throw new Error(`No open lots for ${model} in ${location}`);

  const totalAvailable = lots.reduce(
    (s: number, l: any) => s + l.remaining_qty,
    0,
  );
  if (totalAvailable < qty) {
    throw new Error(
      `Insufficient stock for ${model} in ${location}. Available: ${totalAvailable}, required: ${qty}`,
    );
  }

  let remaining = qty;
  let totalCost = 0;
  const breakdown: Array<{
    lotId: string;
    qtyTaken: number;
    unitPrice: number;
  }> = [];

  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.remaining_qty, remaining);
    const newRemaining = lot.remaining_qty - take;

    // Update this lot's remaining_qty in Supabase
    const { error: updateErr } = await supabase
      .from("lots")
      .update({ remaining_qty: newRemaining })
      .eq("lot_id", lot.lot_id);

    if (updateErr)
      throw new Error(
        `Failed to update lot ${lot.lot_id}: ${updateErr.message}`,
      );

    totalCost += take * lot.unit_purchase_price;
    breakdown.push({
      lotId: lot.lot_id,
      qtyTaken: take,
      unitPrice: lot.unit_purchase_price,
    });
    remaining -= take;
  }

  return { weightedCost: totalCost / qty, breakdown };
}

// ─── Stock update (Supabase stock table) ─────────────────────────────────────
async function updateStockSupabase(
  supabase: ReturnType<typeof getSupabase>,
  model: string,
  location: string,
  qtySold: number,
) {
  // Get current stock row
  const { data: stockRow, error: fetchErr } = await supabase
    .from("stock")
    .select("id, current_stock, sold")
    .eq("model", model)
    .eq("location", location)
    .single();

  if (fetchErr || !stockRow) {
    // Stock row might not exist for this model+location — log but don't fail dispatch
    console.warn(
      `Stock row not found for ${model} @ ${location} — skipping stock update`,
    );
    return;
  }

  const { error: updateErr } = await supabase
    .from("stock")
    .update({
      current_stock: Math.max(0, (stockRow.current_stock || 0) - qtySold),
      sold: (stockRow.sold || 0) + qtySold,
      updated_at: new Date().toISOString(),
    })
    .eq("id", stockRow.id);

  if (updateErr)
    throw new Error(`Stock update failed for ${model}: ${updateErr.message}`);
}

// ─── Transaction logging (Supabase transactions table) ───────────────────────
async function getNextTxnId(
  supabase: ReturnType<typeof getSupabase>,
): Promise<string> {
  const { data } = await supabase
    .from("transactions")
    .select("txn_id")
    .like("txn_id", "TXN-%")
    .order("txn_id", { ascending: false })
    .limit(1);

  const last = data?.[0]?.txn_id ?? "TXN-0000";
  const num = parseInt(last.replace("TXN-", ""), 10) || 0;
  return `TXN-${String(num + 1).padStart(4, "0")}`;
}

// ─── PATCH — dispatch ─────────────────────────────────────────────────────────
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const supabase = getSupabase();

    // 1. Load invoice
    const { data: invoice, error: fetchErr } = await supabase
      .from("sale_invoices")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !invoice)
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    if (invoice.status === "dispatched")
      return NextResponse.json(
        { error: "Already dispatched" },
        { status: 409 },
      );
    if (invoice.status === "cancelled")
      return NextResponse.json(
        { error: "Cannot dispatch a cancelled invoice" },
        { status: 409 },
      );

    const lineItems: any[] = invoice.line_items ?? [];
    if (!lineItems.length)
      return NextResponse.json(
        { error: "Invoice has no line items" },
        { status: 400 },
      );

    const location = invoice.location;
    const customerName =
      invoice.customer_snapshot?.display_name ||
      invoice.customer_snapshot?.name ||
      invoice.customer_snapshot?.companyName ||
      "";
    const dispatchedAt = body.dispatched_at
      ? new Date(body.dispatched_at).toISOString()
      : new Date().toISOString();

    // 2. Pre-flight: verify stock availability for all lines before touching anything
    for (const line of lineItems) {
      const { data: lots } = await supabase
        .from("lots")
        .select("remaining_qty")
        .eq("model", line.model)
        .eq("location", location)
        .gt("remaining_qty", 0);

      const available = (lots ?? []).reduce(
        (s: number, l: any) => s + l.remaining_qty,
        0,
      );
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
    const txnResults = [];
    for (const line of lineItems) {
      const effectiveUnitPrice =
        line.unitSalePrice * (1 - (line.discount ?? 0) / 100);
      const lineTotal = effectiveUnitPrice * line.qty;

      // FIFO consumption from Supabase lots
      const fifoResult = await consumeFifoSupabase(
        supabase,
        line.model,
        location,
        line.qty,
      );
      const costPrice = +fifoResult.weightedCost.toFixed(2);

      // Update stock in Supabase
      await updateStockSupabase(supabase, line.model, location, line.qty);

      // Log transaction to Supabase transactions table
      const txnId = await getNextTxnId(supabase);
      const { error: txnErr } = await supabase.from("transactions").insert({
        txn_id: txnId,
        date: invoice.invoice_date,
        type: "Sale",
        item_code: line.itemCode || line.model,
        model: line.model,
        location: location,
        qty: line.qty,
        unit_price: effectiveUnitPrice,
        total: lineTotal,
        party: customerName,
        po_invoice: invoice.invoice_number,
        status: "Dispatched",
        cost_price: costPrice,
        invoice_date: invoice.invoice_date,
      });
      if (txnErr)
        throw new Error(`Transaction insert failed: ${txnErr.message}`);

      txnResults.push({
        model: line.model,
        txnId,
        costPrice,
        margin:
          effectiveUnitPrice > 0
            ? ((effectiveUnitPrice - costPrice) / effectiveUnitPrice) * 100
            : 0,
      });
    }

    // 4. Log charges as transactions (no stock impact)
    const charges: any[] = invoice.charges ?? [];
    for (const charge of charges) {
      if (!charge.amount || charge.amount <= 0) continue;
      const chargeTxnId = await getNextTxnId(supabase);
      await supabase.from("transactions").insert({
        txn_id: chargeTxnId,
        date: invoice.invoice_date,
        type: "Charges",
        item_code: "",
        model: charge.label,
        location: location,
        qty: 1,
        unit_price: charge.amount,
        total: +(charge.amount * (1 + invoice.gst_rate / 100)).toFixed(2),
        party: customerName,
        po_invoice: invoice.invoice_number,
        status: "Dispatched",
        cost_price: null,
      });
    }

    // 5. Mark invoice as dispatched
    const { error: updateErr } = await supabase
      .from("sale_invoices")
      .update({
        status: "dispatched",
        dispatched_at: dispatchedAt,
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

// ─── DELETE — cancel invoice ──────────────────────────────────────────────────
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

    if (fetchErr || !invoice)
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    if (invoice.status === "dispatched")
      return NextResponse.json(
        { error: "Cannot cancel an already-dispatched invoice" },
        { status: 409 },
      );

    const { error } = await supabase
      .from("sale_invoices")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
