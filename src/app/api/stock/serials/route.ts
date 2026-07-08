// src/app/api/stock/serials/route.ts
//
// GET ?q=serial          → search by serial number, returns where it was sold
//                           (from transactions.serial_numbers) or which lot
//                           it's currently sitting in (from lots.serial_numbers)
// GET (no params)         → full stock summary with per-lot serial detail

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

function normModel(s: unknown): string {
  return String(s ?? "")
    .replace(/\s+/g, "")
    .toLowerCase()
    .trim();
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();
    const supabase = getSupabase();

    // ── Serial number search mode ──────────────────────────────────────────
    if (q) {
      const needle = q.toLowerCase();

      // Search lots (currently in stock — purchased, possibly not yet sold)
      const { data: lots, error: lotsErr } = await supabase
        .from("lots")
        .select(
          "lot_id, model, location, date, remaining_qty, serial_numbers, vendor, po_invoice",
        );
      if (lotsErr) throw lotsErr;

      const lotMatches = (lots ?? [])
        .filter(
          (l) =>
            Array.isArray(l.serial_numbers) &&
            l.serial_numbers.some((s: string) =>
              String(s).toLowerCase().includes(needle),
            ),
        )
        .map((l) => ({
          serial: (l.serial_numbers as string[]).find((s) =>
            s.toLowerCase().includes(needle),
          ),
          model: l.model,
          location: l.location,
          lotId: l.lot_id,
          purchaseDate: l.date,
          vendor: l.vendor,
          poInvoice: l.po_invoice,
          status: "in_lot", // may or may not still be physically in stock depending on remaining_qty
          lotRemainingQty: l.remaining_qty,
        }));

      // Search transactions (sold — known customer + invoice)
      const { data: txns, error: txnsErr } = await supabase
        .from("transactions")
        .select(
          "txn_id, date, model, location, party, po_invoice, serial_numbers",
        )
        .eq("type", "Sale");
      if (txnsErr) throw txnsErr;

      const saleMatches = (txns ?? [])
        .filter(
          (t) =>
            Array.isArray(t.serial_numbers) &&
            t.serial_numbers.some((s: string) =>
              String(s).toLowerCase().includes(needle),
            ),
        )
        .map((t) => ({
          serial: (t.serial_numbers as string[]).find((s) =>
            s.toLowerCase().includes(needle),
          ),
          model: t.model,
          location: t.location,
          soldTo: t.party,
          invoiceNumber: t.po_invoice,
          saleDate: t.date,
          status: "sold",
        }));

      return NextResponse.json({ lotMatches, saleMatches });
    }

    // ── Full stock summary with per-lot serials ─────────────────────────────
    const [lotsRes, productsRes] = await Promise.all([
      supabase
        .from("lots")
        .select(
          "lot_id, model, location, date, qty_purchased, remaining_qty, serial_numbers, vendor",
        )
        .order("date", { ascending: true }),
      supabase.from("products").select("model, item_code, make, category"),
    ]);

    if (lotsRes.error) throw lotsRes.error;
    if (productsRes.error) throw productsRes.error;

    const lots = lotsRes.data ?? [];
    const products = productsRes.data ?? [];
    const productByModel = new Map(
      products.map((p) => [normModel(p.model), p]),
    );

    // Group lots by model
    const grouped = new Map<
      string,
      {
        model: string;
        kochiQty: number;
        bangaloreQty: number;
        lots: Array<{
          lotId: string;
          location: string;
          date: string;
          qtyPurchased: number;
          remainingQty: number;
          serialNumbers: string[];
          vendor: string;
        }>;
      }
    >();

    for (const l of lots) {
      const key = normModel(l.model);
      if (!grouped.has(key)) {
        grouped.set(key, {
          model: String(l.model ?? "").trim(),
          kochiQty: 0,
          bangaloreQty: 0,
          lots: [],
        });
      }
      const g = grouped.get(key)!;
      const remaining = Number(l.remaining_qty ?? 0);
      if (String(l.location).toLowerCase() === "kochi") g.kochiQty += remaining;
      else g.bangaloreQty += remaining;

      // Only include lots that still have stock OR have serials worth showing
      if (
        remaining > 0 ||
        (Array.isArray(l.serial_numbers) && l.serial_numbers.length > 0)
      ) {
        g.lots.push({
          lotId: l.lot_id,
          location: l.location,
          date: l.date,
          qtyPurchased: Number(l.qty_purchased ?? 0),
          remainingQty: remaining,
          serialNumbers: Array.isArray(l.serial_numbers)
            ? l.serial_numbers
            : [],
          vendor: l.vendor ?? "",
        });
      }
    }

    const stock = Array.from(grouped.entries())
      .filter(([, g]) => g.kochiQty > 0 || g.bangaloreQty > 0)
      .map(([key, g]) => {
        const prod = productByModel.get(key);
        return {
          model: g.model,
          itemCode: prod?.item_code ?? "",
          make: prod?.make ?? "",
          category: prod?.category ?? "",
          kochiQty: g.kochiQty,
          bangaloreQty: g.bangaloreQty,
          totalQty: g.kochiQty + g.bangaloreQty,
          lots: g.lots,
          hasSerialData: g.lots.some((l) => l.serialNumbers.length > 0),
        };
      })
      .sort((a, b) => a.model.localeCompare(b.model));

    return NextResponse.json({ stock });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
