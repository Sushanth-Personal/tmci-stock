// src/app/api/sales/route.ts
import { NextResponse } from "next/server";
import {
  fetchTransactions,
  fetchProducts,
  fetchStock,
  getNextTxnId,
  consumeFifo,
  syncStockRow,
  appendRows,
  SHEETS,
} from "@/lib/sheets";

// GET: return all Sale-type rows from Transactions
export async function GET() {
  try {
    const all = await fetchTransactions();
    const sales = all.filter((t) => t.type === "Sale");
    return NextResponse.json({ sales });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: record a sale.
// - unitSalePrice is ALWAYS a manual entry — the app never derives it.
// - Cost is computed via FIFO: consumes from the oldest open lots for this
//   model+location, and if the sale spans multiple lots (different vendor
//   rates), the Cost Price stored is the weighted average across the lots
//   actually consumed.
// - Stock rollup (Sold += qty, Current Stock -= qty) is updated to match.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      date,
      model,
      location,
      qty,
      unitSalePrice,
      customer,
      poOrInvoice,
      status,
    } = body;

    if (!model || !location || !qty || !unitSalePrice) {
      return NextResponse.json(
        { error: "model, location, qty, and unitSalePrice are required" },
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

    // FIFO consumption — throws if insufficient stock across open lots.
    let fifoResult;
    try {
      fifoResult = await consumeFifo(product.itemCode, location, Number(qty));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Insufficient stock";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const txnDate = date ?? new Date().toISOString().split("T")[0];
    const total = Number(qty) * Number(unitSalePrice);
    const txnId = await getNextTxnId();
    const costPrice = +fifoResult.weightedCost.toFixed(2);

    // 1. Log the transaction — one row, single manual sale price,
    //    weighted-average FIFO cost price.
    await appendRows(SHEETS.TRANSACTIONS, "A:M", [
      [
        txnId,
        txnDate,
        "Sale",
        product.itemCode,
        model,
        location,
        Number(qty),
        Number(unitSalePrice),
        total,
        customer ?? "",
        poOrInvoice ?? "",
        status ?? "Completed",
        costPrice,
      ],
    ]);

    // 2. Update Stock rollup
    const stock = await fetchStock();
    const existing = stock.find(
      (s) => s.itemCode === product.itemCode && s.location === location,
    );
    const newCurrentStock = (existing?.currentStock ?? 0) - Number(qty);
    await syncStockRow(
      product.itemCode,
      model,
      product.description,
      location,
      0, // deltaReceived
      Number(qty), // deltaSold
      newCurrentStock,
    );

    const margin =
      ((Number(unitSalePrice) - costPrice) / Number(unitSalePrice)) * 100;

    return NextResponse.json({
      success: true,
      txnId,
      costPrice,
      margin,
      lotBreakdown: fifoResult.breakdown, // which lots this sale drew from
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
