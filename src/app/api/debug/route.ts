// src/app/api/debug/route.ts
// TEMPORARY — delete after debugging
// Visit: /api/debug

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing env vars");
  return createClient(url, key);
}

export async function GET() {
  const supabase = getSupabase();

  const [lots, invoices, transactions, stock, products] = await Promise.all([
    supabase.from("lots").select("*").order("date", { ascending: true }),
    supabase
      .from("sale_invoices")
      .select("*")
      .order("invoice_date", { ascending: true }),
    supabase
      .from("transactions")
      .select("*")
      .order("date", { ascending: true }),
    supabase.from("stock").select("*").order("model"),
    supabase.from("products").select("*").order("model"),
  ]);

  return NextResponse.json({
    lots: lots.data,
    invoices: invoices.data,
    transactions: transactions.data,
    stock: stock.data,
    products: products.data,
    counts: {
      lots: lots.data?.length,
      invoices: invoices.data?.length,
      transactions: transactions.data?.length,
      stock: stock.data?.length,
      products: products.data?.length,
    },
  });
}
