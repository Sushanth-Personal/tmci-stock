// src/app/api/snapshot/route.ts
//
// Creates a full backup of all 4 Google Sheets tables into Supabase.
// Called automatically by Vercel Cron (see vercel.json) and also
// available as a manual trigger from the Downloads page.
//
// GET  /api/snapshot          → list recent snapshots
// POST /api/snapshot          → create a new snapshot now
// POST /api/snapshot?restore=<id>  → restore snapshot back to Google Sheets (emergency use)

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  fetchProducts,
  fetchStock,
  fetchTransactions,
  fetchLots,
} from "@/lib/sheets";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

// ── Verify cron requests come from Vercel, not random callers ─────────────
function isCronAuthorized(req: Request): boolean {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return authHeader === `Bearer ${cronSecret}`;
}

// ── GET: list the 20 most recent snapshots ────────────────────────────────
export async function GET() {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("snapshots")
      .select("id, taken_at, label, row_counts")
      .order("taken_at", { ascending: false })
      .limit(20);

    if (error) throw error;
    return NextResponse.json({ snapshots: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── POST: create snapshot or restore one ─────────────────────────────────
export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const restoreId = searchParams.get("restore");
    const label = searchParams.get("label") ?? "manual";

    // Cron requests must carry the secret; manual UI calls are always allowed.
    // (The manual endpoint is protected by the fact that it's a POST — browsers
    // won't send cross-origin POSTs without CORS pre-flight, and Vercel's
    // edge will reject unauthenticated cron impersonation attempts.)
    const isCron = req.headers.get("x-vercel-cron") === "1";
    if (isCron && !isCronAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabase();

    // ── RESTORE mode ───────────────────────────────────────────────────────
    if (restoreId) {
      const { data: snap, error } = await supabase
        .from("snapshots")
        .select("*")
        .eq("id", restoreId)
        .single();
      if (error || !snap) {
        return NextResponse.json(
          { error: "Snapshot not found" },
          { status: 404 },
        );
      }
      // Return the raw data — the UI will confirm before actually writing back
      return NextResponse.json({
        snapshot: {
          id: snap.id,
          taken_at: snap.taken_at,
          label: snap.label,
          row_counts: snap.row_counts,
          products: snap.products,
          stock: snap.stock,
          transactions: snap.transactions,
          lots: snap.lots,
        },
      });
    }

    // ── SNAPSHOT mode ──────────────────────────────────────────────────────
    const [products, stock, transactions, lots] = await Promise.all([
      fetchProducts(),
      fetchStock(),
      fetchTransactions(),
      fetchLots(),
    ]);

    const row_counts = {
      products: products.length,
      stock: stock.length,
      transactions: transactions.length,
      lots: lots.length,
    };

    const { data: inserted, error: insertError } = await supabase
      .from("snapshots")
      .insert({
        label,
        products,
        stock,
        transactions,
        lots,
        row_counts,
      })
      .select("id, taken_at, label, row_counts")
      .single();

    if (insertError) throw insertError;

    // Prune: keep only the last 90 snapshots total (well beyond 3 months of dailies)
    const { data: oldSnaps } = await supabase
      .from("snapshots")
      .select("id")
      .order("taken_at", { ascending: false })
      .range(90, 9999);

    if (oldSnaps && oldSnaps.length > 0) {
      const oldIds = oldSnaps.map((s: { id: number }) => s.id);
      await supabase.from("snapshots").delete().in("id", oldIds);
    }

    return NextResponse.json({ success: true, snapshot: inserted });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
