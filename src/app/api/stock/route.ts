// src/app/api/stock/route.ts
import { NextResponse } from "next/server";
import { fetchStock, fetchLots, fetchProducts } from "@/lib/sheets";

export async function GET() {
  try {
    const [stock, lots, products] = await Promise.all([
      fetchStock(),
      fetchLots(),
      fetchProducts(),
    ]);

    // Dual lookup: by itemCode (primary) AND by model (fallback).
    // Most Fluke Products rows have blank itemCode, so itemCode-only lookup
    // returns nothing and category/listPrice end up blank.
    const productByItemCode = new Map(
      products.filter((p) => p.itemCode).map((p) => [p.itemCode, p]),
    );
    const productByModel = new Map(products.map((p) => [p.model, p]));

    const getProduct = (itemCode: string, model: string) =>
      productByItemCode.get(itemCode) ?? productByModel.get(model);

    const sortedLots = [...lots].sort((a, b) => {
      const da = new Date(a.date).getTime();
      const db = new Date(b.date).getTime();
      if (!isNaN(da) && !isNaN(db) && da !== db) return da - db;
      return a.lotId.localeCompare(b.lotId);
    });

    const lastKnownPrice = new Map<string, number>();
    for (const l of sortedLots) {
      if (l.unitPurchasePrice > 0) {
        lastKnownPrice.set(l.itemCode, l.unitPurchasePrice);
      }
    }

    const costMap = new Map<string, number>();
    for (const loc of ["Kochi", "Bangalore"]) {
      const itemCodes = [...new Set(lots.map((l) => l.itemCode))];
      for (const ic of itemCodes) {
        const openLots = lots.filter(
          (l) => l.itemCode === ic && l.location === loc && l.remainingQty > 0,
        );
        const fallback = lastKnownPrice.get(ic) ?? 0;
        if (openLots.length > 0) {
          const totalQty = openLots.reduce((s, l) => s + l.remainingQty, 0);
          const totalVal = openLots.reduce((s, l) => {
            const price =
              l.unitPurchasePrice > 0 ? l.unitPurchasePrice : fallback;
            return s + l.remainingQty * price;
          }, 0);
          if (totalQty > 0 && totalVal > 0) {
            costMap.set(`${ic}__${loc}`, totalVal / totalQty);
          }
        } else if (fallback > 0) {
          costMap.set(`${ic}__${loc}`, fallback);
        }
      }
    }

    const enriched = stock.map((s) => {
      const prod = getProduct(s.itemCode, s.model);
      const costPrice = costMap.get(`${s.itemCode}__${s.location}`) ?? 0;
      return {
        ...s,
        category: prod?.category ?? "",
        listPrice: prod?.listPrice ?? s.listPrice,
        costPrice,
        stockValue: s.currentStock * costPrice,
      };
    });

    return NextResponse.json({ stock: enriched });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
