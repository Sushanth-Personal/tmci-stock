// src/app/api/invoices/[id]/dispatch/route.ts
//
// PATCH — dispatch a pending invoice: FIFO-consume stock from lots, log Sale
//         transactions, mark invoice as dispatched.
// DELETE — cancel a pending invoice (no stock was ever touched, so just marks
//          it cancelled).
//
// FIX: model matching between invoice line_items and the lots table is now
// normalised (trim + collapse whitespace + lowercase) instead of an exact
// .eq() match. This prevents dispatch failing silently as "out of stock"
// when the invoice has e.g. "59 Mini" but lots has "59 MINI".

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

// Normalise for matching: remove ALL whitespace (not just collapse it) + lowercase.
// This handles "302+" vs "302 +" vs "302  +" vs "59 MINI" vs "59Mini" — anything
// where the only difference is spacing, since spacing is not semantically part
// of a model number.
function normModel(s: unknown): string {
  return String(s ?? "")
    .replace(/\s+/g, "")
    .toLowerCase()
    .trim();
}

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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const dispatchedAt: string =
      body.dispatched_at || new Date().toISOString().split("T")[0];

    const supabase = getSupabase();

    // 1. Load invoice
    const { data: invoice, error: invErr } = await supabase
      .from("sale_invoices")
      .select("*")
      .eq("id", id)
      .single();

    if (invErr || !invoice)
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    if (invoice.status !== "pending_dispatch")
      return NextResponse.json(
        {
          error: `Invoice is already ${invoice.status} — cannot dispatch again.`,
        },
        { status: 409 },
      );

    const location: string = invoice.location;
    const lineItems: any[] = invoice.line_items ?? [];

    if (lineItems.length === 0)
      return NextResponse.json(
        { error: "Invoice has no line items." },
        { status: 400 },
      );

    // 2. Load ALL open lots for this location once, then match in JS with
    //    normalised model names — avoids per-line exact-match DB queries
    //    silently missing on case/whitespace differences.
    const { data: allLots, error: lotsErr } = await supabase
      .from("lots")
      .select(
        "lot_id, model, remaining_qty, unit_purchase_price, date, serial_numbers",
      )
      .eq("location", location)
      .gt("remaining_qty", 0)
      .order("date", { ascending: true })
      .order("lot_id", { ascending: true });

    if (lotsErr) throw lotsErr;

    const lotsByModel = new Map<string, any[]>();
    for (const lot of allLots ?? []) {
      const key = normModel(lot.model);
      if (!lotsByModel.has(key)) lotsByModel.set(key, []);
      lotsByModel.get(key)!.push(lot);
    }

    // 3. Pre-flight check: verify enough stock exists for EVERY line before
    //    changing anything (all-or-nothing dispatch).
    const shortages: string[] = [];
    for (const item of lineItems) {
      const key = normModel(item.model);
      const lots = lotsByModel.get(key) ?? [];
      const available = lots.reduce((s, l) => s + Number(l.remaining_qty), 0);
      if (available < Number(item.qty)) {
        shortages.push(
          `${item.model}: need ${item.qty}, only ${available} available in ${location}`,
        );
      }
    }

    if (shortages.length > 0) {
      return NextResponse.json(
        {
          error: `Insufficient stock — ${shortages.join("; ")}. Check Stock view for exact model spelling.`,
        },
        { status: 400 },
      );
    }

    // 4. FIFO-consume each line item from matched lots. Real serial numbers
    //    are pulled from the lot's stored serial_numbers array — the FIRST
    //    remaining serials in that lot are taken (oldest stock first),
    //    replacing whatever was typed on the invoice form (which may have
    //    been blank or a placeholder from import).
    const lotUpdates: Array<{
      lot_id: string;
      remaining_qty: number;
      serial_numbers: string[];
    }> = [];
    const saleTxns: any[] = [];
    const updatedLineItems: any[] = [];

    for (const item of lineItems) {
      const key = normModel(item.model);
      const lots = lotsByModel.get(key) ?? [];
      let remaining = Number(item.qty);
      let costTotal = 0;
      const consumedSerials: string[] = [];

      for (const lot of lots) {
        if (remaining <= 0) break;

        const already = lotUpdates.find((u) => u.lot_id === lot.lot_id);
        const currentRemaining = already
          ? already.remaining_qty
          : Number(lot.remaining_qty);
        const currentSerials: string[] = already
          ? already.serial_numbers
          : Array.isArray(lot.serial_numbers)
            ? [...lot.serial_numbers]
            : [];

        if (currentRemaining <= 0) continue;

        const take = Math.min(currentRemaining, remaining);
        const newRemaining = currentRemaining - take;

        // Take the FIRST `take` serials from this lot (FIFO within the lot too —
        // they were stored in purchase order)
        const takenSerials = currentSerials.slice(0, take);
        const leftoverSerials = currentSerials.slice(take);
        consumedSerials.push(...takenSerials);

        if (already) {
          already.remaining_qty = newRemaining;
          already.serial_numbers = leftoverSerials;
        } else {
          lotUpdates.push({
            lot_id: lot.lot_id,
            remaining_qty: newRemaining,
            serial_numbers: leftoverSerials,
          });
        }

        costTotal += take * Number(lot.unit_purchase_price ?? 0);
        remaining -= take;
      }

      const txnId = await getNextTxnId(supabase);
      saleTxns.push({
        txn_id: txnId,
        date: dispatchedAt,
        type: "Sale",
        item_code: item.itemCode || "",
        model: item.model,
        location,
        qty: Number(item.qty),
        unit_price: Number(item.unitSalePrice) || 0,
        total:
          Number(item.qty) *
          (Number(item.unitSalePrice) || 0) *
          (1 - (Number(item.discount) || 0) / 100),
        party:
          invoice.customer_snapshot?.display_name ||
          invoice.customer_snapshot?.name ||
          "",
        po_invoice: invoice.invoice_number,
        status: "Dispatched",
        cost_price: Number(item.qty) > 0 ? costTotal / Number(item.qty) : 0,
        serial_numbers: consumedSerials,
      });

      // Replace the invoice line item's serials with the REAL ones taken from stock
      updatedLineItems.push({
        ...item,
        serialNumbers: consumedSerials,
      });
    }

    // 5. Apply all lot updates (remaining_qty AND serial_numbers)
    for (const u of lotUpdates) {
      const { error } = await supabase
        .from("lots")
        .update({
          remaining_qty: u.remaining_qty,
          serial_numbers: u.serial_numbers,
        })
        .eq("lot_id", u.lot_id);
      if (error) throw error;
    }

    // 6. Insert all Sale transactions
    const { error: txnInsertErr } = await supabase
      .from("transactions")
      .insert(saleTxns);
    if (txnInsertErr) throw txnInsertErr;

    // 7. Mark invoice dispatched AND overwrite line_items with real serials
    const { error: updateInvErr } = await supabase
      .from("sale_invoices")
      .update({
        status: "dispatched",
        dispatched_at: dispatchedAt,
        line_items: updatedLineItems,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateInvErr) throw updateInvErr;

    return NextResponse.json({
      success: true,
      invoiceNumber: invoice.invoice_number,
      dispatchedAt,
      lotsUpdated: lotUpdates.length,
      transactionsCreated: saleTxns.length,
      serialsAssigned: saleTxns.reduce(
        (s, t) => s + (t.serial_numbers?.length ?? 0),
        0,
      ),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = getSupabase();

    const { data: invoice, error: invErr } = await supabase
      .from("sale_invoices")
      .select("status")
      .eq("id", id)
      .single();

    if (invErr || !invoice)
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    if (invoice.status !== "pending_dispatch")
      return NextResponse.json(
        { error: "Only pending invoices can be cancelled this way." },
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
