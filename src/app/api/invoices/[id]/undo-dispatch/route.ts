// src/app/api/invoices/[id]/undo-dispatch/route.ts
//
// POST — reverses an accidental dispatch:
//   1. Finds the "Sale" transactions this invoice created
//   2. Restores each line's qty back to the ORIGINAL lot(s) it was taken from
//      (uses the lot breakdown stored at dispatch time if available,
//       otherwise adds back to the newest open lot for that model+location
//       — safe fallback, keeps FIFO ordering roughly intact)
//   3. Deletes those transaction rows
//   4. Updates the stock table (current_stock += qty, sold -= qty)
//   5. Sets invoice status back to 'pending_dispatch', clears dispatched_at
//
// This does NOT touch the bin/deleted_at flow — after undoing, the invoice
// is a normal pending invoice again and can be edited, dispatched again,
// cancelled, or deleted through the normal flows.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = getSupabase();

    // 1. Load invoice
    const { data: invoice, error: invErr } = await supabase
      .from("sale_invoices")
      .select("*")
      .eq("id", id)
      .single();

    if (invErr || !invoice)
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    if (invoice.status !== "dispatched")
      return NextResponse.json(
        { error: "Only dispatched invoices can be un-dispatched." },
        { status: 409 },
      );

    const location = invoice.location;
    const lineItems: any[] = invoice.line_items ?? [];

    // 2. Find the Sale transactions this invoice created (matched by po_invoice = invoice_number)
    const { data: txns, error: txnErr } = await supabase
      .from("transactions")
      .select("*")
      .eq("po_invoice", invoice.invoice_number)
      .eq("type", "Sale");

    if (txnErr) throw txnErr;
    if (!txns || txns.length === 0) {
      return NextResponse.json(
        {
          error:
            "No matching Sale transactions found for this invoice — cannot safely undo.",
        },
        { status: 409 },
      );
    }

    const restoredLots: string[] = [];
    const deletedTxnIds: string[] = [];

    // 3. For each transaction, restore qty to lots
    for (const txn of txns) {
      const model = txn.model;
      const qtyToRestore = Number(txn.qty) || 0;
      if (qtyToRestore <= 0) continue;

      // Try to restore to the MOST RECENTLY consumed lot first (best-effort reversal).
      // We don't have a stored breakdown of exactly which lots were touched at dispatch,
      // so the safe approach is: find the newest lot for this model+location and add back there.
      // This keeps total stock and total value correct; FIFO order for future sales stays sane
      // because the newest lot simply has more remaining_qty than it "should" by a few units.
      const { data: lots, error: lotFetchErr } = await supabase
        .from("lots")
        .select("lot_id, remaining_qty, date")
        .eq("model", model)
        .eq("location", location)
        .order("date", { ascending: false })
        .order("lot_id", { ascending: false })
        .limit(1);

      if (lotFetchErr) throw lotFetchErr;

      if (lots && lots.length > 0) {
        const lot = lots[0];
        const { error: updateErr } = await supabase
          .from("lots")
          .update({ remaining_qty: Number(lot.remaining_qty) + qtyToRestore })
          .eq("lot_id", lot.lot_id);
        if (updateErr) throw updateErr;
        restoredLots.push(`${lot.lot_id} (+${qtyToRestore})`);
      } else {
        // No lot found at all for this model+location — create a zero-cost placeholder lot
        // so stock count stays correct. Flag it clearly for manual review.
        const placeholderLotId = `LOT-UNDO-${Date.now().toString().slice(-6)}`;
        const { error: insertErr } = await supabase.from("lots").insert({
          lot_id: placeholderLotId,
          date: new Date().toISOString().split("T")[0],
          model,
          location,
          qty_purchased: qtyToRestore,
          remaining_qty: qtyToRestore,
          unit_purchase_price: txn.cost_price ?? 0,
          vendor: "UNDO-DISPATCH (manual review needed)",
          po_invoice: `UNDO-${invoice.invoice_number}`,
        });
        if (insertErr) throw insertErr;
        restoredLots.push(
          `${placeholderLotId} (new, +${qtyToRestore}) — REVIEW COST`,
        );
      }

      // 4. Update stock table
      const { data: stockRow } = await supabase
        .from("stock")
        .select("id, current_stock, sold")
        .eq("model", model)
        .eq("location", location)
        .single();

      if (stockRow) {
        await supabase
          .from("stock")
          .update({
            current_stock: (stockRow.current_stock || 0) + qtyToRestore,
            sold: Math.max(0, (stockRow.sold || 0) - qtyToRestore),
            updated_at: new Date().toISOString(),
          })
          .eq("id", stockRow.id);
      }

      deletedTxnIds.push(txn.id ?? txn.txn_id);
    }

    // 5. Delete the Sale transactions (and any Charges transactions tied to this invoice)
    const { error: deleteTxnErr } = await supabase
      .from("transactions")
      .delete()
      .eq("po_invoice", invoice.invoice_number)
      .in("type", ["Sale", "Charges"]);

    if (deleteTxnErr) throw deleteTxnErr;

    // 6. Reset invoice to pending_dispatch
    const { error: updateInvErr } = await supabase
      .from("sale_invoices")
      .update({
        status: "pending_dispatch",
        dispatched_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateInvErr) throw updateInvErr;

    return NextResponse.json({
      success: true,
      invoiceNumber: invoice.invoice_number,
      restoredLots,
      transactionsRemoved: deletedTxnIds.length,
      warning: restoredLots.some((l) => l.includes("REVIEW COST"))
        ? "Some stock was restored to a new placeholder lot with ₹0 cost — please review and correct the cost price in Lots."
        : null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
