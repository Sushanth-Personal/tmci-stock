// src/app/api/settings/route.ts
//
// Single-row settings table — company profile, bank details, invoice
// defaults, stock defaults, and (new) the active app theme. Logo is
// stored as a data: URI directly in the DB (no Supabase Storage bucket
// needed for one small image).

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

const EDITABLE_FIELDS = [
  "logo_url",
  "company_name",
  "company_id",
  "gstin",
  "address_line1",
  "address_line2",
  "address_line3",
  "address_line4",
  "phone",
  "email",
  "website",
  "gst_state",
  "bank_name",
  "account_number",
  "branch_name",
  "ifsc_code",
  "default_terms",
  "default_gst_rate",
  "low_stock_threshold",
  "invoice_prefix",
  "theme",
];

export async function GET() {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("company_settings")
      .select("*")
      .eq("id", 1)
      .single();
    if (error) throw error;
    return NextResponse.json({ settings: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();

    if (body.logo_url && body.logo_url.length > 400_000) {
      return NextResponse.json(
        {
          error:
            "Logo image is too large — please use a smaller file (under ~250KB).",
        },
        { status: 400 },
      );
    }

    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const key of EDITABLE_FIELDS) {
      if (body[key] !== undefined) patch[key] = body[key];
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("company_settings")
      .update(patch)
      .eq("id", 1)
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ settings: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
