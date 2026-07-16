// src/app/api/locations/route.ts
//
// Locations = warehouses/branches (currently Kochi, Bangalore). Each can
// optionally have its own GSTIN if it's a real separate GST registration
// for that state; if left blank, invoices from that location just use the
// main company GSTIN (company_settings.gstin) with IGST applied for
// out-of-state customers, as already handled by InvoicePaper.tsx.

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
      .from("locations")
      .select("*")
      .order("id", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ locations: data ?? [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, state, gstin, address } = body;
    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("locations")
      .insert({
        name: name.trim(),
        state: state || null,
        gstin: gstin || null,
        address: address || null,
      })
      .select()
      .single();
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: `A location named "${name}" already exists.` },
          { status: 409 },
        );
      }
      throw error;
    }
    return NextResponse.json({ location: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id, name, state, gstin, address, is_active } = body;
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const patch: Record<string, any> = {};
    if (name !== undefined) patch.name = name;
    if (state !== undefined) patch.state = state;
    if (gstin !== undefined) patch.gstin = gstin || null;
    if (address !== undefined) patch.address = address;
    if (is_active !== undefined) patch.is_active = is_active;

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("locations")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ location: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}