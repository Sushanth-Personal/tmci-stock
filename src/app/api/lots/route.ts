// src/app/api/lots/route.ts
import { NextResponse } from "next/server";
import { fetchLots } from "@/lib/sheets";

// Read-only view of the FIFO lot ledger — useful for debugging stock
// valuation and seeing which batches are still open.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const itemCode = searchParams.get("itemCode");
    const location = searchParams.get("location");
    const openOnly = searchParams.get("openOnly") === "true";

    let lots = await fetchLots();
    if (itemCode) lots = lots.filter((l) => l.itemCode === itemCode);
    if (location) lots = lots.filter((l) => l.location === location);
    if (openOnly) lots = lots.filter((l) => l.remainingQty > 0);

    return NextResponse.json({ lots });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
