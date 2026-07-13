import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

// Normalise for matching model names against lots — trim + collapse
// internal whitespace + lowercase, same convention used in /api/stock and
// /api/purchases so dispatch matching doesn't silently miss on stray
// whitespace/case differences between the invoice line and the lots table.
function normModel(s: unknown): string {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

async function getNextTxnId(
  supabase: ReturnType<typeof getSupabase>,
): Promise<string> {
  const { data } = await supabase
    .from("transactions")
    .select("txn_id")
    .like("txn_id", "TXN-%")
    .order("txn_id", { ascending: false })
    .limit(1);
  const last = data?.[0]?.txn_id ?? "TXN-0000";
  const num = parseInt(last.replace("TXN-", ""), 10) || 0;
  return `TXN-${String(num + 1).padStart(4, "0")}`;
}
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const dispatchedAt: string =
      body.dispatched_at || new Date().toISOString().split("T")[0];

    const supabase = getSupabase();

    // 1. Load invoice
    const { data: invoice, error: invErr } = await supabase
      .from("sale_invoices")
      .select("*")
      .eq("id", id)
      .single();

    if (invErr || !invoice)
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    if (invoice.status !== "pending_dispatch")
      return NextResponse.json(
        {
          error: `Invoice is already ${invoice.status} — cannot dispatch again.`,
        },
        { status: 409 },
      );

    const location: string = invoice.location;
    const lineItems: any[] = invoice.line_items ?? [];

    if (lineItems.length === 0)
      return NextResponse.json(
        { error: "Invoice has no line items." },
        { status: 400 },
      );

    // 2. Load ALL open lots for this location once, then match in JS with
    //    normalised model names — avoids per-line exact-match DB queries
    //    silently missing on case/whitespace differences.
    const { data: allLots, error: lotsErr } = await supabase
      .from("lots")
      .select(
        "lot_id, model, remaining_qty, unit_purchase_price, date, serial_numbers",
      )
      .eq("location", location)
      .gt("remaining_qty", 0)
      .order("date", { ascending: true })
      .order("lot_id", { ascending: true });

    if (lotsErr) throw lotsErr;

    const lotsByModel = new Map<string, any[]>();
    for (const lot of allLots ?? []) {
      const key = normModel(lot.model);
      if (!lotsByModel.has(key)) lotsByModel.set(key, []);
      lotsByModel.get(key)!.push(lot);
    }

    // 3. Pre-flight check: verify enough stock exists for EVERY line before
    //    changing anything (all-or-nothing dispatch). Lines with serial
    //    numbers entered are validated serial-by-serial — every serial must
    //    exist in an open lot for this model+location, and no serial may be
    //    used twice within the same invoice. Lines with no serials entered
    //    fall back to a plain qty-available check (auto-FIFO).
    const shortages: string[] = [];
    const seenSerialsThisInvoice = new Set<string>();

    for (const item of lineItems) {
      const key = normModel(item.model);
      const lots = lotsByModel.get(key) ?? [];
      const enteredSerials: string[] = (item.serialNumbers ?? [])
        .map((s: any) => String(s ?? "").trim())
        .filter(Boolean);

      if (enteredSerials.length > 0) {
        if (enteredSerials.length !== Number(item.qty)) {
          shortages.push(
            `${item.model}: qty is ${item.qty} but ${enteredSerials.length} serial number(s) entered — ` +
              `these must match exactly, or clear all serials on this line to use automatic FIFO instead`,
          );
          continue;
        }
        for (const serial of enteredSerials) {
          if (seenSerialsThisInvoice.has(serial)) {
            shortages.push(
              `${item.model}: serial ${serial} appears more than once on this invoice`,
            );
            continue;
          }
          seenSerialsThisInvoice.add(serial);

          const ownerLot = lots.find(
            (l) =>
              Number(l.remaining_qty) > 0 &&
              Array.isArray(l.serial_numbers) &&
              l.serial_numbers.includes(serial),
          );
          if (!ownerLot) {
            shortages.push(
              `${item.model}: serial "${serial}" not found in available ${location} stock ` +
                `(already sold, belongs to a different model, or never recorded at purchase)`,
            );
          }
        }
      } else {
        const available = lots.reduce((s, l) => s + Number(l.remaining_qty), 0);
        if (available < Number(item.qty)) {
          shortages.push(
            `${item.model}: need ${item.qty}, only ${available} available in ${location}`,
          );
        }
      }
    }

    if (shortages.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot dispatch — ${shortages.join("; ")}. Check Stock & Serials view for exact spelling/availability.`,
        },
        { status: 400 },
      );
    }

    // 4. Consume stock for each line item.
    //    - If serials were entered: consume EXACTLY those serialed units,
    //      from whichever lot each serial actually lives in.
    //    - If no serials were entered: FIFO-consume from oldest lots first,
    //      taking whichever serials happen to be first in that lot (old
    //      behaviour, unchanged for non-serialised lines).
    const lotUpdates: Array<{
      lot_id: string;
      remaining_qty: number;
      serial_numbers: string[];
    }> = [];
    const saleTxns: any[] = [];
    const updatedLineItems: any[] = [];

    for (const item of lineItems) {
      const key = normModel(item.model);
      const lots = lotsByModel.get(key) ?? [];
      const enteredSerials: string[] = (item.serialNumbers ?? [])
        .map((s: any) => String(s ?? "").trim())
        .filter(Boolean);

      let costTotal = 0;
      const consumedSerials: string[] = [];

      const getLive = (lot: any) => {
        const already = lotUpdates.find((u) => u.lot_id === lot.lot_id);
        return {
          remaining: already
            ? already.remaining_qty
            : Number(lot.remaining_qty),
          serials: already
            ? already.serial_numbers
            : Array.isArray(lot.serial_numbers)
              ? [...lot.serial_numbers]
              : [],
        };
      };

      const applyUpdate = (
        lot: any,
        newRemaining: number,
        newSerials: string[],
      ) => {
        const already = lotUpdates.find((u) => u.lot_id === lot.lot_id);
        if (already) {
          already.remaining_qty = newRemaining;
          already.serial_numbers = newSerials;
        } else {
          lotUpdates.push({
            lot_id: lot.lot_id,
            remaining_qty: newRemaining,
            serial_numbers: newSerials,
          });
        }
      };

      if (enteredSerials.length > 0) {
        // ── Serial-exact dispatch ──
        for (const serial of enteredSerials) {
          for (const lot of lots) {
            const live = getLive(lot);
            if (live.remaining > 0 && live.serials.includes(serial)) {
              applyUpdate(
                lot,
                live.remaining - 1,
                live.serials.filter((s) => s !== serial),
              );
              costTotal += Number(lot.unit_purchase_price ?? 0);
              consumedSerials.push(serial);
              break;
            }
          }
        }
      } else {
        // ── Plain FIFO (oldest lot first) ──
        let remaining = Number(item.qty);
        for (const lot of lots) {
          if (remaining <= 0) break;
          const live = getLive(lot);
          if (live.remaining <= 0) continue;

          const take = Math.min(live.remaining, remaining);
          const takenSerials = live.serials.slice(0, take);
          const leftoverSerials = live.serials.slice(take);

          applyUpdate(lot, live.remaining - take, leftoverSerials);
          costTotal += take * Number(lot.unit_purchase_price ?? 0);
          consumedSerials.push(...takenSerials);
          remaining -= take;
        }
      }

      const txnId = await getNextTxnId(supabase);
      saleTxns.push({
        txn_id: txnId,
        date: dispatchedAt,
        type: "Sale",
        item_code: item.itemCode || "",
        model: item.model,
        location,
        qty: Number(item.qty),
        unit_price: Number(item.unitSalePrice) || 0,
        total:
          Number(item.qty) *
          (Number(item.unitSalePrice) || 0) *
          (1 - (Number(item.discount) || 0) / 100),
        party:
          invoice.customer_snapshot?.display_name ||
          invoice.customer_snapshot?.name ||
          "",
        po_invoice: invoice.invoice_number,
        status: "Dispatched",
        cost_price: Number(item.qty) > 0 ? costTotal / Number(item.qty) : 0,
        serial_numbers: consumedSerials,
      });

      // Line item now carries the REAL serials that were actually
      // dispatched (identical to what was typed, when serials were given —
      // or the FIFO-picked ones, when they weren't).
      updatedLineItems.push({
        ...item,
        serialNumbers: consumedSerials,
      });
    }

    // 5. Apply all lot updates (remaining_qty AND serial_numbers)
    for (const u of lotUpdates) {
      const { error } = await supabase
        .from("lots")
        .update({
          remaining_qty: u.remaining_qty,
          serial_numbers: u.serial_numbers,
        })
        .eq("lot_id", u.lot_id);
      if (error) throw error;
    }

    // 6. Insert all Sale transactions
    const { error: txnInsertErr } = await supabase
      .from("transactions")
      .insert(saleTxns);
    if (txnInsertErr) throw txnInsertErr;

    // 7. Mark invoice dispatched AND overwrite line_items with real serials
    const { error: updateInvErr } = await supabase
      .from("sale_invoices")
      .update({
        status: "dispatched",
        dispatched_at: dispatchedAt,
        line_items: updatedLineItems,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateInvErr) throw updateInvErr;

    return NextResponse.json({
      success: true,
      invoiceNumber: invoice.invoice_number,
      dispatchedAt,
      lotsUpdated: lotUpdates.length,
      transactionsCreated: saleTxns.length,
      serialsAssigned: saleTxns.reduce(
        (s, t) => s + (t.serial_numbers?.length ?? 0),
        0,
      ),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
