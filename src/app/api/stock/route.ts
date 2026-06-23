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

    const productMap = new Map(products.map((p) => [p.itemCode, p]));

    // Sort lots oldest-first so last write wins = most recent known price
    const sortedLots = [...lots].sort((a, b) => {
      const da = new Date(a.date).getTime();
      const db = new Date(b.date).getTime();
      if (!isNaN(da) && !isNaN(db) && da !== db) return da - db;
      return a.lotId.localeCompare(b.lotId);
    });

    // Last known non-zero unit price per itemCode across ALL lots
    // (open or closed). Used as fallback when:
    //   (a) open lots exist but have a blank/zero price, or
    //   (b) no open lots exist at all (lot fully consumed but stock
    //       sheet still shows units — data inconsistency scenario)
    const lastKnownPrice = new Map<string, number>();
    for (const l of sortedLots) {
      if (l.unitPurchasePrice > 0) {
        lastKnownPrice.set(l.itemCode, l.unitPurchasePrice);
      }
    }

    // FIFO weighted-average cost per itemCode+location from open lots.
    // Falls back to lastKnownPrice when a lot price is blank/zero.
    const costMap = new Map<string, number>();
    for (const loc of ["Kochi", "Bangalore"]) {
      const itemCodes = [...new Set(lots.map((l) => l.itemCode))];
      for (const ic of itemCodes) {
        const openLots = lots.filter(
          (l) => l.itemCode === ic && l.location === loc && l.remainingQty > 0,
        );

        const fallback = lastKnownPrice.get(ic) ?? 0;

        if (openLots.length > 0) {
          // Has open lots — compute weighted average, substituting
          // fallback price for any lot with a blank/zero price
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
          // No open lots but stock sheet may still show units
          // (lot fully consumed but stock not yet decremented, or
          // pre-FIFO opening stock). Use last known price so stock
          // value isn't silently zeroed out.
          costMap.set(`${ic}__${loc}`, fallback);
        }
      }
    }

    const enriched = stock.map((s) => {
      const prod = productMap.get(s.itemCode);
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
