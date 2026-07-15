// src/app/api/invoices/[id]/dispatch/route.ts
//
// PATCH — dispatches a pending invoice: consumes FIFO lots (or exact
// serial-matched units), logs Sale transactions, marks invoice dispatched.
//
// SERIAL RESOLUTION: entered serials go through three tiers:
//   1. Exact match against a lot's recorded serial_numbers — the normal case.
//   2. A user-confirmed assignment (serialLotAssignments in the request body)
//      — for units purchased before this app tracked serials at all, where
//      the lot exists and has open stock, but never recorded which serial
//      belongs to which unit.
//   3. Neither of the above, but stock IS available for that model/location
//      — instead of failing, we return `needsSerialAssignment: true` with a
//      list of candidate lots so the client can ask the user which purchase
//      this unit actually came from, then retry with that answer.
// Only a genuine stock shortage (no open lots at all) is a hard failure.

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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const dispatchedAt: string =
      body.dispatched_at || new Date().toISOString().split("T")[0];
    // { "<serial>": "<lot_id>" } — how the user resolved any serials that
    // were entered on the sale but were never recorded at purchase time
    // (units bought before this app tracked serials).
    const serialLotAssignments: Record<string, string> =
      body.serialLotAssignments ?? {};

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
        "lot_id, model, remaining_qty, unit_purchase_price, date, serial_numbers, vendor, po_invoice",
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

    // Tracks how much of each lot's remaining_qty has been provisionally
    // spoken for during THIS request's pre-flight pass, so multiple serials
    // /lines on the same invoice can't over-allocate a lot that only has a
    // few units left.
    const provisional = new Map<string, number>(); // lot_id -> qty reserved
    const availableInLot = (lot: any) =>
      Number(lot.remaining_qty) - (provisional.get(lot.lot_id) ?? 0);

    // 3. Pre-flight: resolve every entered serial to a lot (exact match,
    //    then confirmed assignment, then "ask the user"), and check plain
    //    qty availability for non-serialed lines. Lines with serial numbers
    //    entered are validated serial-by-serial — every serial must exist
    //    in an open lot, be explicitly assigned to one, or (if stock
    //    exists at all) get queued up for the user to assign. No serial may
    //    be used twice within the same invoice.
    const shortages: string[] = [];
    const needsAssignment: Array<{
      model: string;
      location: string;
      serial: string;
      candidateLots: Array<{
        lot_id: string;
        date: string;
        vendor: string;
        po_invoice: string;
        remaining_qty: number;
      }>;
    }> = [];
    const seenSerialsThisInvoice = new Set<string>();
    // serial -> resolved lot_id (matched or assigned), consumed in step 4.
    const resolvedSerialLot = new Map<string, string>();
    // serial -> lot_id, but ONLY for retroactive assignments (units that
    // were never serial-tracked at purchase time). These need the
    // ORIGINAL PURCHASE transaction backfilled with the now-known serial,
    // in addition to the resulting Sale transaction — otherwise the
    // purchase-side record permanently under-represents what was bought.
    const retroactiveAssignments = new Map<string, string>();

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

          // (a) Exact match against a lot's recorded serials — normal path.
          const ownerLot = lots.find(
            (l) =>
              availableInLot(l) > 0 &&
              Array.isArray(l.serial_numbers) &&
              l.serial_numbers.includes(serial),
          );
          if (ownerLot) {
            provisional.set(
              ownerLot.lot_id,
              (provisional.get(ownerLot.lot_id) ?? 0) + 1,
            );
            resolvedSerialLot.set(serial, ownerLot.lot_id);
            continue;
          }

          // (b) User already told us (on a retry) which purchase this
          // serial's unit came from — validate and accept it.
          const assignedLotId = serialLotAssignments[serial];
          if (assignedLotId) {
            const assignedLot = lots.find((l) => l.lot_id === assignedLotId);
            if (!assignedLot) {
              shortages.push(
                `${item.model}: serial "${serial}" was assigned to lot ${assignedLotId}, but that lot no longer matches this model/location — please re-check.`,
              );
              continue;
            }
            if (availableInLot(assignedLot) <= 0) {
              shortages.push(
                `${item.model}: serial "${serial}" was assigned to lot ${assignedLotId}, but that lot has no stock left after other allocations on this invoice.`,
              );
              continue;
            }
            provisional.set(
              assignedLot.lot_id,
              (provisional.get(assignedLot.lot_id) ?? 0) + 1,
            );
            resolvedSerialLot.set(serial, assignedLot.lot_id);
            retroactiveAssignments.set(serial, assignedLot.lot_id);
            continue;
          }

          // (c) No exact match, no assignment yet. If there's open stock
          // for this model/location at all, this is very likely a unit
          // that was purchased before serial tracking existed in the app —
          // ask which purchase it came from instead of failing outright.
          const totalAvailable = lots.reduce(
            (s, l) => s + availableInLot(l),
            0,
          );
          if (totalAvailable > 0) {
            needsAssignment.push({
              model: item.model,
              location,
              serial,
              candidateLots: lots
                .filter((l) => availableInLot(l) > 0)
                .map((l) => ({
                  lot_id: l.lot_id,
                  date: l.date,
                  vendor: l.vendor,
                  po_invoice: l.po_invoice,
                  remaining_qty: availableInLot(l),
                })),
            });
          } else {
            shortages.push(
              `${item.model}: no purchase record found for serial "${serial}" — and there is no stock at all for this model in ${location}. Please record a Purchase for this item before dispatching.`,
            );
          }
        }
      } else {
        const available = lots.reduce((s, l) => s + availableInLot(l), 0);
        if (available < Number(item.qty)) {
          const missing = Number(item.qty) - available;
          shortages.push(
            `${item.model}: purchase records show only ${available} unit(s) available in ${location}, ` +
              `but this invoice needs ${item.qty} — please record a Purchase for the missing ${missing} unit(s) before dispatching.`,
          );
        } else {
          // Provisionally reserve FIFO-first so any serialed lines checked
          // afterward for the SAME model see accurate remaining availability.
          let remaining = Number(item.qty);
          for (const lot of lots) {
            if (remaining <= 0) break;
            const avail = availableInLot(lot);
            if (avail <= 0) continue;
            const take = Math.min(avail, remaining);
            provisional.set(
              lot.lot_id,
              (provisional.get(lot.lot_id) ?? 0) + take,
            );
            remaining -= take;
          }
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

    if (needsAssignment.length > 0) {
      return NextResponse.json(
        {
          needsSerialAssignment: true,
          unmatchedSerials: needsAssignment,
          message:
            "Some entered serial numbers don't match any recorded purchase serial, but there IS open stock for that model — these units were likely purchased before serial tracking. Pick which purchase each one came from, then retry dispatch.",
        },
        { status: 409 },
      );
    }

    // 4. Consume stock for each line item.
    //    - Serial-exact / assigned: consume EXACTLY that unit from
    //      whichever lot it resolved to in step 3. If the lot actually had
    //      this serial recorded, strip it out of the lot's list (normal
    //      path). If it was a retroactive assignment (lot never tracked
    //      this serial), there's nothing to strip — the permanent record
    //      of "this serial came from this purchase" is the resulting Sale
    //      transaction itself.
    //    - No serials entered: FIFO-consume from oldest lots first, taking
    //      whichever serials happen to be first in that lot (unchanged).
    //
    // Txn IDs are reserved as a contiguous block ONCE here, then handed out
    // locally as we go. Querying the DB fresh per line item would keep
    // returning the same "next" id every time, since nothing is actually
    // inserted until the single batch insert at the end of this function —
    // every line would collide on an identical txn_id.
    const { data: lastTxnRow } = await supabase
      .from("transactions")
      .select("txn_id")
      .like("txn_id", "TXN-%")
      .order("txn_id", { ascending: false })
      .limit(1);
    let nextTxnNum =
      (parseInt(
        (lastTxnRow?.[0]?.txn_id ?? "TXN-0000").replace("TXN-", ""),
        10,
      ) || 0) + 1;

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
        for (const serial of enteredSerials) {
          const lotId = resolvedSerialLot.get(serial);
          const lot = lots.find((l) => l.lot_id === lotId);
          if (!lot) continue; // pre-flight already validated every serial

          const live = getLive(lot);
          const hadSerialRecorded = live.serials.includes(serial);
          applyUpdate(
            lot,
            live.remaining - 1,
            hadSerialRecorded
              ? live.serials.filter((s) => s !== serial)
              : live.serials, // retroactive assignment — nothing to strip
          );
          costTotal += Number(lot.unit_purchase_price ?? 0);
          consumedSerials.push(serial);
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

      const txnId = `TXN-${String(nextTxnNum++).padStart(4, "0")}`;
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
      // dispatched.
      updatedLineItems.push({
        ...item,
        serialNumbers: consumedSerials,
      });
    }

    // 5. Insert all Sale transactions FIRST. If this fails for any reason
    //    (id collision, constraint violation, etc.), we bail out before
    //    touching a single lot — Supabase's JS client has no cross-call
    //    transaction, so whichever write happens second is the one that's
    //    "safe" to fail on. A single multi-row INSERT is atomic in
    //    Postgres, so either all sale rows land or none do.
    const { error: txnInsertErr } = await supabase
      .from("transactions")
      .insert(saleTxns);
    if (txnInsertErr) throw txnInsertErr;

    // 6. Only now apply lot updates (remaining_qty AND serial_numbers) —
    //    the sales are already safely recorded, so stock consumption
    //    reflects reality even if an individual lot update below hiccups.
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

    // 7. Backfill the ORIGINAL PURCHASE transaction for any retroactively
    //    assigned serials — this is the actual point of asking "which
    //    purchase did this come from": both the sale AND the purchase
    //    record should end up knowing this serial, not just the sale.
    //    (The lot itself is intentionally left alone — it tracks CURRENT
    //    availability, and these units already left stock in step 6.)
    if (retroactiveAssignments.size > 0) {
      const serialsByLot = new Map<string, string[]>();
      for (const [serial, lotId] of retroactiveAssignments) {
        if (!serialsByLot.has(lotId)) serialsByLot.set(lotId, []);
        serialsByLot.get(lotId)!.push(serial);
      }

      for (const [lotId, newSerials] of serialsByLot) {
        const lot = (allLots ?? []).find((l) => l.lot_id === lotId);
        if (!lot) continue;

        // Same join used to identify "the purchase behind this lot" —
        // one purchase (transaction + lot) is created together per POST
        // to /api/purchases, matched on model+location+date+po_invoice.
        const { data: purchaseTxns } = await supabase
          .from("transactions")
          .select("id, txn_id, serial_numbers")
          .eq("type", "Purchase")
          .eq("model", lot.model)
          .eq("location", location)
          .eq("date", lot.date)
          .eq("po_invoice", lot.po_invoice ?? "");

        const purchaseTxn = (purchaseTxns ?? [])[0];
        if (!purchaseTxn) continue; // no matching purchase row — nothing to backfill

        const existing: string[] = Array.isArray(purchaseTxn.serial_numbers)
          ? purchaseTxn.serial_numbers.filter(Boolean)
          : [];
        const merged = Array.from(new Set([...existing, ...newSerials]));

        await supabase
          .from("transactions")
          .update({ serial_numbers: merged })
          .eq("txn_id", purchaseTxn.txn_id);
      }
    }

    // 8. Mark invoice dispatched AND overwrite line_items with real serials
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
    console.error("[dispatch] failed:", err);
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "object" && err && "message" in err
          ? String((err as any).message)
          : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
