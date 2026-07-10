// src/app/api/products/route.ts
//
// Fully on Supabase now — the Google Sheets best-effort backup block has
// been removed per your decision to stop using Google Sheets app-wide.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

export async function GET() {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("model", { ascending: true });

    if (error) throw error;

    const products = (data ?? []).map((r: any) => ({
      itemCode: r.item_code ?? "",
      hsn: r.hsn ?? "",
      category: r.category ?? "",
      make: r.make ?? "",
      model: r.model,
      description: r.description ?? "",
      listPrice: Number(r.list_price ?? 0),
      warranty: r.warranty ?? "",
      moq: Number(r.moq ?? 1),
    }));

    return NextResponse.json({ products });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Add a new product to the master catalogue. This does NOT create stock or
// lots — opening stock for a new model is recorded via a Purchase
// transaction (POST /api/purchases), which creates the first lot.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      itemCode,
      hsn,
      category,
      model,
      description,
      listPrice,
      warranty,
      moq,
    } = body;

    if (!itemCode || !model || !listPrice) {
      return NextResponse.json(
        { error: "itemCode, model, and listPrice are required" },
        { status: 400 },
      );
    }

    const supabase = getSupabase();

    // Uniqueness by MODEL — item_code is null for most existing rows, so it
    // can't reliably detect dupes. Model is the natural key used everywhere
    // else in the app (dispatch matching, stock grouping, FIFO).
    const { data: existing, error: existingErr } = await supabase
      .from("products")
      .select("id")
      .ilike("model", model)
      .maybeSingle();
    if (existingErr) throw existingErr;

    if (existing) {
      return NextResponse.json(
        { error: `Model "${model}" already exists in the catalogue` },
        { status: 400 },
      );
    }

    const { error: insertErr } = await supabase.from("products").insert({
      item_code: String(itemCode),
      hsn: hsn ?? null,
      category: category ?? null,
      model,
      description: description ?? null,
      list_price: Number(listPrice),
      warranty: warranty ? String(warranty) : null,
      moq: Number(moq ?? 1),
    });
    if (insertErr) throw insertErr;

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
