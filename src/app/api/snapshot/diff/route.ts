// src/app/api/snapshot/diff/route.ts
//
// POST /api/snapshot/diff
// Body: { id: number, tables: string[] }
//
// Compares a Supabase snapshot against the LIVE Google Sheet data and returns
// a per-table diff: which rows are only in the snapshot (would be restored),
// only in the live sheet (would be lost on full overwrite), or in both but changed.
//
// Primary key per table:
//   transactions → txnId
//   lots         → lotId
//   stock        → itemCode + location
//   products     → itemCode

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

// Which field(s) uniquely identify a row per table
function getPrimaryKey(table: string, row: Record<string, unknown>): string {
  switch (table) {
    case "transactions":
      return String(row.txnId ?? "");
    case "lots":
      return String(row.lotId ?? "");
    case "stock":
      return `${row.itemCode}__${row.location}`;
    case "products":
      return String(row.itemCode ?? "");
    default:
      return JSON.stringify(row);
  }
}

// Human-readable label for a row (shown in diff table)
function getRowLabel(table: string, row: Record<string, unknown>): string {
  switch (table) {
    case "transactions":
      return `${row.txnId} · ${row.type} · ${row.model} · ${row.date}`;
    case "lots":
      return `${row.lotId} · ${row.model} · ${row.location}`;
    case "stock":
      return `${row.model} · ${row.location}`;
    case "products":
      return `${row.itemCode} · ${row.model}`;
    default:
      return JSON.stringify(row);
  }
}

// Fields to compare for "changed" detection (skip internal row numbers etc.)
const COMPARE_FIELDS: Record<string, string[]> = {
  transactions: [
    "date",
    "type",
    "itemCode",
    "model",
    "location",
    "qty",
    "unitPrice",
    "total",
    "party",
    "poOrInvoice",
    "status",
    "costPrice",
  ],
  lots: [
    "date",
    "itemCode",
    "model",
    "location",
    "qtyPurchased",
    "remainingQty",
    "unitPurchasePrice",
    "vendor",
    "poOrInvoice",
  ],
  stock: [
    "itemCode",
    "model",
    "location",
    "openingStock",
    "received",
    "sold",
    "currentStock",
  ],
  products: [
    "itemCode",
    "hsn",
    "category",
    "model",
    "description",
    "listPrice",
    "warranty",
    "moq",
  ],
};

interface DiffRow {
  key: string;
  label: string;
  status: "added" | "deleted" | "changed" | "unchanged";
  snapshotRow: Record<string, unknown> | null;
  liveRow: Record<string, unknown> | null;
  changedFields?: Array<{ field: string; snapshot: unknown; live: unknown }>;
}

interface TableDiff {
  table: string;
  added: number; // in snapshot, not in live (restore would add these)
  deleted: number; // in live, not in snapshot (restore would delete these)
  changed: number; // in both but values differ
  unchanged: number;
  rows: DiffRow[]; // full detail — only added/deleted/changed, not unchanged (too noisy)
  liveAhead: boolean; // live sheet has rows the snapshot doesn't — danger signal
}

// Convert live typed objects to a flat comparable shape
function normalizeLiveRow(
  table: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  // Remove internal sheet row number before comparing
  const { row: _row, ...rest } = row as { row?: unknown } & Record<
    string,
    unknown
  >;
  void _row;
  return rest;
}

function compareRows(
  table: string,
  snapRow: Record<string, unknown>,
  liveRow: Record<string, unknown>,
): Array<{ field: string; snapshot: unknown; live: unknown }> {
  const fields = COMPARE_FIELDS[table] ?? [];
  const diffs: Array<{ field: string; snapshot: unknown; live: unknown }> = [];
  for (const f of fields) {
    const sv = snapRow[f] ?? "";
    const lv = liveRow[f] ?? "";
    // Coerce to string for loose comparison (sheet returns numbers/strings inconsistently)
    if (String(sv).trim() !== String(lv).trim()) {
      diffs.push({ field: f, snapshot: sv, live: lv });
    }
  }
  return diffs;
}

