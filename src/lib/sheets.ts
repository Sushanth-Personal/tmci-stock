// src/lib/sheets.ts
import { google } from "googleapis";

export const SHEETS = {
  PRODUCTS: "Fluke Products",
  STOCK: "Stock",
  TRANSACTIONS: "Transactions",
  LOTS: "Fluke Lots",
  PO_TRACKER: "PO Tracker",
};

export const LOCATIONS = ["Kochi", "Bangalore"] as const;
export type Location = (typeof LOCATIONS)[number];

const HEADER_ROW = 1;
const DATA_START_ROW = 2;

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

const headerCache = new Map<string, Map<string, number>>();

async function getHeaderMap(sheetName: string): Promise<Map<string, number>> {
  const cached = headerCache.get(sheetName);
  if (cached) return cached;
  const rows = await readRange(`'${sheetName}'!1:1`);
  const header = rows[0] ?? [];
  const map = new Map<string, number>();
  header.forEach((h, i) => {
    const key = String(h ?? "")
      .trim()
      .toLowerCase();
    if (key && !map.has(key)) map.set(key, i);
  });
  headerCache.set(sheetName, map);
  return map;
}

function colIndex(map: Map<string, number>, ...candidates: string[]): number {
  for (const c of candidates) {
    const idx = map.get(c.trim().toLowerCase());
    if (idx !== undefined) return idx;
  }
  return -1;
}

// ─────────────────────────────────────────────────────────────────────────
// DOMAIN TYPES
// ─────────────────────────────────────────────────────────────────────────

// Fluke Products sheet column order (current):
//   A: Item Code  B: HSN Code  C: Category  D: Make  E: Model
//   F: Description  G: List Price (₹)  H: Warranty  I: MOQ
//
// NOTE: Item Code (col A) is blank for most rows — filter on Model (col E)
// instead, otherwise fetchProducts() returns an empty array.
export interface Product {
  row: number;
  itemCode: string;
  hsn: string;
  category: string;
  make: string;
  model: string;
  description: string;
  listPrice: number;
  warranty: string;
  moq: number;
}

export interface StockRow {
  row: number;
  itemCode: string;
  make: string;
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
  party: string;
  poOrInvoice: string;
  status: string;
  costPrice: number | null;
}

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
// SHEET MAINTENANCE
// ─────────────────────────────────────────────────────────────────────────

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
// FETCHERS
// ─────────────────────────────────────────────────────────────────────────

export async function fetchProducts(): Promise<Product[]> {
  const rows = await readRange(`'${SHEETS.PRODUCTS}'!A${HEADER_ROW}:I5000`);
  if (rows.length <= 1) return [];
  const data = rows.slice(1);
  return (
    data
      // Filter on Model (col E, index 4) — Item Code (col A) is blank for most rows
      // and would incorrectly filter out the entire catalogue.
      .filter((r) => r[4])
      .map((r, i) => ({
        row: i + DATA_START_ROW,
        itemCode: String(r[0] ?? ""), // col A: Item Code
        hsn: String(r[1] ?? ""), // col B: HSN Code
        category: String(r[2] ?? ""), // col C: Category
        make: String(r[3] ?? ""), // col D: Make
        model: String(r[4] ?? ""), // col E: Model
        description: String(r[5] ?? ""), // col F: Description
        listPrice: Number(r[6] ?? 0), // col G: List Price (₹)
        warranty: String(r[7] ?? ""), // col H: Warranty
        moq: Number(r[8] ?? 1), // col I: MOQ
      }))
  );
}



