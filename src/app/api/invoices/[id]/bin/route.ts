// src/app/api/invoices/[id]/bin/route.ts
//
// POST   /api/invoices/<id>/bin  → soft-delete (move to bin, sets deleted_at)
// PATCH  /api/invoices/<id>/bin  → restore from bin (clears deleted_at)
// DELETE /api/invoices/<id>/bin  → permanent delete (hard delete, row gone)

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

// ── POST: move to bin ──────────────────────────────────────────────────────
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = getSupabase();

    const { data: invoice, error: fetchErr } = await supabase
      .from("sale_invoices")
      .select("id, status, invoice_number, deleted_at")
      .eq("id", id)
      .single();

    if (fetchErr || !invoice)
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    if (invoice.deleted_at)
      return NextResponse.json({ error: "Already in bin" }, { status: 409 });

    if (invoice.status === "dispatched") {
      return NextResponse.json(
        {
          error:
            "Cannot bin a dispatched invoice — stock has already been deducted via FIFO. Cancel isn't available either; contact an admin for a proper reversal.",
        },
        { status: 409 },
      );
    }

    const { error: updateErr } = await supabase
      .from("sale_invoices")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (updateErr) throw updateErr;

    return NextResponse.json({ success: true, binned: invoice.invoice_number });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── PATCH: restore from bin ────────────────────────────────────────────────
export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = getSupabase();

    const { data: invoice, error: fetchErr } = await supabase
      .from("sale_invoices")
      .select("id, invoice_number, deleted_at")
      .eq("id", id)
      .single();

    if (fetchErr || !invoice)
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    if (!invoice.deleted_at)
      return NextResponse.json(
        { error: "Invoice is not in bin" },
        { status: 409 },
      );

    const { error: updateErr } = await supabase
      .from("sale_invoices")
      .update({ deleted_at: null })
      .eq("id", id);

    if (updateErr) throw updateErr;

    return NextResponse.json({
      success: true,
      restored: invoice.invoice_number,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── DELETE: permanent delete (only from bin) ───────────────────────────────
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = getSupabase();

    const { data: invoice, error: fetchErr } = await supabase
      .from("sale_invoices")
      .select("id, invoice_number, deleted_at")
      .eq("id", id)
      .single();

    if (fetchErr || !invoice)
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    if (!invoice.deleted_at)
      return NextResponse.json(
        { error: "Invoice must be in bin before permanent delete" },
        { status: 409 },
      );

    const { error: deleteErr } = await supabase
      .from("sale_invoices")
      .delete()
      .eq("id", id);

    if (deleteErr) throw deleteErr;

    return NextResponse.json({
      success: true,
      deleted: invoice.invoice_number,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
