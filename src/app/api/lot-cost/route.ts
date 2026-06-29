// src/app/api/lot-cost/route.ts
//
// GET /api/lot-cost?model=101&location=Kochi
// Returns the oldest open FIFO lot for a model+location from Supabase.
// Used by the Price Finder to show the real purchase cost.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const model = searchParams.get("model");
    const location = searchParams.get("location"); // optional filter

    if (!model) {
      return NextResponse.json(
        { error: "model param required" },
        { status: 400 },
      );
    }

    const supabase = getSupabase();

    let query = supabase
      .from("lots")
      .select(
        "lot_id, date, model, location, qty_purchased, remaining_qty, unit_purchase_price, vendor, po_invoice",
      )
      .eq("model", model)
      .gt("remaining_qty", 0) // open lots only
      .order("date", { ascending: true }) // oldest first = true FIFO
      .order("lot_id", { ascending: true });

    if (location) {
      query = query.eq("location", location);
    }

    const { data, error } = await query;
    if (error) throw error;

    const lots = data ?? [];

    if (lots.length === 0) {
      return NextResponse.json({ found: false, lots: [] });
    }

    // Oldest open lot = next one FIFO will consume
    const fifoLot = lots[0];

    // Weighted average across all open lots (for reference)
    const totalQty = lots.reduce((s: number, l: any) => s + l.remaining_qty, 0);
    const totalValue = lots.reduce(
      (s: number, l: any) => s + l.remaining_qty * l.unit_purchase_price,
      0,
    );
    const weightedAvg = totalQty > 0 ? totalValue / totalQty : 0;

    return NextResponse.json({
      found: true,
      fifoPrice: fifoLot.unit_purchase_price, // oldest lot — what FIFO will charge
      fifoLot: {
        lotId: fifoLot.lot_id,
        date: fifoLot.date,
        location: fifoLot.location,
        remaining: fifoLot.remaining_qty,
        price: fifoLot.unit_purchase_price,
        vendor: fifoLot.vendor,
        po: fifoLot.po_invoice,
      },
      weightedAvg,
      totalOpenQty: totalQty,
      allLots: lots.map((l: any) => ({
        lotId: l.lot_id,
        date: l.date,
        location: l.location,
        remaining: l.remaining_qty,
        price: l.unit_purchase_price,
        vendor: l.vendor,
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