export async function fetchStock(): Promise<StockRow[]> {
  const headerMap = await getHeaderMap(SHEETS.STOCK);
  const iItemCode = colIndex(headerMap, "Item Code");
  const iMake     = colIndex(headerMap, "Make");
  const iModel    = colIndex(headerMap, "Model");
  const iDescription = colIndex(headerMap, "Description");
  const iLocation = colIndex(headerMap, "Location");
  const iOpening  = colIndex(headerMap, "Opening Stock");
  const iOrdered  = colIndex(headerMap, "Ordered (In Transit)", "Ordered");
  const iReceived = colIndex(headerMap, "Received");
  const iSold     = colIndex(headerMap, "Sold");
  const iCurrent  = colIndex(headerMap, "Current Stock");
  const iListPrice = colIndex(headerMap, "List Price (₹)", "List Price");

  const rows = await readRange(`'${SHEETS.STOCK}'!A${HEADER_ROW}:Z5000`);
  if (rows.length <= 1) return [];
  const data = rows.slice(1);

  return data
    // ── KEY FIX: filter on model, NOT itemCode ──────────────────────────────
    // itemCode is blank for most rows; model is always populated.
    .filter((r) => r[iModel] && (iLocation < 0 || r[iLocation]))
    .map((r, i) => ({
      row:          i + DATA_START_ROW,
      itemCode:     String(r[iItemCode] ?? ""),   // may be blank — that's fine
      make:         iMake >= 0 ? String(r[iMake] ?? "") : "",
      model:        String(r[iModel] ?? ""),
      description:  String(r[iDescription] ?? ""),
      location:     String(r[iLocation] ?? "") as Location,
      openingStock: Number(r[iOpening]  ?? 0),
      ordered:      Number(r[iOrdered]  ?? 0),
      received:     Number(r[iReceived] ?? 0),
      sold:         Number(r[iSold]     ?? 0),
      currentStock: Number(r[iCurrent]  ?? 0),
      listPrice:    Number(r[iListPrice] ?? 0),
    }));
}

export async function fetchTransactions(): Promise<Transaction[]> {
  const rows = await readRange(
    `'${SHEETS.TRANSACTIONS}'!A${HEADER_ROW}:M20000`,
  );
  if (rows.length <= 1) return [];
  const data = rows.slice(1);
  return data
    .filter((r) => r[0])
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
    .filter((r) => r[0])
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
// STOCK ROLLUP
// ─────────────────────────────────────────────────────────────────────────

export async function syncStockRow(
  itemCode: string,
  model: string,
  description: string,
  location: Location,
  deltaReceived: number,
  deltaSold: number,
  newCurrentStock: number,
) {
  const headerMap = await getHeaderMap(SHEETS.STOCK);
  const iReceived = colIndex(headerMap, "Received");
  const iSold = colIndex(headerMap, "Sold");
  const iCurrent = colIndex(headerMap, "Current Stock");

  const stock = await fetchStock();
  const existing = stock.find(
    (s) => s.itemCode === itemCode && s.location === location,
  );

  if (existing) {
    const newReceived = existing.received + deltaReceived;
    const newSold = existing.sold + deltaSold;
    await batchUpdate([
      {
        range: `'${SHEETS.STOCK}'!${colLetter(iReceived + 1)}${existing.row}`,
        values: [[newReceived]],
      },
      {
        range: `'${SHEETS.STOCK}'!${colLetter(iSold + 1)}${existing.row}`,
        values: [[newSold]],
      },
      {
        range: `'${SHEETS.STOCK}'!${colLetter(iCurrent + 1)}${existing.row}`,
        values: [[newCurrentStock]],
      },
    ]);
  } else {
    const width = Math.max(...Array.from(headerMap.values())) + 1;
    const row: unknown[] = new Array(width).fill("");
    const set = (name: string, value: unknown) => {
      const idx = colIndex(headerMap, name);
      if (idx >= 0) row[idx] = value;
    };
    set("Item Code", itemCode);
    set("Model", model);
    set("Description", description);
    set("Location", location);
    set("Opening Stock", 0);
    set("Ordered (In Transit)", 0);
    set("Received", deltaReceived);
    set("Sold", deltaSold);
    set("Current Stock", newCurrentStock);
    await appendRows(SHEETS.STOCK, `A:${colLetter(width)}`, [row]);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// FIFO ENGINE
// ─────────────────────────────────────────────────────────────────────────

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
      params.qty,
      params.unitPurchasePrice,
      params.vendor,
      params.poOrInvoice,
    ],
  ]);
  return lotId;
}

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
