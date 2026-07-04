// src/app/api/invoices/purge/route.ts
// Permanently deletes invoices that have been in the bin for 30+ days.
// Triggered daily by Vercel Cron (see vercel.json).

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

function isCronAuthorized(req: Request): boolean {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return authHeader === `Bearer ${cronSecret}`;
}

export async function POST(req: Request) {
  try {
    const isCron = req.headers.get("x-vercel-cron") === "1";
    if (isCron && !isCronAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabase();
    const cutoff = new Date(
      Date.now() - RETENTION_DAYS * 86400000,
    ).toISOString();

    const { data, error } = await supabase
      .from("sale_invoices")
      .delete()
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff)
      .select("id, invoice_number");

    if (error) throw error;

    return NextResponse.json({
      success: true,
      purged: data?.length ?? 0,
      invoices: data?.map((d) => d.invoice_number) ?? [],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
