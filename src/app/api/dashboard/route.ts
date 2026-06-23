// src/app/api/dashboard/route.ts
import { NextResponse } from "next/server";
import {
  fetchProducts,
  fetchStock,
  fetchTransactions,
  fetchLots,
} from "@/lib/sheets";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const location = searchParams.get("location") ?? "both";

    const [products, stock, transactions, lots] = await Promise.all([
      fetchProducts(),
      fetchStock(),
      fetchTransactions(),
      fetchLots(),
    ]);

    const filterDate = (dateStr: string) => {
      if (!from && !to) return true;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return false;
      if (from && d < new Date(from)) return false;
      if (to && d > new Date(to)) return false;
      return true;
    };

    const sales = transactions.filter(
      (t) =>
        t.type === "Sale" &&
        filterDate(t.date) &&
        (location === "both" || t.location === location),
    );
    const purchases = transactions.filter(
      (t) =>
        t.type === "Purchase" &&
        filterDate(t.date) &&
        (location === "both" || t.location === location),
    );

    // Stock value = sum across OPEN LOTS at each lot's own purchase price
    // (true FIFO valuation), not a flat per-model cost price.
    const openLots = lots.filter((l) => l.remainingQty > 0);
    const kochiValue = openLots
      .filter((l) => l.location === "Kochi")
      .reduce((s, l) => s + l.remainingQty * l.unitPurchasePrice, 0);
    const bloreValue = openLots
      .filter((l) => l.location === "Bangalore")
      .reduce((s, l) => s + l.remainingQty * l.unitPurchasePrice, 0);

    const kochiItems = stock
      .filter((s) => s.location === "Kochi")
      .reduce((sum, s) => sum + s.currentStock, 0);
    const bloreItems = stock
      .filter((s) => s.location === "Bangalore")
      .reduce((sum, s) => sum + s.currentStock, 0);

    const totalSalesValue = sales.reduce((sum, s) => sum + s.total, 0);
    const totalSalesCost = sales.reduce(
      (sum, s) => sum + s.qty * (s.costPrice ?? 0),
      0,
    );
    const grossMargin =
      totalSalesValue > 0
        ? ((totalSalesValue - totalSalesCost) / totalSalesValue) * 100
        : 0;

    const totalPurchaseValue = purchases.reduce((sum, p) => sum + p.total, 0);

    const salesByModel: Record<string, { units: number; value: number }> = {};
    for (const s of sales) {
      if (!salesByModel[s.model])
        salesByModel[s.model] = { units: 0, value: 0 };
      salesByModel[s.model].units += s.qty;
      salesByModel[s.model].value += s.total;
    }
    const topMovers = Object.entries(salesByModel)
      .sort((a, b) => b[1].value - a[1].value)
      .slice(0, 5)
      .map(([model, data]) => ({ model, ...data }));

    return NextResponse.json({
      stockValue: kochiValue + bloreValue,
      salesValue: totalSalesValue,
      purchasesValue: totalPurchaseValue,
      grossMargin,
      kochiItems,
      bloreItems,
      kochiValue,
      bloreValue,
      topMovers,
      productCount: products.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
