// src/app/api/sales/route.ts
// Reads from Supabase transactions table instead of Google Sheets

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
      .from("transactions")
      .select("*")
      .eq("type", "Sale")
      .order("date", { ascending: false })
      .limit(500);

    if (error) throw error;

    // Normalise to camelCase so Transactions.tsx / Dashboard.tsx don't need changes
    const sales = (data ?? []).map((r: any) => ({
      txnId: r.txn_id,
      date: r.date,
      type: r.type,
      itemCode: r.item_code ?? "",
      model: r.model,
      location: r.location,
      qty: r.qty,
      unitPrice: r.unit_price,
      total: r.total,
      party: r.party,
      poOrInvoice: r.po_invoice,
      status: r.status,
      costPrice: r.cost_price ?? null,
    }));

    return NextResponse.json({ sales });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
