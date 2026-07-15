// src/app/api/purchases/route.ts
//
// Fully on Supabase now — the Google Sheets best-effort backup block (STEP 2
// in the previous version) has been removed per your decision to stop using
// Google Sheets app-wide. Supabase was already the source of truth here;
// this just removes the now-pointless secondary write.
//
// serial_numbers (JSONB array) — one string per unit purchased, optional.

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

export async function GET() {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("transactions")
      .select("*")
      .in("type", ["Purchase", "Transfer In"])
      .order("date", { ascending: false })
      .limit(500);

    if (error) throw error;

    const purchases = (data ?? []).map((r: any) => ({
      txnId: r.txn_id,
      date: r.date,
      type: r.type,
      itemCode: r.item_code ?? "",
      model: r.model,
      location: r.location,
      qty: r.qty,
      unitPrice: r.unit_price,
      total: r.total,
      party: r.party,
      poOrInvoice: r.po_invoice,
      status: r.status,
      costPrice: r.cost_price ?? null,
      serialNumbers: Array.isArray(r.serial_numbers) ? r.serial_numbers : [],
    }));

    return NextResponse.json({ purchases });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      date,
      model,
      location,
      qtyPurchased,
      qty,
      unitListPrice,
      baseDiscount,
      addDiscount,
      customFinalPrice,
      unitPurchasePrice,
      courierCharges,
      courier,
      supplier,
      vendor,
      poOrInvoice,
      status,
      serialNumbers, // string[] — one per unit, may be partially filled or empty
    } = body;

    const resolvedQty = Number(qtyPurchased ?? qty ?? 0);
    const afterBase =
      Number(unitListPrice ?? 0) * (1 - Number(baseDiscount ?? 0) / 100);
    const afterAdd = afterBase * (1 - Number(addDiscount ?? 0) / 100);
    const resolvedUnitPrice = customFinalPrice
      ? Number(customFinalPrice)
      : unitPurchasePrice
        ? Number(unitPurchasePrice)
        : afterAdd;
    const resolvedCourier = Number(courierCharges ?? courier ?? 0);
    const courierPerUnit = resolvedQty > 0 ? resolvedCourier / resolvedQty : 0;
    const effectiveCostPerUnit = resolvedUnitPrice + courierPerUnit;
    const resolvedVendor = supplier ?? vendor ?? "";

    // Normalise serials: array of strings, trimmed, padded/truncated to resolvedQty
    const rawSerials: string[] = Array.isArray(serialNumbers)
      ? serialNumbers
      : [];
    const resolvedSerials = Array.from({ length: resolvedQty }, (_, i) =>
      String(rawSerials[i] ?? "").trim(),
    );

    if (!model || !location || !resolvedQty || !resolvedUnitPrice) {
      return NextResponse.json(
        { error: "model, location, qty, and unit price are required" },
        { status: 400 },
      );
    }

    const supabase = getSupabase();

    const { data: product, error: productErr } = await supabase
      .from("products")
      .select("item_code")
      .ilike("model", model)
      .maybeSingle();
    if (productErr) throw productErr;
    if (!product) {
      return NextResponse.json(
        { error: "Product not found in catalogue" },
        { status: 404 },
      );
    }

    const txnDate = date ?? new Date().toISOString().split("T")[0];
    const total = resolvedQty * resolvedUnitPrice + resolvedCourier;

    const txnId = await getNextTxnId(supabase);
    const lotId = await getNextLotId(supabase);

    const { error: txnErr } = await supabase.from("transactions").insert({
      txn_id: txnId,
      date: txnDate,
      type: "Purchase",
      item_code: product.item_code ?? "",
      model,
      location,
      qty: resolvedQty,
      unit_price: resolvedUnitPrice,
      total,
      party: resolvedVendor,
      po_invoice: poOrInvoice ?? "",
      status: status ?? "Received",
      cost_price: resolvedUnitPrice,
      serial_numbers: resolvedSerials,
    });
    if (txnErr) throw txnErr;

    const { error: lotErr } = await supabase.from("lots").insert({
      lot_id: lotId,
      date: txnDate,
      model,
      location,
      qty_purchased: resolvedQty,
      remaining_qty: resolvedQty,
      unit_purchase_price: resolvedUnitPrice,
      vendor: resolvedVendor,
      po_invoice: poOrInvoice ?? "",
      serial_numbers: resolvedSerials,
    });
    if (lotErr) throw lotErr;

    // Legacy stock rollup table (kept for Dashboard compatibility)
    const { data: existingStock } = await supabase
      .from("lots")
      .select("remaining_qty")
      .eq("model", model)
      .eq("location", location);
    const newCurrentStock = (existingStock ?? []).reduce(
      (s: number, l: any) => s + Number(l.remaining_qty),
      0,
    );
    await supabase.from("stock").upsert(
      {
        model,
        location,
        received: newCurrentStock,
        current_stock: newCurrentStock,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "model,location" },
    );

    return NextResponse.json({
      success: true,
      txnId,
      lotId,
      effectiveCostPerUnit,
      serialNumbersStored: resolvedSerials.filter(Boolean).length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