async function diffTable(
  table: string,
  snapshotRows: Record<string, unknown>[],
  liveRows: Record<string, unknown>[],
): Promise<TableDiff> {
  const snapMap = new Map<string, Record<string, unknown>>();
  for (const r of snapshotRows) {
    snapMap.set(getPrimaryKey(table, r), r);
  }

  const liveMap = new Map<string, Record<string, unknown>>();
  for (const r of liveRows) {
    const normalized = normalizeLiveRow(table, r);
    liveMap.set(getPrimaryKey(table, normalized), normalized);
  }

  const rows: DiffRow[] = [];
  let added = 0,
    deleted = 0,
    changed = 0,
    unchanged = 0;

  // Rows in snapshot — check if missing or changed in live
  for (const [key, snapRow] of snapMap) {
    const label = getRowLabel(table, snapRow);
    if (!liveMap.has(key)) {
      // In snapshot but not in live → restore would ADD this
      added++;
      rows.push({
        key,
        label,
        status: "added",
        snapshotRow: snapRow,
        liveRow: null,
      });
    } else {
      const liveRow = liveMap.get(key)!;
      const changedFields = compareRows(table, snapRow, liveRow);
      if (changedFields.length > 0) {
        changed++;
        rows.push({
          key,
          label,
          status: "changed",
          snapshotRow: snapRow,
          liveRow,
          changedFields,
        });
      } else {
        unchanged++;
        // Don't push unchanged rows — too noisy. They're counted only.
      }
    }
  }

  // Rows in live but not in snapshot → restore would DELETE these (danger!)
  for (const [key, liveRow] of liveMap) {
    if (!snapMap.has(key)) {
      deleted++;
      const label = getRowLabel(table, liveRow);
      rows.push({ key, label, status: "deleted", snapshotRow: null, liveRow });
    }
  }

  // Sort: deleted first (most dangerous), then changed, then added
  rows.sort((a, b) => {
    const order = { deleted: 0, changed: 1, added: 2, unchanged: 3 };
    return order[a.status] - order[b.status];
  });

  return {
    table,
    added,
    deleted,
    changed,
    unchanged,
    rows,
    liveAhead: deleted > 0,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id, tables = ["transactions", "lots", "stock", "products"] } =
      body as {
        id: number;
        tables: string[];
      };

    if (!id) {
      return NextResponse.json(
        { error: "Snapshot id is required" },
        { status: 400 },
      );
    }

    // Fetch snapshot from Supabase
    const supabase = getSupabase();
    const { data: snap, error } = await supabase
      .from("snapshots")
      .select(
        "id, taken_at, label, row_counts, products, stock, transactions, lots",
      )
      .eq("id", id)
      .single();

    if (error || !snap) {
      return NextResponse.json(
        { error: "Snapshot not found" },
        { status: 404 },
      );
    }

    // Fetch live data from Google Sheets in parallel
    const [liveProducts, liveStock, liveTxns, liveLots] = await Promise.all([
      fetchProducts(),
      fetchStock(),
      fetchTransactions(),
      fetchLots(),
    ]);

    const liveData: Record<string, unknown[]> = {
      products: liveProducts as unknown[],
      stock: liveStock as unknown[],
      transactions: liveTxns as unknown[],
      lots: liveLots as unknown[],
    };

    // Run diff for each requested table
    const diffs: TableDiff[] = [];
    for (const table of tables) {
      const snapRows =
        (snap[table as keyof typeof snap] as Record<string, unknown>[]) ?? [];
      const liveRows = (liveData[table] as Record<string, unknown>[]) ?? [];
      const diff = await diffTable(table, snapRows, liveRows);
      diffs.push(diff);
    }

    // Overall danger signal: live sheet is ahead of snapshot on any table
    const anyLiveAhead = diffs.some((d) => d.liveAhead);
    const totalDeleted = diffs.reduce((s, d) => s + d.deleted, 0);
    const totalAdded = diffs.reduce((s, d) => s + d.added, 0);
    const totalChanged = diffs.reduce((s, d) => s + d.changed, 0);

    return NextResponse.json({
      snapshotId: id,
      takenAt: snap.taken_at,
      label: snap.label,
      anyLiveAhead,
      summary: { totalDeleted, totalAdded, totalChanged },
      diffs,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
