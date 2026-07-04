// src/app/api/invoices/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

// GET /api/invoices?status=pending_dispatch&limit=50
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const limit = Number(searchParams.get("limit") ?? 50);

    const supabase = getSupabase();
    let query = supabase
      .from("sale_invoices")
      .select("*")
      .is("deleted_at", null) // never show binned invoices in normal lists
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ invoices: data ?? [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/invoices — create invoice (does NOT touch stock)
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      invoice_number,
      invoice_date,
      due_date,
      customer_id,
      customer_snapshot,
      location,
      line_items,
      charges,
      subtotal,
      gst_rate,
      gst_amount,
      total,
      notes,
    } = body;

    if (!invoice_number || !invoice_date || !location || !line_items?.length) {
      return NextResponse.json(
        {
          error:
            "invoice_number, invoice_date, location, and line_items are required",
        },
        { status: 400 },
      );
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("sale_invoices")
      .insert({
        invoice_number,
        invoice_date,
        due_date: due_date || invoice_date,
        customer_id: customer_id || null,
        customer_snapshot: customer_snapshot || null,
        location,
        line_items,
        charges: charges ?? [],
        subtotal,
        gst_rate,
        gst_amount,
        total,
        notes: notes || null,
        status: "pending_dispatch",
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: `Invoice number ${invoice_number} already exists` },
          { status: 409 },
        );
      }
      throw error;
    }

    return NextResponse.json({ invoice: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
