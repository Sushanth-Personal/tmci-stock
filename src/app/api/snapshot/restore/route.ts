// src/app/api/snapshot/restore/route.ts
//
// POST /api/snapshot/restore
// Body: { id: number, tables: ("products" | "stock" | "transactions" | "lots")[] }
//
// Restores the specified tables from a Supabase snapshot back to Google Sheets.
// This is destructive — it CLEARS the sheet header+data and rewrites from the snapshot.
// A "dry run" mode (dryRun: true) returns what WOULD be written without touching Sheets.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getSheetsClient,
  SHEET_ID,
  SHEETS,
  ensureLotsSheet,
} from "@/lib/sheets";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

// Column headers per sheet — must match what the app expects to read back
const HEADERS: Record<string, string[]> = {
  products: [
    "Item Code",
    "HSN",
    "Category",
    "Model",
    "Description",
    "List Price (₹)",
    "Warranty",
    "MOQ",
  ],
  stock: [
    "Item Code",
    "Model",
    "Description",
    "Location",
    "Opening Stock",
    "Ordered",
    "Received",
    "Sold",
    "Current Stock",
    "List Price (₹)",
  ],
  transactions: [
    "Txn ID",
    "Date",
    "Type",
    "Item Code",
    "Model",
    "Location",
    "Qty",
    "Unit Price (₹)",
    "Total (₹)",
    "Vendor / Customer",
    "PO / Invoice No",
    "Status",
    "Cost Price (₹)",
    "Invoice Date",
  ],
  lots: [
    "Lot ID",
    "Date",
    "Item Code",
    "Model",
    "Location",
    "Qty Purchased",
    "Remaining Qty",
    "Unit Purchase Price (₹)",
    "Vendor",
    "PO / Invoice No",
  ],
};

// Sheet names in the Google Spreadsheet
const SHEET_NAMES: Record<string, string> = {
  products: SHEETS.PRODUCTS,
  stock: SHEETS.STOCK,
  transactions: SHEETS.TRANSACTIONS,
  lots: SHEETS.LOTS,
};

// Convert a snapshot row (typed object) back to a flat array for Sheets
function rowToArray(table: string, row: Record<string, unknown>): unknown[] {
  switch (table) {
    case "products":
      return [
        row.itemCode,
        row.hsn,
        row.category,
        row.model,
        row.description,
        row.listPrice,
        row.warranty,
        row.moq,
      ];
    case "stock":
      return [
        row.itemCode,
        row.model,
        row.description,
        row.location,
        row.openingStock,
        row.ordered,
        row.received,
        row.sold,
        row.currentStock,
        row.listPrice,
      ];
    case "transactions":
      return [
        row.txnId,
        row.date,
        row.type,
        row.itemCode,
        row.model,
        row.location,
        row.qty,
        row.unitPrice,
        row.total,
        row.party,
        row.poOrInvoice,
        row.status,
        row.costPrice ?? "",
        row.invoiceDate ?? "",
      ];
    case "lots":
      return [
        row.lotId,
        row.date,
        row.itemCode,
        row.model,
        row.location,
        row.qtyPurchased,
        row.remainingQty,
        row.unitPurchasePrice,
        row.vendor,
        row.poOrInvoice,
      ];
    default:
      return Object.values(row);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      id,
      tables = ["products", "stock", "transactions", "lots"],
      dryRun = false,
    }: {
      id: number;
      tables: string[];
      dryRun?: boolean;
    } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Snapshot id is required" },
        { status: 400 },
      );
    }

    // 1. Fetch snapshot from Supabase
    const supabase = getSupabase();
    const { data: snap, error } = await supabase
      .from("snapshots")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !snap) {
      return NextResponse.json(
        { error: "Snapshot not found" },
        { status: 404 },
      );
    }

    // 2. Build the preview of what would be written
    const preview: Record<string, { rows: number; sample: unknown[][] }> = {};
    for (const table of tables) {
      const data = snap[table] as Record<string, unknown>[];
      if (!data) continue;
      const dataRows = data.map((r) => rowToArray(table, r));
      preview[table] = {
        rows: dataRows.length,
        sample: dataRows.slice(0, 3),
      };
    }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        snapshotId: id,
        takenAt: snap.taken_at,
        label: snap.label,
        preview,
      });
    }

    // 3. Restore each requested table
    await ensureLotsSheet();
    const sheets = getSheetsClient();
    const results: Record<string, number> = {};

    for (const table of tables) {
      const sheetName = SHEET_NAMES[table];
      const header = HEADERS[table];
      const data = snap[table] as Record<string, unknown>[];
      if (!sheetName || !data) continue;

      const dataRows = data.map((r) => rowToArray(table, r));
      const allRows = [header, ...dataRows];
      const colCount = header.length;

      // Clear the sheet first (keep sheet itself, just wipe data)
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID,
        range: `'${sheetName}'!A1:Z50000`,
      });

      // Write header + data in one shot
      if (allRows.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `'${sheetName}'!A1`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: allRows },
        });
      }

      results[table] = dataRows.length;
    }

    return NextResponse.json({
      success: true,
      snapshotId: id,
      takenAt: snap.taken_at,
      restoredRows: results,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
