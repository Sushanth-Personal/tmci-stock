// src/app/api/customers/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

// GET /api/customers?q=<search>&id=<uuid>&limit=50
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") ?? "";
    const id = searchParams.get("id");
    const limit = Number(searchParams.get("limit") ?? 50);

    const supabase = getSupabase();

    // Single customer by id
    if (id) {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return NextResponse.json({ customer: data });
    }

    let query = supabase
      .from("customers")
      .select("*")
      .eq("status", "Active")
      .order("display_name", { ascending: true })
      .limit(limit);

    if (q.trim()) {
      query = query.or(
        `display_name.ilike.%${q}%,company_name.ilike.%${q}%,gstin.ilike.%${q}%,billing_city.ilike.%${q}%`,
      );
    }

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ customers: data ?? [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST — create new customer
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.display_name?.trim())
      return NextResponse.json(
        { error: "display_name is required" },
        { status: 400 },
      );

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("customers")
      .insert({ ...body, status: body.status ?? "Active" })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ customer: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/customers?id=<uuid> — update customer
export async function PATCH(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id)
      return NextResponse.json({ error: "id required" }, { status: 400 });

    const body = await req.json();
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("customers")
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ customer: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/customers?id=<uuid> — soft-delete (set status=Inactive)
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id)
      return NextResponse.json({ error: "id required" }, { status: 400 });

    const supabase = getSupabase();
    const { error } = await supabase
      .from("customers")
      .update({ status: "Inactive", updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
