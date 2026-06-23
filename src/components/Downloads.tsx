"use client";
import { useState } from "react";

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

function download(filename: string, content: string, type = "text/csv") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

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

  const filterDate = (dateStr: string) => {
    const d = (dateStr ?? "").split("T")[0];
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };

  const dlCurrentStock = () => {
    const rows = products.map((p) => [
      p.model,
      p.family,
      p.itemCode,
      p.hsn,
      p.moq,
      p.listPrice,
      p.costPrice,
      p.stockKochi,
      p.stockBlore,
      (p.stockKochi || 0) + (p.stockBlore || 0),
      ((p.stockKochi || 0) + (p.stockBlore || 0)) * (p.costPrice || 0),
    ]);
    download(
      `stock_current_${today}.csv`,
      toCSV(
        [
          "Model",
          "Family",
          "Item Code",
          "HSN",
          "MOQ",
          "List Price",
          "Cost Price",
          "Kochi",
          "Bangalore",
          "Total",
          "Stock Value",
        ],
        rows,
      ),
    );
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
    download(
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
    download(
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

  const DlBtn = ({ icon, title, sub, onClick }: any) => (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--bg-input)",
        cursor: "pointer",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.borderColor = "var(--accent)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.borderColor = "var(--border)")
      }
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
            title="Current stock"
            sub="All items, Kochi + Blore"
            onClick={dlCurrentStock}
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
