"use client";
import { useState, useEffect } from "react";
import ExcelJS from "exceljs";
import SnapshotPanel from "@/components/SnapshotPanel";

interface Props {
  products: any[];
  sales: any[];
  purchases: any[];
}

function toCSV(headers: string[], rows: any[][]): string {
  const escape = (v: any) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  return [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n");
}

function downloadBlob(filename: string, content: string, type = "text/csv") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadBuffer(filename: string, buffer: ArrayBuffer) {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Round to avoid floating-point artifacts like 170570.40000000000
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// Thin black border used everywhere in the template
const THIN_BORDER = {
  top: { style: "thin" as const },
  left: { style: "thin" as const },
  bottom: { style: "thin" as const },
  right: { style: "thin" as const },
};

export default function Downloads({ products, sales, purchases }: Props) {
  const today = new Date().toISOString().split("T")[0];
  const monthStart = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
  )
    .toISOString()
    .split("T")[0];
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);

  // Live stock data — pulled from /api/stock (Supabase lots, FIFO-accurate),
  // NOT from the `products` prop, which only carries catalogue fields
  // (item code, HSN, list price, MOQ) with no real stock/cost numbers.
  const [stockRows, setStockRows] = useState<any[]>([]);
  const [stockLoading, setStockLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetch("/api/stock")
      .then((r) => r.json())
      .then((d) => {
        if (d.stock) setStockRows(d.stock);
      })
      .catch(() => {})
      .finally(() => setStockLoading(false));
  }, []);

  const filterDate = (dateStr: string) => {
    const d = (dateStr ?? "").split("T")[0];
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };

  // ── Current stock → styled like the "Fluke India Retail PO" template ──
  // Yellow title banner, boxed info header (report date / totals), and a
  // fully bordered data table sorted/grouped by Category, with the
  // "Total Qty" column shaded light-green the way the sample's Qty column is.
  const dlCurrentStockXlsx = async () => {
    if (stockRows.length === 0) {
      alert(
        "Stock data hasn't loaded yet — wait a moment and try again, or hit ↻ Refresh.",
      );
      return;
    }
    setExporting(true);
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "TMCI Desk";
      workbook.created = new Date();

      const sheet = workbook.addWorksheet("Current Stock", {
        views: [{ state: "frozen", ySplit: 11 }],
      });

      // Columns: Sr, Category, Item Code, Make, Model, List Price,
      // Cost Price, Kochi, Bangalore, Total Qty, Stock Value  (11 cols)
      const colWidths = [6, 14, 12, 10, 22, 13, 13, 9, 11, 11, 15];
      sheet.columns = colWidths.map((w) => ({ width: w }));
      const lastColLetter = "K"; // 11th column

      // ── Row 1: blank spacer ─────────────────────────────────────────
      sheet.getRow(1).height = 8;

      // ── Row 2: Yellow title banner ──────────────────────────────────
      sheet.mergeCells(`A2:${lastColLetter}2`);
      const titleCell = sheet.getCell("A2");
      titleCell.value = "TMCI Current Stock Report";
      titleCell.font = { bold: true, size: 16 };
      titleCell.alignment = { horizontal: "center", vertical: "middle" };
      titleCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFFF00" },
      };
      sheet.getRow(2).height = 26;

      sheet.getRow(3).height = 8;

      // ── Rows 4-6: boxed info header (label | value pairs) ────────────
      const sortedStock = stockRows.slice().sort((a, b) => {
        const c = String(a.category ?? "").localeCompare(
          String(b.category ?? ""),
        );
        return c !== 0 ? c : String(a.model).localeCompare(String(b.model));
      });

      const totalQty = sortedStock.reduce(
        (sum, p) => sum + Number(p.currentStock ?? 0),
        0,
      );
      const totalValue = sortedStock.reduce(
        (sum, p) => sum + Number(p.stockValue ?? 0),
        0,
      );

      const infoPairs: [string, string, number][] = [
        // [label, value, rowNum]
        ["Report Date", today, 4],
        ["Total SKUs", String(sortedStock.length), 4],
        ["Total Units in Stock", String(totalQty), 5],
        ["Total Stock Value", `₹${totalValue.toLocaleString("en-IN")}`, 5],
        ["Locations", "Kochi, Bangalore", 6],
        ["Generated By", "TMCI Desk", 6],
      ];

      // Left pair: A:C label, D:F value | Right pair: G:H label, I:K value
      const infoLayout: Record<
        number,
        { labelRange: string; valueRange: string }[]
      > = {
        4: [
          { labelRange: "A4:C4", valueRange: "D4:F4" },
          { labelRange: "G4:H4", valueRange: "I4:K4" },
        ],
        5: [
          { labelRange: "A5:C5", valueRange: "D5:F5" },
          { labelRange: "G5:H5", valueRange: "I5:K5" },
        ],
        6: [
          { labelRange: "A6:C6", valueRange: "D6:F6" },
          { labelRange: "G6:H6", valueRange: "I6:K6" },
        ],
      };

      let pairIdx = 0;
      for (const rowNum of [4, 5, 6]) {
        for (const layout of infoLayout[rowNum]) {
          const [label, value] = infoPairs[pairIdx];
          pairIdx++;

          sheet.mergeCells(layout.labelRange);
          const labelCell = sheet.getCell(layout.labelRange.split(":")[0]);
          labelCell.value = label;
          labelCell.font = { bold: true };
          labelCell.border = THIN_BORDER;
          labelCell.alignment = { vertical: "middle" };
          // apply border to every cell in the merged label range
          sheet.getCell(layout.labelRange.split(":")[0]).border = THIN_BORDER;

          sheet.mergeCells(layout.valueRange);
          const valueCell = sheet.getCell(layout.valueRange.split(":")[0]);
          valueCell.value = value;
          valueCell.border = THIN_BORDER;
          valueCell.alignment = { vertical: "middle" };
        }
        sheet.getRow(rowNum).height = 20;
      }

      sheet.getRow(7).height = 8;

      // ── Row 8: table header (bold, grey fill, bordered) ──────────────
      const headerRowNum = 8;
      const headers = [
        "Sr.",
        "Category",
        "Item Code",
        "Make",
        "Model",
        "List Price (Rs)",
        "Cost Price (Rs)",
        "Kochi",
        "Bangalore",
        "Total Qty",
        "Stock Value (Rs)",
      ];
      const headerRow = sheet.getRow(headerRowNum);
      headers.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.font = { bold: true };
        cell.alignment = {
          horizontal: "center",
          vertical: "middle",
          wrapText: true,
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE8E8E8" },
        };
        cell.border = THIN_BORDER;
      });
      headerRow.height = 30;

      // ── Data rows, grouped by category, Total Qty column shaded ─────
      const currencyFmt = '"₹"#,##0.00';
      const intFmt = "#,##0";
      const qtyFill = {
        type: "pattern" as const,
        pattern: "solid" as const,
        fgColor: { argb: "FFE2F0D9" }, // light green, matches sample's Qty column
      };

      let rowNum = headerRowNum + 1;
      sortedStock.forEach((p, idx) => {
        const row = sheet.getRow(rowNum);
        const values = [
          idx + 1,
          p.category ?? "",
          p.itemCode ?? "",
          p.make ?? "",
          p.model ?? "",
          round2(p.listPrice),
          round2(p.costPrice),
          Number(p.kochiStock ?? 0),
          Number(p.bangaloreStock ?? 0),
          Number(p.currentStock ?? 0),
          round2(p.stockValue),
        ];
        values.forEach((v, i) => {
          const cell = row.getCell(i + 1);
          cell.value = v;
          cell.border = THIN_BORDER;
          if (i === 5 || i === 6 || i === 10) cell.numFmt = currencyFmt;
          if (i === 7 || i === 8 || i === 9) cell.numFmt = intFmt;
          if (i === 0 || i >= 5) cell.alignment = { horizontal: "center" };
          if (i === 9) cell.fill = qtyFill; // Total Qty column shaded
        });
        rowNum++;
      });

      // ── Totals row ────────────────────────────────────────────────
      const totalsRow = sheet.getRow(rowNum);
      sheet.mergeCells(`A${rowNum}:E${rowNum}`);
      const totalsLabel = sheet.getCell(`A${rowNum}`);
      totalsLabel.value = "TOTAL";
      totalsLabel.font = { bold: true };
      totalsLabel.alignment = { horizontal: "center", vertical: "middle" };
      totalsLabel.border = THIN_BORDER;

      const kochiSum = sortedStock.reduce(
        (s, p) => s + Number(p.kochiStock ?? 0),
        0,
      );
      const blrSum = sortedStock.reduce(
        (s, p) => s + Number(p.bangaloreStock ?? 0),
        0,
      );
      const totalsValues: [number, any, string?][] = [
        [6, "", undefined],
        [7, "", undefined],
        [8, kochiSum, intFmt],
        [9, blrSum, intFmt],
        [10, totalQty, intFmt],
        [11, round2(totalValue), currencyFmt],
      ];
      totalsValues.forEach(([colIdx, val, fmt]) => {
        const cell = totalsRow.getCell(colIdx as number);
        cell.value = val;
        cell.font = { bold: true };
        cell.border = THIN_BORDER;
        if (fmt) cell.numFmt = fmt;
        if (colIdx === 10) cell.fill = qtyFill;
      });
      totalsRow.height = 22;

      const buffer = await workbook.xlsx.writeBuffer();
      downloadBuffer(`stock_current_${today}.xlsx`, buffer);
    } catch (err) {
      console.error("[Downloads] xlsx export failed:", err);
      alert("Export failed — check the browser console for details.");
    } finally {
      setExporting(false);
    }
  };

  const dlSales = () => {
    const filtered = sales.filter((s) => filterDate(s.date));
    const rows = filtered.map((s) => [
      s.date,
      s.model,
      s.itemCode,
      s.location,
      s.qty ?? s.qtySold,
      s.unitPrice ?? s.unitSalePrice,
      s.total ?? s.totalSaleValue,
      s.costPrice ?? s.suggestedCostPrice,
      (s.unitPrice ?? s.unitSalePrice) > 0
        ? (
            (((s.unitPrice ?? s.unitSalePrice) -
              (s.costPrice ?? s.suggestedCostPrice ?? 0)) /
              (s.unitPrice ?? s.unitSalePrice)) *
            100
          ).toFixed(1) + "%"
        : "",
      s.party ?? s.customer,
    ]);
    downloadBlob(
      `sales_${from}_to_${to}.csv`,
      toCSV(
        [
          "Date",
          "Model",
          "Item Code",
          "Location",
          "Qty",
          "Unit Sale Price",
          "Total Sale Value",
          "Cost Price",
          "Margin",
          "Customer",
        ],
        rows,
      ),
    );
  };

  const dlPurchases = () => {
    const filtered = purchases.filter((p) => filterDate(p.date));
    const rows = filtered.map((p) => [
      p.date,
      p.model,
      p.itemCode,
      p.location,
      p.qty ?? p.qtyPurchased,
      p.unitPrice ?? p.unitPurchasePrice,
      p.total ?? p.totalPurchaseValue,
      p.party ?? p.vendor ?? p.supplier,
    ]);
    downloadBlob(
      `purchases_${from}_to_${to}.csv`,
      toCSV(
        [
          "Date",
          "Model",
          "Item Code",
          "Location",
          "Qty",
          "Unit Price",
          "Total Value",
          "Vendor",
        ],
        rows,
      ),
    );
  };

  const recentSales = sales
    .filter((s) => filterDate(s.date))
    .slice(-20)
    .reverse();

  const DlBtn = ({ icon, title, sub, onClick, disabled }: any) => (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--bg-input)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "border-color 0.15s",
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.borderColor = "var(--accent)";
      }}
      onMouseLeave={(e) => {
        if (!disabled) e.currentTarget.style.borderColor = "var(--border)";
      }}
    >
      <span style={{ fontSize: 20, color: "var(--accent)" }}>{icon}</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 500 }}>{title}</div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>
          {sub}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "12px 14px",
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 500,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: 10,
          }}
        >
          Select date range for reports
        </div>
        <div className="date-filter-row" style={{ marginBottom: 12 }}>
          <label>From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <label>To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className="dl-grid">
          <DlBtn
            icon="⬇"
            title="Current stock (.xlsx)"
            sub={
              exporting
                ? "Building formatted table…"
                : stockLoading
                  ? "Loading live stock…"
                  : "Formatted table, ready on open"
            }
            onClick={dlCurrentStockXlsx}
            disabled={stockLoading || exporting}
          />
          <DlBtn
            icon="⬇"
            title="Sales summary"
            sub="By date range · with margin"
            onClick={dlSales}
          />
          <DlBtn
            icon="⬇"
            title="Purchase sheet"
            sub="By date range · incl. courier"
            onClick={dlPurchases}
          />
        </div>
      </div>

      {recentSales.length > 0 && (
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "12px 14px",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 500,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: 10,
            }}
          >
            Recent sales ({from} – {to})
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Model</th>
                  <th>Location</th>
                  <th>Qty</th>
                  <th>Sale price</th>
                  <th>Cost price</th>
                  <th>Margin</th>
                  <th>Customer</th>
                </tr>
              </thead>
              <tbody>
                {recentSales.map((s, i) => {
                  const sp = s.unitPrice ?? s.unitSalePrice ?? 0;
                  const cp = s.costPrice ?? s.suggestedCostPrice ?? 0;
                  const margin = sp > 0 ? ((sp - cp) / sp) * 100 : 0;
                  return (
                    <tr key={i}>
                      <td>{(s.date + "").split("T")[0]}</td>
                      <td>{s.model}</td>
                      <td>{s.location}</td>
                      <td>{s.qty ?? s.qtySold}</td>
                      <td>₹{(sp || 0).toLocaleString("en-IN")}</td>
                      <td>₹{(cp || 0).toLocaleString("en-IN")}</td>
                      <td
                        style={{
                          color:
                            margin > 0
                              ? "var(--accent-green)"
                              : "var(--accent-red)",
                        }}
                      >
                        {margin.toFixed(1)}%
                      </td>
                      <td style={{ color: "var(--text-muted)" }}>
                        {s.party ?? s.customer}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <SnapshotPanel />
    </div>
  );
}
