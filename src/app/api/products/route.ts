// src/app/api/products/route.ts
import { NextResponse } from "next/server";
import { fetchProducts, appendRows } from "@/lib/sheets";

export async function GET() {
  try {
    const products = await fetchProducts();
    return NextResponse.json({ products });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Add a new product to the master catalogue. This does NOT create stock or
// lots — opening stock for a new model is recorded via a Purchase
// transaction (POST /api/purchases), which creates the first lot.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      itemCode,
      hsn,
      category,
      model,
      description,
      listPrice,
      warranty,
      moq,
    } = body;

    if (!itemCode || !model || !listPrice) {
      return NextResponse.json(
        { error: "itemCode, model, and listPrice are required" },
        { status: 400 },
      );
    }

    const existing = await fetchProducts();
    if (existing.some((p) => p.itemCode === String(itemCode))) {
      return NextResponse.json(
        { error: `Item code ${itemCode} already exists in catalogue` },
        { status: 400 },
      );
    }

    await appendRows("Fluke Products", "A:H", [
      [
        String(itemCode),
        hsn ?? "",
        category ?? "",
        model,
        description ?? "",
        Number(listPrice),
        warranty ?? "",
        Number(moq ?? 1),
      ],
    ]);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
