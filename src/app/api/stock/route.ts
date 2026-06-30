// src/app/api/stock/route.ts
// Reads from lots table — single source of truth
// Returns one row per model (not per location)
// kochiStock + bangaloreStock as separate fields to match StockView columns

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

    const [lotsRes, productsRes] = await Promise.all([
      supabase
        .from("lots")
        .select(
          "model, location, qty_purchased, remaining_qty, unit_purchase_price",
        ),
      supabase.from("products").select("*"),
    ]);

    if (lotsRes.error) throw lotsRes.error;
    if (productsRes.error) throw productsRes.error;

    const lots = lotsRes.data ?? [];
    const products = productsRes.data ?? [];

    const productByModel = new Map(
      products.map((p: any) => [String(p.model ?? "").toLowerCase(), p]),
    );

    // Group by model — one entry per model with kochi+bangalore broken out
    const grouped = new Map<
      string,
      {
        model: string;
        kochiQty: number;
        kochiValue: number;
        bloreQty: number;
        bloreValue: number;
        totalReceived: number;
        totalSold: number;
      }
    >();

    for (const l of lots) {
      const key = String(l.model).toLowerCase();
      const loc = String(l.location ?? "").toLowerCase();
      const purchased = Number(l.qty_purchased ?? 0);
      const remaining = Number(l.remaining_qty ?? 0);
      const price = Number(l.unit_purchase_price ?? 0);

      if (!grouped.has(key)) {
        grouped.set(key, {
          model: l.model,
          kochiQty: 0,
          kochiValue: 0,
          bloreQty: 0,
          bloreValue: 0,
          totalReceived: 0,
          totalSold: 0,
        });
      }
      const g = grouped.get(key)!;
      g.totalReceived += purchased;
      g.totalSold += purchased - remaining;

      if (loc === "kochi") {
        g.kochiQty += remaining;
        g.kochiValue += remaining * price;
      } else {
        g.bloreQty += remaining;
        g.bloreValue += remaining * price;
      }
    }

    const stock = Array.from(grouped.values())
      .filter((g) => g.totalReceived > 0)
      .map((g) => {
        const prod = productByModel.get(g.model.toLowerCase());
        const totalQty = g.kochiQty + g.bloreQty;
        const totalVal = g.kochiValue + g.bloreValue;
        const costPrice =
          totalQty > 0
            ? totalVal / totalQty
            : g.totalReceived > 0
              ? (g.kochiValue + g.bloreValue) / Math.max(g.totalReceived, 1)
              : 0;

        return {
          // Fields StockView expects
          itemCode: prod?.item_code ?? "",
          make: prod?.make ?? "",
          model: g.model,
          description: prod?.description ?? "",
          category: prod?.category ?? "",
          openingStock: 0,
          received: g.totalReceived,
          sold: g.totalSold,
          currentStock: totalQty, // total across both locations
          kochiStock: g.kochiQty, // for Kochi column
          bangaloreStock: g.bloreQty, // for Blore column
          listPrice: prod?.list_price ?? 0,
          costPrice,
          stockValue: totalVal,
          // Keep location field for compatibility
          location: "All",
        };
      });

    return NextResponse.json({ stock });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
