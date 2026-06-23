// src/lib/sheets.ts
import { google } from "googleapis";

// ─────────────────────────────────────────────────────────────────────────
// SHEET NAMES — must match the actual Google Sheet exactly
// ─────────────────────────────────────────────────────────────────────────
export const SHEETS = {
  PRODUCTS: "Fluke Products",
  STOCK: "Stock",
  TRANSACTIONS: "Transactions",
  LOTS: "Fluke Lots",
  PO_TRACKER: "PO Tracker", // not used by the app yet, left untouched
};

export const LOCATIONS = ["Kochi", "Bangalore"] as const;
export type Location = (typeof LOCATIONS)[number];

// All four real sheets use header row 1, data starting row 2.
const HEADER_ROW = 1;
const DATA_START_ROW = 2;

// ─────────────────────────────────────────────────────────────────────────
// AUTH / CLIENT
// ─────────────────────────────────────────────────────────────────────────
function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !key) {
    throw new Error(
      "Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY env vars",
    );
  }
  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

export function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: "v4", auth });
}

export const SHEET_ID = process.env.GOOGLE_SHEET_ID!;

// ─────────────────────────────────────────────────────────────────────────
// GENERIC HELPERS
// ─────────────────────────────────────────────────────────────────────────
export async function readRange(range: string): Promise<string[][]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  return (res.data.values as string[][]) ?? [];
}

export async function batchUpdate(
  data: Array<{ range: string; values: unknown[][] }>,
) {
  if (!data.length) return;
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: data.map((d) => ({ range: d.range, values: d.values })),
    },
  });
}

export async function appendRows(
  sheetName: string,
  range: string,
  rows: unknown[][],
) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `'${sheetName}'!${range}`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
}

async function sheetExists(title: string): Promise<boolean> {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  return !!meta.data.sheets?.some((s) => s.properties?.title === title);
}

