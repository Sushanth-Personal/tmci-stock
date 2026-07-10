"use client";
import { useState, useEffect } from "react";
import ExcelJS from "exceljs";

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

  // ── Current stock → real native Excel Table via ExcelJS ─────────────────
  // Unlike the community edition of SheetJS (which can't write cell styling
  // or Excel Table objects on the free tier), ExcelJS is fully open-source
  // and can create an actual Excel Table: banded rows, bold styled header,
  // built-in filter buttons, and a totals row — all baked into the file so
  // it opens already formatted. No "Format as Table" click needed in Excel.
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
        views: [{ state: "frozen", ySplit: 1 }], // freeze header row
      });

      const columns = [
        { name: "Model", width: 16 },
        { name: "Category", width: 20 },
        { name: "Item Code", width: 12 },
        { name: "Make", width: 10 },
        { name: "List Price", width: 13 },
        { name: "Cost Price", width: 13 },
        { name: "Kochi", width: 9 },
        { name: "Bangalore", width: 11 },
        { name: "Total", width: 9 },
        { name: "Stock Value", width: 15 },
      ];
      sheet.columns = columns.map((c) => ({ width: c.width }));

      const dataRows = stockRows
        .slice()
        .sort((a, b) => String(a.model).localeCompare(String(b.model)))
        .map((p) => [
          p.model ?? "",
          p.category ?? "",
          p.itemCode ?? "",
          p.make ?? "",
          round2(p.listPrice),
          round2(p.costPrice),
          Number(p.kochiStock ?? 0),
          Number(p.bangaloreStock ?? 0),
          Number(p.currentStock ?? 0),
          round2(p.stockValue),
        ]);

      // A native Excel Table — this is what gives the banded-row styling,
      // bold header, and filter dropdowns automatically on open.
      sheet.addTable({
        name: "CurrentStock",
        ref: "A1",
        headerRow: true,
        totalsRow: true,
        style: {
          theme: "TableStyleMedium9", // blue banded rows, bold header
          showRowStripes: true,
        },
        columns: [
          { name: "Model" },
          { name: "Category" },
          { name: "Item Code" },
          { name: "Make" },
          {
            name: "List Price",
            totalsRowFunction: "sum",
            filterButton: true,
          },
          {
            name: "Cost Price",
            totalsRowFunction: "sum",
            filterButton: true,
          },
          { name: "Kochi", totalsRowFunction: "sum", filterButton: true },
          {
            name: "Bangalore",
            totalsRowFunction: "sum",
            filterButton: true,
          },
          { name: "Total", totalsRowFunction: "sum", filterButton: true },
          {
            name: "Stock Value",
            totalsRowFunction: "sum",
            filterButton: true,
          },
        ],
        rows: dataRows,
      });

      // Currency + integer number formats on the actual data cells
      // (rows start at 2 because row 1 is the header)
      const currencyFmt = '"₹"#,##0.00';
      const intFmt = "#,##0";
      for (let r = 0; r < dataRows.length; r++) {
        const rowNum = r + 2;
        sheet.getCell(`E${rowNum}`).numFmt = currencyFmt; // List Price
        sheet.getCell(`F${rowNum}`).numFmt = currencyFmt; // Cost Price
        sheet.getCell(`G${rowNum}`).numFmt = intFmt; // Kochi
        sheet.getCell(`H${rowNum}`).numFmt = intFmt; // Bangalore
        sheet.getCell(`I${rowNum}`).numFmt = intFmt; // Total
        sheet.getCell(`J${rowNum}`).numFmt = currencyFmt; // Stock Value
      }
      // Totals row formats (ExcelJS appends it right after the data rows)
      const totalsRowNum = dataRows.length + 2;
      sheet.getCell(`E${totalsRowNum}`).numFmt = currencyFmt;
      sheet.getCell(`F${totalsRowNum}`).numFmt = currencyFmt;
      sheet.getCell(`G${totalsRowNum}`).numFmt = intFmt;
      sheet.getCell(`H${totalsRowNum}`).numFmt = intFmt;
      sheet.getCell(`I${totalsRowNum}`).numFmt = intFmt;
      sheet.getCell(`J${totalsRowNum}`).numFmt = currencyFmt;
      sheet.getRow(totalsRowNum).font = { bold: true };

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
    </div>
  );
}
