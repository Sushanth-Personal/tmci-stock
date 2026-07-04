// src/app/api/customers/route.ts
// GET  /api/customers?q=search  → list customers (mapped for UI compatibility)
// GET  /api/customers?id=uuid   → single customer
// POST /api/customers           → create customer

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Map DB row (Zoho schema: display_name, billing_*) → UI shape (name, address, city…)
function mapCustomer(row: any) {
  return {
    id: row.id,
    name: row.display_name ?? row.company_name ?? "",
    address: row.billing_address ?? "",
    city: row.billing_city ?? "",
    state: row.billing_state ?? "",
    pincode: row.billing_pincode ?? "",
    gstin: row.gstin ?? "",
    phone: row.phone ?? row.mobile ?? "",
    email: row.email ?? "",
    zoho_contact_id: row.zoho_contact_id ?? null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const q = (searchParams.get("q") ?? "").trim();

    if (id) {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return NextResponse.json({ customer: mapCustomer(data) });
    }

    let query = supabase
      .from("customers")
      .select("*")
      .eq("status", "Active")
      .order("display_name", { ascending: true })
      .limit(25);

    if (q) {
      // Search display_name, company_name, and GSTIN
      query = query.or(
        `display_name.ilike.%${q}%,company_name.ilike.%${q}%,gstin.ilike.%${q}%`,
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ customers: (data ?? []).map(mapCustomer) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.name || !String(body.name).trim()) {
      return NextResponse.json(
        { error: "Customer name is required" },
        { status: 400 },
      );
    }

    // Map UI shape → DB columns (Zoho schema)
    const row = {
      display_name: String(body.name).trim(),
      company_name: String(body.name).trim(),
      billing_address: body.address || null,
      billing_city: body.city || null,
      billing_state: body.state || null,
      billing_pincode: body.pincode || null,
      // Mirror billing → shipping by default
      shipping_address: body.address || null,
      shipping_city: body.city || null,
      shipping_state: body.state || null,
      shipping_pincode: body.pincode || null,
      gstin: body.gstin || null,
      phone: body.phone || null,
      email: body.email || null,
      customer_sub_type: "business",
      status: "Active",
    };

    const { data, error } = await supabase
      .from("customers")
      .insert(row)
      .select()
      .single();

    if (error) {
      // Duplicate GSTIN or similar constraint
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "A customer with these details already exists." },
          { status: 409 },
        );
      }
      throw error;
    }

    return NextResponse.json({ customer: mapCustomer(data) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
