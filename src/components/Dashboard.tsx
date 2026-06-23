"use client";
import { useMemo, useState, useEffect } from "react";

function fmt(n: number) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

interface Props {
  products: any[];
  sales: any[];
  purchases: any[];
}

export default function Dashboard({ products, sales, purchases }: Props) {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .split("T")[0];
  const todayStr = today.toISOString().split("T")[0];

  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayStr);
  const [location, setLocation] = useState("both");

  const [stock, setStock] = useState<any[]>([]);
  const [stockLoading, setStockLoading] = useState(true);

  useEffect(() => {
    fetch("/api/stock")
      .then((r) => r.json())
      .then((d) => {
        if (d.stock) setStock(d.stock);
      })
      .finally(() => setStockLoading(false));
  }, []);

  const stockTotals = useMemo(() => {
    const kochiItems = stock
      .filter((s) => s.location === "Kochi")
      .reduce((sum, s) => sum + (s.currentStock || 0), 0);
    const bloreItems = stock
      .filter((s) => s.location === "Bangalore")
      .reduce((sum, s) => sum + (s.currentStock || 0), 0);
    const kochiValue = stock
      .filter((s) => s.location === "Kochi")
      .reduce((sum, s) => sum + (s.stockValue || 0), 0);
    const bloreValue = stock
      .filter((s) => s.location === "Bangalore")
      .reduce((sum, s) => sum + (s.stockValue || 0), 0);
    return { kochiItems, bloreItems, kochiValue, bloreValue };
  }, [stock]);

  const lowStockRows = useMemo(() => {
    const map = new Map<string, any>();
    for (const s of stock) {
      const key = s.itemCode;
      if (!map.has(key)) {
        map.set(key, {
          itemCode: s.itemCode,
          model: s.model,
          category: s.category,
          stockKochi: 0,
          stockBlore: 0,
          costPrice: s.costPrice || 0,
        });
      }
      const row = map.get(key)!;
      if (s.location === "Kochi") row.stockKochi = s.currentStock || 0;
      if (s.location === "Bangalore") row.stockBlore = s.currentStock || 0;
      if (s.costPrice > 0) row.costPrice = s.costPrice;
    }
    return Array.from(map.values()).filter(
      (r) => r.stockKochi + r.stockBlore <= 1,
    );
  }, [stock]);

  const stats = useMemo(() => {
    const filteredSales = sales.filter((s) => {
      const d = s.date?.split("T")[0] ?? s.date;
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (location !== "both" && s.location !== location) return false;
      return true;
    });
    const filteredPurchases = purchases.filter((p) => {
      const d = p.date?.split("T")[0] ?? p.date;
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (location !== "both" && p.location !== location) return false;
      return true;
    });
    const salesVal = filteredSales.reduce((s, x) => s + (x.total || 0), 0);
    const salesCost = filteredSales.reduce(
      (s, x) => s + (x.qty || 0) * (x.costPrice || 0),
      0,
    );
    const margin = salesVal > 0 ? ((salesVal - salesCost) / salesVal) * 100 : 0;
    const purchasesVal = filteredPurchases.reduce(
      (s, x) => s + (x.total || 0),
      0,
    );
    const salesByModel: Record<string, { units: number; value: number }> = {};
    for (const s of filteredSales) {
      if (!salesByModel[s.model])
        salesByModel[s.model] = { units: 0, value: 0 };
      salesByModel[s.model].units += s.qty || 0;
      salesByModel[s.model].value += s.total || 0;
    }
    const topMovers = Object.entries(salesByModel)
      .sort((a, b) => b[1].value - a[1].value)
      .slice(0, 5)
      .map(([model, d]) => ({ model, ...d }));
    return { salesVal, margin, purchasesVal, topMovers };
  }, [sales, purchases, from, to, location]);

  const Card = ({ children, style }: any) => (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "12px 14px",
        ...style,
      }}
    >
      {children}
    </div>
  );

  const SectionLabel = ({ children }: any) => (
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
      {children}
    </div>
  );

  const Metric = ({ label, value, sub, color }: any) => (
    <div
      style={{
        background: "var(--bg-input)",
        borderRadius: 8,
        padding: "10px 12px",
      }}
    >
      <div
        style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 3 }}
      >
        {label}
      </div>
      <div
        style={{ fontSize: 20, fontWeight: 600, color: color || "var(--text)" }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Period filter */}
      <Card>
        <SectionLabel>Period & filters</SectionLabel>
        <div className="date-filter-row">
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
          <select
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            style={{ minWidth: 140 }}
          >
            <option value="both">Both locations</option>
            <option value="Kochi">Kochi only</option>
            <option value="Bangalore">Bangalore only</option>
          </select>
        </div>
        <div className="metric-grid">
          <Metric
            label="Stock value (ex-GST)"
            value={
              stockLoading
                ? "…"
                : fmt(stockTotals.kochiValue + stockTotals.bloreValue)
            }
            sub="current on-hand (FIFO)"
            color="var(--accent)"
          />
          <Metric
            label="Sales (period)"
            value={fmt(stats.salesVal)}
            sub="total sale value"
            color="var(--accent-green)"
          />
          <Metric
            label="Purchases (period)"
            value={fmt(stats.purchasesVal)}
            sub="incl. courier charges"
          />
          <Metric
            label="Gross margin"
            value={`${stats.margin.toFixed(1)}%`}
            sub="sales − cost / sales"
            color="var(--accent-amber)"
          />
        </div>
      </Card>

      <div className="loc-grid">
        <Card>
          <SectionLabel>Stock by location</SectionLabel>
          {stockLoading ? (
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
              Loading…
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Location</th>
                    <th>Items</th>
                    <th>Value (ex-GST)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Kochi</td>
                    <td>{stockTotals.kochiItems}</td>
                    <td>{fmt(stockTotals.kochiValue)}</td>
                  </tr>
                  <tr>
                    <td>Bangalore</td>
                    <td>{stockTotals.bloreItems}</td>
                    <td>{fmt(stockTotals.bloreValue)}</td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: 600 }}>Total</td>
                    <td style={{ fontWeight: 600 }}>
                      {stockTotals.kochiItems + stockTotals.bloreItems}
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {fmt(stockTotals.kochiValue + stockTotals.bloreValue)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card>
          <SectionLabel>Top movers (period)</SectionLabel>
          {stats.topMovers.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
              No sales in this period.
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Units sold</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.topMovers.map((m) => (
                    <tr key={m.model}>
                      <td>{m.model}</td>
                      <td>{m.units}</td>
                      <td>{fmt(m.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {!stockLoading && lowStockRows.length > 0 && (
        <Card>
          <SectionLabel>⚠ Low / Out of stock</SectionLabel>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Category</th>
                  <th>Kochi</th>
                  <th>Bangalore</th>
                  <th>Total</th>
                  <th>Cost Price</th>
                </tr>
              </thead>
              <tbody>
                {lowStockRows.map((p) => (
                  <tr key={p.itemCode}>
                    <td>{p.model}</td>
                    <td>{p.category}</td>
                    <td>{p.stockKochi}</td>
                    <td>{p.stockBlore}</td>
                    <td
                      style={{
                        fontWeight: 500,
                        color:
                          p.stockKochi + p.stockBlore === 0
                            ? "var(--accent-red)"
                            : "var(--accent-amber)",
                      }}
                    >
                      {p.stockKochi + p.stockBlore}
                    </td>
                    <td>₹{(p.costPrice || 0).toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
