// src/app/api/transfer/route.ts
//
// MIGRATED to Supabase — previously 100% Google Sheets. Transfers move
// physical stock between Kochi and Bangalore. Because lots carry FIFO cost
// basis, a transfer moves the lot(s) themselves (oldest first) rather than
// just adjusting a single number — the receiving location gets an
// equivalent new lot with the SAME unit_purchase_price, so cost history and
// FIFO ordering both survive the move intact.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

async function getNextLotId(
  supabase: ReturnType<typeof getSupabase>,
): Promise<string> {
  const { data } = await supabase
    .from("lots")
    .select("lot_id")
    .like("lot_id", "LOT-%")
    .order("lot_id", { ascending: false })
    .limit(1);
  const last = data?.[0]?.lot_id ?? "LOT-0000";
  const num = parseInt(last.replace("LOT-", ""), 10) || 0;
  return `LOT-${String(num + 1).padStart(4, "0")}`;
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

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      model,
      fromLocation,
      toLocation,
      qty,
      courierCharges,
      remarks,
      date,
    } = body;

    if (!model || !fromLocation || !toLocation || !qty) {
      return NextResponse.json(
        { error: "model, fromLocation, toLocation, qty are required" },
        { status: 400 },
      );
    }
    if (
      !["Kochi", "Bangalore"].includes(fromLocation) ||
      !["Kochi", "Bangalore"].includes(toLocation) ||
      fromLocation === toLocation
    ) {
      return NextResponse.json(
        { error: "Invalid transfer direction" },
        { status: 400 },
      );
    }

    const supabase = getSupabase();
    const requestedQty = Number(qty);
    const txnDate = date ?? new Date().toISOString().split("T")[0];

    // 1. Load open source lots for this model+location, oldest first —
    //    same FIFO ordering used by dispatch.
    const { data: sourceLots, error: lotsErr } = await supabase
      .from("lots")
      .select(
        "lot_id, date, model, location, remaining_qty, unit_purchase_price, vendor, po_invoice, serial_numbers",
      )
      .eq("model", model)
      .eq("location", fromLocation)
      .gt("remaining_qty", 0)
      .order("date", { ascending: true })
      .order("lot_id", { ascending: true });

    if (lotsErr) throw lotsErr;

    const available = (sourceLots ?? []).reduce(
      (s: number, l: any) => s + Number(l.remaining_qty),
      0,
    );
    if (available < requestedQty) {
      return NextResponse.json(
        {
          error: `Insufficient stock in ${fromLocation}. Available: ${available}, requested: ${requestedQty}`,
        },
        { status: 400 },
      );
    }

    // 2. Consume oldest lots first, creating an equivalent lot at the
    //    destination (same cost basis) for each portion taken.
    let remaining = requestedQty;
    const lotUpdates: Array<{ lot_id: string; remaining_qty: number }> = [];
    const newLotInserts: any[] = [];

    for (const lot of sourceLots ?? []) {
      if (remaining <= 0) break;
      const take = Math.min(Number(lot.remaining_qty), remaining);
      const newLotId = await getNextLotId(supabase);

      lotUpdates.push({
        lot_id: lot.lot_id,
        remaining_qty: Number(lot.remaining_qty) - take,
      });

      newLotInserts.push({
        lot_id: newLotId,
        date: txnDate,
        model,
        location: toLocation,
        qty_purchased: take,
        remaining_qty: take,
        unit_purchase_price: lot.unit_purchase_price,
        vendor: `Transfer from ${fromLocation}${remarks ? " — " + remarks : ""}`,
        po_invoice: lot.po_invoice ?? "",
        // Serials travel with the stock too — take the first `take` from
        // this lot's remaining serials (already-purchase-order sorted).
        serial_numbers: Array.isArray(lot.serial_numbers)
          ? lot.serial_numbers.slice(0, take)
          : [],
      });

      remaining -= take;
    }

    // 3. Apply lot updates sequentially (Supabase JS client has no native
    //    multi-row batch update by differing values, so loop it — transfer
    //    qty is small/manual so this is a handful of calls at most).
    for (const u of lotUpdates) {
      const { error } = await supabase
        .from("lots")
        .update({ remaining_qty: u.remaining_qty })
        .eq("lot_id", u.lot_id);
      if (error) throw error;
    }

    const { error: newLotsErr } = await supabase
      .from("lots")
      .insert(newLotInserts);
    if (newLotsErr) throw newLotsErr;

    // 4. Log a Transfer transaction for visibility in Ledger/Transactions.
    //    Transfers don't affect FIFO cost the way sales/purchases do, so
    //    unit_price/cost_price are left at 0 — same as the old Sheets version.
    const txnId = await getNextTxnId(supabase);
    const { error: txnErr } = await supabase.from("transactions").insert({
      txn_id: txnId,
      date: txnDate,
      type: "Transfer",
      model,
      location: `${fromLocation} → ${toLocation}`,
      qty: requestedQty,
      unit_price: 0,
      total: Number(courierCharges ?? 0),
      party: remarks ?? "",
      po_invoice: "",
      status: "Completed",
    });
    if (txnErr) throw txnErr;

    // 5. Return updated totals for both locations (for the UI's optimistic
    //    "after transfer" preview) — computed fresh from lots.
    const { data: freshLots, error: freshErr } = await supabase
      .from("lots")
      .select("location, remaining_qty")
      .eq("model", model)
      .in("location", [fromLocation, toLocation]);
    if (freshErr) throw freshErr;

    const newFromStock = (freshLots ?? [])
      .filter((l: any) => l.location === fromLocation)
      .reduce((s: number, l: any) => s + Number(l.remaining_qty), 0);
    const newToStock = (freshLots ?? [])
      .filter((l: any) => l.location === toLocation)
      .reduce((s: number, l: any) => s + Number(l.remaining_qty), 0);

    return NextResponse.json({
      success: true,
      newFromStock,
      newToStock,
      lotsMoved: newLotInserts.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
