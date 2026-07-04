// src/app/api/invoices/bin/route.ts
// GET /api/invoices/bin — list all binned invoices (with days-remaining)

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

const RETENTION_DAYS = 30;

export async function GET() {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("sale_invoices")
      .select("*")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });

    if (error) throw error;

    const now = Date.now();
    const invoices = (data ?? []).map((inv) => {
      const deletedAt = new Date(inv.deleted_at).getTime();
      const purgeAt = deletedAt + RETENTION_DAYS * 86400000;
      const daysLeft = Math.max(0, Math.ceil((purgeAt - now) / 86400000));
      return { ...inv, daysLeft, purgeAt: new Date(purgeAt).toISOString() };
    });

    return NextResponse.json({ invoices, retentionDays: RETENTION_DAYS });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
