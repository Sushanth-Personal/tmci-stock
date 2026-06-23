// src/app/api/purchases/route.ts
import { NextResponse } from "next/server";
import {
  fetchTransactions,
  fetchProducts,
  getNextTxnId,
  createLot,
  syncStockRow,
  fetchStock,
  appendRows,
  SHEETS,
} from "@/lib/sheets";

// GET: return all Purchase-type rows from Transactions
export async function GET() {
  try {
    const all = await fetchTransactions();
    const purchases = all.filter((t) => t.type === "Purchase");
    return NextResponse.json({ purchases });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: record a purchase.
// Frontend (RecordPurchase.tsx) sends:
//   date, invoiceDate, model, location, qtyPurchased, unitListPrice,
//   baseDiscount, addDiscount, customFinalPrice, courierCharges, supplier
// Older callers may send qty / unitPurchasePrice / vendor directly — both forms accepted.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      date,
      invoiceDate,
      model,
      location,
      qtyPurchased,
      qty, // legacy / direct callers
      unitListPrice,
      baseDiscount,
      addDiscount,
      customFinalPrice,
      unitPurchasePrice, // legacy / direct callers
      courierCharges,
      courier, // alternative field name
      supplier,
      vendor, // legacy / direct callers
      poOrInvoice,
      status,
    } = body;

    const resolvedQty = Number(qtyPurchased ?? qty ?? 0);

    // Derive the effective unit purchase price:
    // list × (1 − base%) × (1 − add%), then override with customFinalPrice if set.
    // Falls back to a directly-supplied unitPurchasePrice for legacy callers.
    const afterBase =
      Number(unitListPrice ?? 0) * (1 - Number(baseDiscount ?? 0) / 100);
    const afterAdd = afterBase * (1 - Number(addDiscount ?? 0) / 100);
    const resolvedUnitPrice = customFinalPrice
      ? Number(customFinalPrice)
      : unitPurchasePrice
        ? Number(unitPurchasePrice)
        : afterAdd;

    // Effective cost includes courier spread across this line's qty
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

    // 1. Log the transaction
    // Col M (index 12) = Cost Price — not applicable to purchases, left blank.
    // Col N (index 13) = Invoice Date — stored for reference.
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
        "", // Cost Price — not applicable to purchases
        invoiceDate ?? "", // Invoice Date
      ],
    ]);

    // 2. Create the FIFO lot (cost basis = unit purchase price, no courier)
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

    // 3. Update Stock rollup
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
      resolvedQty, // deltaReceived
      0, // deltaSold
      newCurrentStock,
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
