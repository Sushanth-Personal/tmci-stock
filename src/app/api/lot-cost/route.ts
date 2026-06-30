// src/app/api/lot-cost/route.ts
// Reads everything from lots table — single source of truth

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
    const location = searchParams.get("location");

    if (!model)
      return NextResponse.json(
        { error: "model param required" },
        { status: 400 },
      );

    const supabase = getSupabase();

    let query = supabase
      .from("lots")
      .select(
        "lot_id, date, model, location, qty_purchased, remaining_qty, unit_purchase_price, vendor, po_invoice",
      )
      .ilike("model", model)
      .gt("remaining_qty", 0)
      .order("date", { ascending: true })
      .order("lot_id", { ascending: true });

    if (location) query = query.ilike("location", location);

    const { data, error } = await query;
    if (error) throw error;

    const lots = data ?? [];

    // Total open qty directly from lots — single source of truth
    const totalOpenQty = lots.reduce(
      (s: number, l: any) => s + Number(l.remaining_qty),
      0,
    );

    if (lots.length === 0) {
      return NextResponse.json({ found: false, totalOpenQty: 0, lots: [] });
    }

    const fifoLot = lots[0];
    const totalValue = lots.reduce(
      (s: number, l: any) =>
        s + Number(l.remaining_qty) * Number(l.unit_purchase_price),
      0,
    );
    const weightedAvg = totalOpenQty > 0 ? totalValue / totalOpenQty : 0;

    return NextResponse.json({
      found: true,
      fifoPrice: Number(fifoLot.unit_purchase_price),
      fifoLot: {
        lotId: fifoLot.lot_id,
        date: fifoLot.date,
        location: fifoLot.location,
        remaining: Number(fifoLot.remaining_qty),
        price: Number(fifoLot.unit_purchase_price),
        vendor: fifoLot.vendor,
        po: fifoLot.po_invoice,
      },
      weightedAvg,
      totalOpenQty,
      allLots: lots.map((l: any) => ({
        lotId: l.lot_id,
        date: l.date,
        location: l.location,
        remaining: Number(l.remaining_qty),
        price: Number(l.unit_purchase_price),
        vendor: l.vendor,
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
