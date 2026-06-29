// src/app/api/stock/route.ts
// Reads stock + lots + products from Supabase (not Google Sheets)
// This ensures dispatched invoices immediately reflect in stock view.

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

    // Fetch all three tables in parallel
    const [stockRes, lotsRes, productsRes] = await Promise.all([
      supabase.from("stock").select("*"),
      supabase.from("lots").select("*"),
      supabase.from("products").select("*"),
    ]);

    if (stockRes.error) throw stockRes.error;
    if (lotsRes.error) throw lotsRes.error;
    if (productsRes.error) throw productsRes.error;

    const stock = stockRes.data ?? [];
    const lots = lotsRes.data ?? [];
    const products = productsRes.data ?? [];

    // Build product lookup by model (primary) and item_code (fallback)
    const productByModel = new Map(products.map((p: any) => [p.model, p]));
    const productByItemCode = new Map(
      products
        .filter((p: any) => p.item_code)
        .map((p: any) => [p.item_code, p]),
    );
    const getProduct = (itemCode: string, model: string) =>
      productByModel.get(model) ?? productByItemCode.get(itemCode);

    // Sort lots oldest first for FIFO cost calculation
    const sortedLots = [...lots].sort((a: any, b: any) => {
      const da = new Date(a.date).getTime();
      const db = new Date(b.date).getTime();
      if (!isNaN(da) && !isNaN(db) && da !== db) return da - db;
      return (a.lot_id ?? "").localeCompare(b.lot_id ?? "");
    });

    // Last known purchase price per model (fallback when no open lots)
    const lastKnownPrice = new Map<string, number>();
    for (const l of sortedLots) {
      if (l.unit_purchase_price > 0)
        lastKnownPrice.set(l.model, l.unit_purchase_price);
    }

    // Weighted average cost per (model, location) from open lots
    const costMap = new Map<string, number>();
    const modelLocSet = new Set(
      lots.map((l: any) => `${l.model}__${l.location}`),
    );
    for (const key of modelLocSet) {
      const [model, loc] = key.split("__");
      const openLots = lots.filter(
        (l: any) =>
          l.model === model && l.location === loc && l.remaining_qty > 0,
      );
      const fallback = lastKnownPrice.get(model) ?? 0;
      if (openLots.length > 0) {
        const totalQty = openLots.reduce(
          (s: number, l: any) => s + l.remaining_qty,
          0,
        );
        const totalVal = openLots.reduce((s: number, l: any) => {
          const price =
            l.unit_purchase_price > 0 ? l.unit_purchase_price : fallback;
          return s + l.remaining_qty * price;
        }, 0);
        if (totalQty > 0) costMap.set(key, totalVal / totalQty);
      } else if (fallback > 0) {
        costMap.set(key, fallback);
      }
    }

    // Enrich stock rows
    const enriched = stock.map((s: any) => {
      const prod = getProduct(s.item_code ?? "", s.model);
      const costPrice = costMap.get(`${s.model}__${s.location}`) ?? 0;
      return {
        // Normalise to camelCase so StockView.tsx doesn't need changes
        row: 0,
        itemCode: s.item_code ?? "",
        make: s.make ?? prod?.make ?? "",
        model: s.model,
        description: s.description ?? prod?.description ?? "",
        location: s.location,
        category: prod?.category ?? "",
        openingStock: s.opening_stock ?? 0,
        ordered: s.ordered ?? 0,
        received: s.received ?? 0,
        sold: s.sold ?? 0,
        currentStock: s.current_stock ?? 0,
        listPrice: s.list_price ?? prod?.list_price ?? 0,
        costPrice,
        stockValue: (s.current_stock ?? 0) * costPrice,
      };
    });

    return NextResponse.json({ stock: enriched });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
