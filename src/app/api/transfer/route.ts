// src/app/api/transfer/route.ts
import { NextResponse } from "next/server";
import {
  fetchProducts,
  fetchStock,
  fetchLots,
  syncStockRow,
  batchUpdate,
  appendRows,
  getNextLotId,
  ensureLotsSheet,
  SHEETS,
  Location,
} from "@/lib/sheets";

// Transfers move physical stock between Kochi and Bangalore.
// Because lots carry FIFO cost basis, a transfer must move the lot(s)
// themselves (oldest first) rather than just adjusting a single number —
// otherwise the receiving location loses its true cost history.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      model,
      fromLocation,
      toLocation,
      qty,
      courierCharges,
      remarks,
      date,
    } = body;

    if (!model || !fromLocation || !toLocation || !qty) {
      return NextResponse.json(
        { error: "model, fromLocation, toLocation, qty are required" },
        { status: 400 },
      );
    }
    if (
      !["Kochi", "Bangalore"].includes(fromLocation) ||
      !["Kochi", "Bangalore"].includes(toLocation) ||
      fromLocation === toLocation
    ) {
      return NextResponse.json(
        { error: "Invalid transfer direction" },
        { status: 400 },
      );
    }

    const products = await fetchProducts();
    const product = products.find((p) => p.model === model);
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    await ensureLotsSheet();
    const lots = await fetchLots();
    const sourceLots = lots
      .filter(
        (l) =>
          l.itemCode === product.itemCode &&
          l.location === (fromLocation as Location) &&
          l.remainingQty > 0,
      )
      .sort((a, b) => {
        const da = new Date(a.date).getTime();
        const db = new Date(b.date).getTime();
        if (!isNaN(da) && !isNaN(db) && da !== db) return da - db;
        return a.lotId.localeCompare(b.lotId);
      });

    const available = sourceLots.reduce((s, l) => s + l.remainingQty, 0);
    if (available < Number(qty)) {
      return NextResponse.json(
        {
          error: `Insufficient stock in ${fromLocation}. Available: ${available}`,
        },
        { status: 400 },
      );
    }

    const txnDate = date ?? new Date().toISOString().split("T")[0];
    let remaining = Number(qty);
    const updates: Array<{ range: string; values: unknown[][] }> = [];
    const newLotRows: unknown[][] = [];

    for (const lot of sourceLots) {
      if (remaining <= 0) break;
      const take = Math.min(lot.remainingQty, remaining);

      // Shrink the source lot
      updates.push({
        range: `'${SHEETS.LOTS}'!G${lot.row}`,
        values: [[lot.remainingQty - take]],
      });

      // Create an equivalent lot at the destination, same cost basis,
      // so FIFO ordering and cost history travel with the stock.
      const newLotId = await getNextLotId();
      newLotRows.push([
        newLotId,
        txnDate,
        product.itemCode,
        model,
        toLocation,
        take,
        take,
        lot.unitPurchasePrice,
        `Transfer from ${fromLocation}${remarks ? " — " + remarks : ""}`,
        lot.poOrInvoice,
      ]);

      remaining -= take;
    }

    await batchUpdate(updates);
    if (newLotRows.length) {
      await appendRows(SHEETS.LOTS, "A:J", newLotRows);
    }

    // Update Stock rollups on both sides
    const stock = await fetchStock();
    const fromStockRow = stock.find(
      (s) => s.itemCode === product.itemCode && s.location === fromLocation,
    );
    const toStockRow = stock.find(
      (s) => s.itemCode === product.itemCode && s.location === toLocation,
    );
    const newFromStock = (fromStockRow?.currentStock ?? 0) - Number(qty);
    const newToStock = (toStockRow?.currentStock ?? 0) + Number(qty);

    await syncStockRow(
      product.itemCode,
      model,
      product.description,
      fromLocation as Location,
      0,
      0,
      newFromStock,
    );
    await syncStockRow(
      product.itemCode,
      model,
      product.description,
      toLocation as Location,
      Number(qty),
      0,
      newToStock,
    );

    // Log as a reference row in Transactions (Type = "Transfer") for visibility,
    // even though Transfers don't affect FIFO cost the way sales/purchases do.
    const txnId = `TXN-XFER-${Date.now().toString().slice(-6)}`;
    await appendRows(SHEETS.TRANSACTIONS, "A:M", [
      [
        txnId,
        txnDate,
        "Transfer",
        product.itemCode,
        model,
        `${fromLocation} → ${toLocation}`,
        Number(qty),
        0,
        Number(courierCharges ?? 0),
        remarks ?? "",
        "",
        "Completed",
        "",
      ],
    ]);

    return NextResponse.json({ success: true, newFromStock, newToStock });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