async function createSheetWithHeader(title: string, header: string[]) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }],
    },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `'${title}'!A1:${colLetter(header.length)}1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [header] },
  });
}

function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Ensure "Fluke Lots" exists (auto-create on first use, per the agreed design).
export async function ensureLotsSheet() {
  const exists = await sheetExists(SHEETS.LOTS);
  if (!exists) {
    await createSheetWithHeader(SHEETS.LOTS, [
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
    ]);
  }
}

// Ensure "Transactions" has the new "Cost Price (₹)" column (col M).
export async function ensureCostPriceColumn() {
  const header = await readRange(`'${SHEETS.TRANSACTIONS}'!A1:M1`);
  const row = header[0] ?? [];
  if (!row[12] || String(row[12]).trim() === "") {
    await batchUpdate([
      {
        range: `'${SHEETS.TRANSACTIONS}'!M1`,
        values: [["Cost Price (₹)"]],
      },
    ]);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// DOMAIN TYPES
// ─────────────────────────────────────────────────────────────────────────

// Fluke Products: A Item Code, B HSN, C Category, D Model, E Description,
//                  F List Price, G Warranty, H MOQ
export interface Product {
  row: number;
  itemCode: string;
  hsn: string;
  category: string;
  model: string;
  description: string;
  listPrice: number;
  warranty: string;
  moq: number;
}

// Stock: A Item Code, B Model, C Description, D Location, E Opening Stock,
//        F Ordered, G Received, H Sold, I Current Stock, J List Price
export interface StockRow {
  row: number;
  itemCode: string;
  model: string;
  description: string;
  location: Location;
  openingStock: number;
  ordered: number;
  received: number;
  sold: number;
  currentStock: number;
  listPrice: number;
}

// Transactions: A TxnID, B Date, C Type, D ItemCode, E Model, F Location,
//               G Qty, H UnitPrice, I Total, J Vendor/Customer, K PO/Invoice,
//               L Status, M CostPrice (sale rows only)
export interface Transaction {
  row: number;
  txnId: string;
  date: string;
  type: "Purchase" | "Sale" | string;
  itemCode: string;
  model: string;
  location: Location;
  qty: number;
  unitPrice: number;
  total: number;
  party: string; // Vendor (purchase) or Customer (sale)
  poOrInvoice: string;
  status: string;
  costPrice: number | null; // only meaningful for Sale rows
}

// Fluke Lots: A LotID, B Date, C ItemCode, D Model, E Location,
//             F QtyPurchased, G RemainingQty, H UnitPurchasePrice,
//             I Vendor, J PO/Invoice
export interface Lot {
  row: number;
  lotId: string;
  date: string;
  itemCode: string;
  model: string;
  location: Location;
  qtyPurchased: number;
  remainingQty: number;
  unitPurchasePrice: number;
  vendor: string;
  poOrInvoice: string;
}

// ─────────────────────────────────────────────────────────────────────────
// FETCHERS
// ─────────────────────────────────────────────────────────────────────────

export async function fetchProducts(): Promise<Product[]> {
  const rows = await readRange(`'${SHEETS.PRODUCTS}'!A${HEADER_ROW}:H5000`);
  if (rows.length <= 1) return [];
  const data = rows.slice(1);
  return data
    .filter((r) => r[0]) // Item Code present
    .map((r, i) => ({
      row: i + DATA_START_ROW,
      itemCode: String(r[0] ?? ""),
      hsn: String(r[1] ?? ""),
      category: String(r[2] ?? ""),
      model: String(r[3] ?? ""),
      description: String(r[4] ?? ""),
      listPrice: Number(r[5] ?? 0),
      warranty: String(r[6] ?? ""),
      moq: Number(r[7] ?? 1),
    }));
}

export async function fetchStock(): Promise<StockRow[]> {
  const rows = await readRange(`'${SHEETS.STOCK}'!A${HEADER_ROW}:J5000`);
  if (rows.length <= 1) return [];
  const data = rows.slice(1);
  return data
    .filter((r) => r[0] && r[3]) // Item Code + Location present
    .map((r, i) => ({
      row: i + DATA_START_ROW,
      itemCode: String(r[0] ?? ""),
      model: String(r[1] ?? ""),
      description: String(r[2] ?? ""),
      location: String(r[3] ?? "") as Location,
      openingStock: Number(r[4] ?? 0),
      ordered: Number(r[5] ?? 0),
      received: Number(r[6] ?? 0),
      sold: Number(r[7] ?? 0),
      currentStock: Number(r[8] ?? 0),
      listPrice: Number(r[9] ?? 0),
    }));
}

export async function fetchTransactions(): Promise<Transaction[]> {
  const rows = await readRange(
    `'${SHEETS.TRANSACTIONS}'!A${HEADER_ROW}:M20000`,
  );
  if (rows.length <= 1) return [];
  const data = rows.slice(1);
  return data
    .filter((r) => r[0]) // Txn ID present
    .map((r, i) => ({
      row: i + DATA_START_ROW,
      txnId: String(r[0] ?? ""),
      date: String(r[1] ?? ""),
      type: String(r[2] ?? ""),
      itemCode: String(r[3] ?? ""),
      model: String(r[4] ?? ""),
      location: String(r[5] ?? "") as Location,
      qty: Number(r[6] ?? 0),
      unitPrice: Number(r[7] ?? 0),
      total: Number(r[8] ?? 0),
      party: String(r[9] ?? ""),
      poOrInvoice: String(r[10] ?? ""),
      status: String(r[11] ?? ""),
      costPrice: r[12] !== undefined && r[12] !== "" ? Number(r[12]) : null,
    }));
}

export async function fetchLots(): Promise<Lot[]> {
  await ensureLotsSheet();
  const rows = await readRange(`'${SHEETS.LOTS}'!A${HEADER_ROW}:J20000`);
  if (rows.length <= 1) return [];
  const data = rows.slice(1);
  return data
    .filter((r) => r[0]) // Lot ID present
    .map((r, i) => ({
      row: i + DATA_START_ROW,
      lotId: String(r[0] ?? ""),
      date: String(r[1] ?? ""),
      itemCode: String(r[2] ?? ""),
      model: String(r[3] ?? ""),
      location: String(r[4] ?? "") as Location,
      qtyPurchased: Number(r[5] ?? 0),
      remainingQty: Number(r[6] ?? 0),
      unitPurchasePrice: Number(r[7] ?? 0),
      vendor: String(r[8] ?? ""),
      poOrInvoice: String(r[9] ?? ""),
    }));
}

// ─────────────────────────────────────────────────────────────────────────
// ID GENERATION
// ─────────────────────────────────────────────────────────────────────────

export async function getNextTxnId(): Promise<string> {
  const rows = await readRange(`'${SHEETS.TRANSACTIONS}'!A2:A20000`);
  const nums = rows
    .map((r) => {
      const m = String(r[0] ?? "").match(/TXN-(\d+)/);
      return m ? Number(m[1]) : NaN;
    })
    .filter((n) => !isNaN(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `TXN-${String(next).padStart(4, "0")}`;
}

export async function getNextLotId(): Promise<string> {
  const rows = await readRange(`'${SHEETS.LOTS}'!A2:A20000`);
  const nums = rows
    .map((r) => {
      const m = String(r[0] ?? "").match(/LOT-(\d+)/);
      return m ? Number(m[1]) : NaN;
    })
    .filter((n) => !isNaN(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `LOT-${String(next).padStart(4, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────
// STOCK ROLLUP (Stock sheet's Current Stock is derived from open lots)
// ─────────────────────────────────────────────────────────────────────────

// Find (or create) the Stock row for a given model+location and write
// currentStock / received / sold back to it.
export async function syncStockRow(
  itemCode: string,
  model: string,
  description: string,
  location: Location,
  deltaReceived: number,
  deltaSold: number,
  newCurrentStock: number,
) {
  const stock = await fetchStock();
  const existing = stock.find(
    (s) => s.itemCode === itemCode && s.location === location,
  );

  if (existing) {
    const newReceived = existing.received + deltaReceived;
    const newSold = existing.sold + deltaSold;
    // Column map: D=Location, E=Opening, F=Ordered, G=Received, H=Sold, I=Current Stock.
    // Ordered (F) is intentionally left untouched here — it tracks in-transit
    // POs, which this app doesn't manage yet.
    await batchUpdate([
      { range: `'${SHEETS.STOCK}'!G${existing.row}`, values: [[newReceived]] },
      { range: `'${SHEETS.STOCK}'!H${existing.row}`, values: [[newSold]] },
      {
        range: `'${SHEETS.STOCK}'!I${existing.row}`,
        values: [[newCurrentStock]],
      },
    ]);
  } else {
    // First time this model+location combination appears — append a new row.
    await appendRows(SHEETS.STOCK, "A:J", [
      [
        itemCode,
        model,
        description,
        location,
        0, // Opening Stock
        0, // Ordered (in transit) — not tracked here
        deltaReceived, // Received
        deltaSold, // Sold
        newCurrentStock, // Current Stock
        "", // List Price left blank; Products sheet is the source for pricing
      ],
    ]);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// FIFO ENGINE
// ─────────────────────────────────────────────────────────────────────────

// Create a new lot from a purchase. Returns the created lot's id.
export async function createLot(params: {
  date: string;
  itemCode: string;
  model: string;
  location: Location;
  qty: number;
  unitPurchasePrice: number;
  vendor: string;
  poOrInvoice: string;
}): Promise<string> {
  await ensureLotsSheet();
  const lotId = await getNextLotId();
  await appendRows(SHEETS.LOTS, "A:J", [
    [
      lotId,
      params.date,
      params.itemCode,
      params.model,
      params.location,
      params.qty,
      params.qty, // remaining = full qty initially
      params.unitPurchasePrice,
      params.vendor,
      params.poOrInvoice,
    ],
  ]);
  return lotId;
}

// Consume `qty` units FIFO (oldest lot first) for a given model+location.
// Returns the weighted-average cost price for the consumed units, plus
// the per-lot consumption breakdown (for traceability if ever needed).
// Throws if there isn't enough stock across open lots.
export async function consumeFifo(
  itemCode: string,
  location: Location,
  qty: number,
): Promise<{
  weightedCost: number;
  breakdown: Array<{ lotId: string; qtyTaken: number; unitPrice: number }>;
}> {
  const lots = await fetchLots();
  const openLots = lots
    .filter(
      (l) =>
        l.itemCode === itemCode &&
        l.location === location &&
        l.remainingQty > 0,
    )
    // FIFO = oldest date first; fall back to lot id order if dates tie/missing
    .sort((a, b) => {
      const da = new Date(a.date).getTime();
      const db = new Date(b.date).getTime();
      if (!isNaN(da) && !isNaN(db) && da !== db) return da - db;
      return a.lotId.localeCompare(b.lotId);
    });

  const totalAvailable = openLots.reduce((s, l) => s + l.remainingQty, 0);
  if (totalAvailable < qty) {
    throw new Error(
      `Insufficient stock to sell. Available across lots: ${totalAvailable}, requested: ${qty}`,
    );
  }

  let remainingToConsume = qty;
  let totalCost = 0;
  const breakdown: Array<{
    lotId: string;
    qtyTaken: number;
    unitPrice: number;
  }> = [];
  const updates: Array<{ range: string; values: unknown[][] }> = [];

  for (const lot of openLots) {
    if (remainingToConsume <= 0) break;
    const take = Math.min(lot.remainingQty, remainingToConsume);
    const newRemaining = lot.remainingQty - take;

    updates.push({
      range: `'${SHEETS.LOTS}'!G${lot.row}`,
      values: [[newRemaining]],
    });

    totalCost += take * lot.unitPurchasePrice;
    breakdown.push({
      lotId: lot.lotId,
      qtyTaken: take,
      unitPrice: lot.unitPurchasePrice,
    });
    remainingToConsume -= take;
  }

  await batchUpdate(updates);

  const weightedCost = totalCost / qty;
  return { weightedCost, breakdown };
}

// Restore qty back into lots (used when reversing/undoing a sale — not
// currently exposed via an API route, but kept here for completeness).
export async function restoreFifo(
  breakdown: Array<{ lotId: string; qtyTaken: number }>,
) {
  const lots = await fetchLots();
  const updates: Array<{ range: string; values: unknown[][] }> = [];
  for (const b of breakdown) {
    const lot = lots.find((l) => l.lotId === b.lotId);
    if (!lot) continue;
    updates.push({
      range: `'${SHEETS.LOTS}'!G${lot.row}`,
      values: [[lot.remainingQty + b.qtyTaken]],
    });
  }
  await batchUpdate(updates);
}
