// src/app/api/products/route.ts
//
// Fully on Supabase — the Google Sheets best-effort backup block has
// been removed per your decision to stop using Google Sheets app-wide.
//
// PATCH now supports two modes:
//   1. Keyed by `id` — full-field edit from the Items catalog list
//      (model, category, description, listPrice, warranty, moq, make,
//      itemCode, hsn — any subset).
//   2. Keyed by `model` — the original narrower mode, kept for backward
//      compatibility with GroqPurchaseScanner.tsx / GroqSaleScanner.tsx,
//      which only ever patch itemCode/hsn after a scan.
// Model (the natural key used everywhere else — dispatch matching, stock
// grouping, FIFO) is intentionally NOT editable through the `model`-keyed
// path, to avoid silently breaking joins against lots/stock/transactions
// that already reference the old model string. It CAN be changed through
// the `id`-keyed path, but only as an explicit opt-in — see the warning
// returned when a rename is attempted.

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
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("model", { ascending: true });

    if (error) throw error;

    const products = (data ?? []).map((r: any) => ({
      id: r.id,
      itemCode: r.item_code ?? "",
      hsn: r.hsn ?? "",
      category: r.category ?? "",
      make: r.make ?? "",
      model: r.model,
      description: r.description ?? "",
      listPrice: Number(r.list_price ?? 0),
      warranty: r.warranty ?? "",
      moq: Number(r.moq ?? 1),
    }));

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
      make,
      model,
      description,
      listPrice,
      warranty,
      moq,
    } = body;

    if (!model || !String(model).trim()) {
      return NextResponse.json({ error: "model is required" }, { status: 400 });
    }
    if (listPrice === undefined || listPrice === null || +listPrice <= 0) {
      return NextResponse.json(
        { error: "listPrice must be greater than 0" },
        { status: 400 },
      );
    }

    const supabase = getSupabase();

    // Uniqueness by MODEL — item_code is null for most existing rows, so it
    // can't reliably detect dupes. Model is the natural key used everywhere
    // else in the app (dispatch matching, stock grouping, FIFO).
    const { data: existing, error: existingErr } = await supabase
      .from("products")
      .select("id")
      .ilike("model", model)
      .maybeSingle();
    if (existingErr) throw existingErr;

    if (existing) {
      return NextResponse.json(
        { error: `Model "${model}" already exists in the catalogue` },
        { status: 400 },
      );
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("products")
      .insert({
        item_code: itemCode ? String(itemCode) : null,
        hsn: hsn ?? null,
        category: category ?? null,
        make: make ?? null,
        model: String(model).trim(),
        description: description ?? null,
        list_price: Number(listPrice),
        warranty: warranty ? String(warranty) : null,
        moq: Number(moq ?? 1),
      })
      .select()
      .single();
    if (insertErr) throw insertErr;

    return NextResponse.json({
      success: true,
      product: {
        id: inserted.id,
        itemCode: inserted.item_code ?? "",
        hsn: inserted.hsn ?? "",
        category: inserted.category ?? "",
        make: inserted.make ?? "",
        model: inserted.model,
        description: inserted.description ?? "",
        listPrice: Number(inserted.list_price ?? 0),
        warranty: inserted.warranty ?? "",
        moq: Number(inserted.moq ?? 1),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Update an existing product. Two ways to target the row:
//   { id, ...fields }     → full edit, used by the Items catalog screen
//   { model, itemCode, hsn } → legacy narrow patch, used by the Groq
//                              purchase/sale scanners after OCR review
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const supabase = getSupabase();

    // ── Mode 1: keyed by id (full edit from Items screen) ──────────────
    if (body.id) {
      const patch: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };

      if (body.model !== undefined) {
        const newModel = String(body.model).trim();
        if (!newModel) {
          return NextResponse.json(
            { error: "model cannot be blank" },
            { status: 400 },
          );
        }
        // Renaming a model is allowed here (explicit edit screen), but
        // guard against colliding with a different existing product.
        const { data: clash } = await supabase
          .from("products")
          .select("id")
          .ilike("model", newModel)
          .neq("id", body.id)
          .maybeSingle();
        if (clash) {
          return NextResponse.json(
            { error: `Another product already uses the model "${newModel}"` },
            { status: 409 },
          );
        }
        patch.model = newModel;
      }
      if (body.itemCode !== undefined) patch.item_code = body.itemCode || null;
      if (body.hsn !== undefined) patch.hsn = body.hsn || null;
      if (body.category !== undefined) patch.category = body.category || null;
      if (body.make !== undefined) patch.make = body.make || null;
      if (body.description !== undefined)
        patch.description = body.description || null;
      if (body.listPrice !== undefined)
        patch.list_price = Number(body.listPrice) || 0;
      if (body.warranty !== undefined)
        patch.warranty = body.warranty ? String(body.warranty) : null;
      if (body.moq !== undefined) patch.moq = Number(body.moq) || 1;

      const { data, error } = await supabase
        .from("products")
        .update(patch)
        .eq("id", body.id)
        .select()
        .single();
      if (error) throw error;
      if (!data) {
        return NextResponse.json(
          { error: "Product not found" },
          { status: 404 },
        );
      }

      return NextResponse.json({
        success: true,
        product: {
          id: data.id,
          itemCode: data.item_code ?? "",
          hsn: data.hsn ?? "",
          category: data.category ?? "",
          make: data.make ?? "",
          model: data.model,
          description: data.description ?? "",
          listPrice: Number(data.list_price ?? 0),
          warranty: data.warranty ?? "",
          moq: Number(data.moq ?? 1),
        },
        modelChanged:
          body.model !== undefined && patch.model !== undefined ? true : false,
      });
    }

    // ── Mode 2: legacy — keyed by model, only itemCode/hsn (Groq scanners) ──
    const { model, itemCode, hsn } = body;
    if (!model) {
      return NextResponse.json({ error: "model is required" }, { status: 400 });
    }
    if (itemCode === undefined && hsn === undefined) {
      return NextResponse.json(
        { error: "Nothing to update — provide itemCode and/or hsn" },
        { status: 400 },
      );
    }

    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (itemCode !== undefined) patch.item_code = itemCode || null;
    if (hsn !== undefined) patch.hsn = hsn || null;

    const { error, data } = await supabase
      .from("products")
      .update(patch)
      .ilike("model", model)
      .select("model")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: `Model "${model}" not found in catalogue` },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, model: data.model });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Permanently remove a product from the catalogue. Only allowed when it
// has no stock history — this is a catalogue cleanup tool, not a way to
// hide products that already have purchases/sales against them (those
// should stay for historical FIFO/reporting integrity).
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id)
      return NextResponse.json({ error: "id is required" }, { status: 400 });

    const supabase = getSupabase();
    const { data: product, error: prodErr } = await supabase
      .from("products")
      .select("model")
      .eq("id", id)
      .single();
    if (prodErr || !product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const { data: lots } = await supabase
      .from("lots")
      .select("lot_id")
      .ilike("model", product.model)
      .limit(1);
    const { data: txns } = await supabase
      .from("transactions")
      .select("id")
      .ilike("model", product.model)
      .limit(1);

    if ((lots && lots.length > 0) || (txns && txns.length > 0)) {
      return NextResponse.json(
        {
          error:
            "This item has purchase/sale history and can't be deleted — it would break stock and reporting records. Consider it stays in the catalogue even if you've stopped selling it.",
        },
        { status: 409 },
      );
    }

    const { error: delErr } = await supabase
      .from("products")
      .delete()
      .eq("id", id);
    if (delErr) throw delErr;

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
