// src/app/api/purchases/route.ts
// Reads from Supabase transactions table instead of Google Sheets
// POST still writes to Google Sheets (RecordPurchase screen) — keep that working

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  fetchProducts,
  getNextTxnId,
  createLot,
  syncStockRow,
  fetchStock,
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

// GET — read from Supabase
export async function GET() {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("transactions")
      .select("*")
      .eq("type", "Purchase")
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
    }));

    return NextResponse.json({ purchases });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST — record a new purchase (writes to Supabase lots + stock + transactions)
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      date,
      invoiceDate,
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

    if (!model || !location || !resolvedQty || !resolvedUnitPrice) {
      return NextResponse.json(
        { error: "model, location, qty, and unit price are required" },
        { status: 400 },
      );
    }

    const products = await fetchProducts();
    const product = products.find((p) => p.model === model);
    if (!product) {
      return NextResponse.json(
        { error: "Product not found in catalogue" },
        { status: 404 },
      );
    }

    const txnDate = date ?? new Date().toISOString().split("T")[0];
    const total = resolvedQty * resolvedUnitPrice + resolvedCourier;
    const txnId = await getNextTxnId();

    // 1. Log to Google Sheets transactions (keeps Sheets in sync for backups)
    await appendRows(SHEETS.TRANSACTIONS, "A:N", [
      [
        txnId,
        txnDate,
        "Purchase",
        product.itemCode,
        model,
        location,
        resolvedQty,
        resolvedUnitPrice,
        total,
        resolvedVendor,
        poOrInvoice ?? "",
        status ?? "Received",
        "",
        invoiceDate ?? "",
      ],
    ]);

    // 2. Create FIFO lot in Google Sheets
    const lotId = await createLot({
      date: txnDate,
      itemCode: product.itemCode,
      model,
      location,
      qty: resolvedQty,
      unitPurchasePrice: resolvedUnitPrice,
      vendor: resolvedVendor,
      poOrInvoice: poOrInvoice ?? "",
    });

    // 3. Update Stock in Google Sheets
    const stock = await fetchStock();
    const existing = stock.find(
      (s) => s.itemCode === product.itemCode && s.location === location,
    );
    const newCurrentStock = (existing?.currentStock ?? 0) + resolvedQty;
    await syncStockRow(
      product.itemCode,
      model,
      product.description,
      location,
      resolvedQty,
      0,
      newCurrentStock,
    );

    // 4. Also write to Supabase transactions + lots + stock
    const supabase = getSupabase();

    await supabase.from("transactions").insert({
      txn_id: txnId,
      date: txnDate,
      type: "Purchase",
      item_code: product.itemCode,
      model,
      location,
      qty: resolvedQty,
      unit_price: resolvedUnitPrice,
      total,
      party: resolvedVendor,
      po_invoice: poOrInvoice ?? "",
      status: status ?? "Received",
      cost_price: resolvedUnitPrice,
    });

    await supabase.from("lots").insert({
      lot_id: lotId,
      date: txnDate,
      model,
      location,
      qty_purchased: resolvedQty,
      remaining_qty: resolvedQty,
      unit_purchase_price: resolvedUnitPrice,
      vendor: resolvedVendor,
      po_invoice: poOrInvoice ?? "",
    });

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
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
