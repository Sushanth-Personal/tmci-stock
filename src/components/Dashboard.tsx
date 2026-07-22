"use client";
// src/components/Dashboard.tsx
//
// Tabbed dashboard, structured like PepperCloud CRM's home dashboard: one
// header with a tab strip (Sales / Leads / Inventory / Expenses /
// Activity), each tab showing its own focused set of KPI cards and
// charts instead of one long continuous scroll. "Tickets" and "Messages"
// from the reference layout are dropped — this app has no ticketing or
// messaging feature, so those tabs would be empty. "Leads" is kept as a
// placeholder tab (CRM Leads/Opportunities aren't wired to real data
// yet — see src/app/page.tsx's ComingSoon screens for those).
//
// Deliberately DOES NOT show a low/out-of-stock item list — that's a
// full table better suited to its own screen (Stock & Serials / View
// Stock already cover it), not dashboard real estate.

import { useMemo, useState, useEffect } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Icon } from "@/components/icons";
import ReorderExplainModal from "@/components/ReorderExplainModal";

function fmt(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
function fmtRs(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

// Normalize model names: "303.0" → "303", "15B+" stays "15B+"
function normalizeModel(m: any): string {
  const s = String(m ?? "").trim();
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

// Robust date parser — handles ISO strings AND Google Sheets serial numbers
const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);
function parseDate(raw: string | number | undefined | null): Date | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") {
    if (raw > 20000 && raw < 80000)
      return new Date(SHEETS_EPOCH_MS + raw * 86400000);
  } else {
    const s = String(raw).trim();
    if (/^\d{4,5}$/.test(s)) {
      const n = Number(s);
      if (n > 20000 && n < 80000)
        return new Date(SHEETS_EPOCH_MS + n * 86400000);
    }
    const iso = new Date(s.split("T")[0]);
    if (!isNaN(iso.getTime())) return iso;
    const fallback = new Date(s);
    if (!isNaN(fallback.getTime())) return fallback;
  }
  return null;
}
function toISO(d: Date) {
  return d.toISOString().split("T")[0];
}
function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", {
    month: "short",
    year: "2-digit",
  });
}

// Build cost lookup from purchase history.
function buildCostLookup(purchases: any[]) {
  const byModel = new Map<string, Array<{ date: Date; price: number }>>();
  for (const p of purchases) {
    const price = p.unitPrice ?? p.unitPurchasePrice ?? 0;
    const d = parseDate(p.date);
    if (!p.model || !price || price <= 0 || !d) continue;
    const model = normalizeModel(p.model);
    if (!byModel.has(model)) byModel.set(model, []);
    byModel.get(model)!.push({ date: d, price });
  }
  for (const entries of byModel.values())
    entries.sort((a, b) => a.date.getTime() - b.date.getTime());
  return byModel;
}

function lookupCost(
  costLookup: Map<string, Array<{ date: Date; price: number }>>,
  model: string,
  saleDate: Date | null,
): number {
  const key = normalizeModel(model);
  const entries = costLookup.get(key);
  if (!entries || entries.length === 0) return 0;
  if (!saleDate) return entries[entries.length - 1].price;
  let best: number | null = null;
  for (const e of entries) {
    if (e.date.getTime() <= saleDate.getTime()) best = e.price;
    else break;
  }
  return best ?? entries[0].price;
}

const EXPENSE_CHART_COLORS = [
  "var(--accent)",
  "var(--accent-green)",
  "var(--accent-amber)",
  "var(--accent-red)",
  "#a855f7",
  "#06b6d4",
  "#eab308",
  "#ec4899",
  "#14b8a6",
  "#6366f1",
];

type TabKey = "sales" | "leads" | "inventory" | "expenses" | "activity";
const TABS: { key: TabKey; label: string }[] = [
  { key: "sales", label: "Sales" },
  { key: "leads", label: "Leads" },
  { key: "inventory", label: "Inventory" },
  { key: "expenses", label: "Expenses" },
  { key: "activity", label: "Activity" },
];

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

  const [activeTab, setActiveTab] = useState<TabKey>("sales");
  const [explainingItem, setExplainingItem] = useState<any | null>(null);
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayStr);
  const [location, setLocation] = useState("both");

  const [stock, setStock] = useState<any[]>([]);
  const [stockLoading, setStockLoading] = useState(true);
  const [stockError, setStockError] = useState("");

  const [expenses, setExpenses] = useState<any[]>([]);
  const [expensesLoading, setExpensesLoading] = useState(true);
  const [expensesError, setExpensesError] = useState("");

  const [invoices, setInvoices] = useState<any[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [invoicesError, setInvoicesError] = useState("");

  const loadStock = () => {
    setStockLoading(true);
    setStockError("");
    fetch("/api/stock")
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((d) => setStock(d.stock ?? []))
      .catch((e) => setStockError(e?.message ?? "Failed to load stock"))
      .finally(() => setStockLoading(false));
  };

  const loadExpenses = () => {
    setExpensesLoading(true);
    setExpensesError("");
    Promise.all([
      fetch("/api/expenses?type=company").then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || `HTTP ${r.status}`);
        }
        return r.json();
      }),
      fetch("/api/expenses?type=project").then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || `HTTP ${r.status}`);
        }
        return r.json();
      }),
    ])
      .then(([c, p]) => {
        setExpenses([...(c.expenses ?? []), ...(p.expenses ?? [])]);
      })
      .catch((e) => setExpensesError(e?.message ?? "Failed to load expenses"))
      .finally(() => setExpensesLoading(false));
  };

  const loadInvoices = () => {
    setInvoicesLoading(true);
    setInvoicesError("");
    fetch("/api/invoices?limit=300")
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((d) => setInvoices(d.invoices ?? []))
      .catch((e) => setInvoicesError(e?.message ?? "Failed to load invoices"))
      .finally(() => setInvoicesLoading(false));
  };

  useEffect(() => {
    loadStock();
  }, []);

  useEffect(() => {
    loadExpenses();
  }, []);

  useEffect(() => {
    loadInvoices();
  }, []);

  const stockTotals = useMemo(() => {
    const kochiItems = stock.reduce((sum, s) => sum + (s.kochiStock || 0), 0);
    const bloreItems = stock.reduce(
      (sum, s) => sum + (s.bangaloreStock || 0),
      0,
    );
    const kochiValue = stock.reduce((sum, s) => sum + (s.kochiValue || 0), 0);
    const bloreValue = stock.reduce(
      (sum, s) => sum + (s.bangaloreValue || 0),
      0,
    );
    return { kochiItems, bloreItems, kochiValue, bloreValue };
  }, [stock]);

  const costLookup = useMemo(() => buildCostLookup(purchases), [purchases]);

  // ── "What to order" — reorder recommendations ──────────────────────────
  // No ML needed: this is a standard demand-classification problem
  // (ABC/XYZ analysis + reorder-point theory), solved entirely with a
  // formula. The key insight the score has to capture: a model with one
  // big one-time bulk sale long ago should NOT score the same as a model
  // that sells the same total quantity spread evenly across many months.
  // That distinction falls straight out of the coefficient of variation
  // (CV = stddev ÷ mean of monthly demand) — a single spike among mostly-
  // zero months produces a HIGH CV (unpredictable/lumpy demand), while
  // steady monthly sales produce a LOW CV (predictable/regular demand).
  // Same idea reinforced by "regularity" = fraction of months in the
  // window that actually had a sale.
  const REORDER_WINDOW_MONTHS = 6;
  const LEAD_TIME_DAYS = 14; // assumed vendor lead time; adjust to taste

  const reorderList = useMemo(() => {
    if (stock.length === 0) return [];

    const windowStart = new Date();
    windowStart.setMonth(windowStart.getMonth() - REORDER_WINDOW_MONTHS);
    const windowStartKey = monthKey(windowStart);

    // month keys covered by the window, oldest→newest, so months with NO
    // sales still count as a zero data point in the stddev/mean calc —
    // that's what lets a single-month spike register as high-variance.
    const windowMonthKeys: string[] = [];
    for (let i = REORDER_WINDOW_MONTHS - 1; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      windowMonthKeys.push(monthKey(d));
    }

    const byModel = new Map<
      string,
      {
        monthlyQty: Map<string, number>;
        lastSaleDate: Date | null;
        txnCount: number;
      }
    >();

    for (const s of sales) {
      const d = parseDate(s.date);
      if (!d) continue;
      const key = monthKey(d);
      if (key < windowStartKey) continue;
      const model = normalizeModel(s.model);
      if (!byModel.has(model)) {
        byModel.set(model, {
          monthlyQty: new Map(),
          lastSaleDate: null,
          txnCount: 0,
        });
      }
      const entry = byModel.get(model)!;
      entry.monthlyQty.set(
        key,
        (entry.monthlyQty.get(key) ?? 0) + (s.qty || 0),
      );
      entry.txnCount += 1;
      if (!entry.lastSaleDate || d > entry.lastSaleDate) entry.lastSaleDate = d;
    }

    type Tier = "URGENT" | "SOON" | "WATCH" | "OK";
    const results: Array<{
      model: string;
      currentStock: number;
      velocityPerDay: number;
      daysOfCover: number | null;
      regularity: number;
      monthsActive: number;
      cv: number;
      daysSinceLastSale: number | null;
      txnCount: number;
      suggestedQty: number;
      score: number;
      tier: Tier;
      reason: string;
    }> = [];

    // Base the list on EVERY item in the catalogue's stock, not just ones
    // that happened to sell in the window — items with zero recent sales
    // still need to show up (as "OK" / no-recent-demand), so nothing is
    // silently hidden.
    for (const stockRow of stock) {
      const model = normalizeModel(stockRow.model);
      const entry = byModel.get(model);
      const currentStock = stockRow.currentStock ?? 0;

      const monthlyValues = windowMonthKeys.map(
        (k) => entry?.monthlyQty.get(k) ?? 0,
      );
      const totalQty = monthlyValues.reduce((s, v) => s + v, 0);

      const mean = totalQty / REORDER_WINDOW_MONTHS;
      const variance =
        monthlyValues.reduce((s, v) => s + (v - mean) ** 2, 0) /
        REORDER_WINDOW_MONTHS;
      const stddev = Math.sqrt(variance);
      const cv = mean > 0 ? stddev / mean : 0;

      const monthsActive = monthlyValues.filter((v) => v > 0).length;
      const regularity = monthsActive / REORDER_WINDOW_MONTHS;

      const velocityPerDay = totalQty / (REORDER_WINDOW_MONTHS * 30);
      const daysOfCover =
        velocityPerDay > 0 ? currentStock / velocityPerDay : null;

      const daysSinceLastSale = entry?.lastSaleDate
        ? Math.floor(
            (today.getTime() - entry.lastSaleDate.getTime()) / 86400000,
          )
        : null;

      const regularityFactor = regularity;
      const varietyFactor = 1 / (1 + cv);
      const recencyFactor =
        daysSinceLastSale === null ? 0 : Math.exp(-daysSinceLastSale / 60);
      const stockoutRisk =
        daysOfCover === null
          ? 0
          : Math.max(0, Math.min(1, 1 - daysOfCover / (LEAD_TIME_DAYS * 2)));

      const score =
        100 *
        stockoutRisk *
        (0.4 + 0.6 * regularityFactor) *
        (0.4 + 0.6 * varietyFactor) *
        (0.4 + 0.6 * recencyFactor);

      // Suggested qty: cover lead time + 50% buffer, minus what's on hand.
      // Floor at 1 (not 0) whenever the item is fully out of stock AND has
      // sold at least once in the window — "you're at zero and it does
      // sell" should never suggest ordering nothing.
      let suggestedQty = Math.max(
        0,
        Math.round(velocityPerDay * LEAD_TIME_DAYS * 1.5 - currentStock),
      );
      if (suggestedQty === 0 && currentStock === 0 && totalQty > 0)
        suggestedQty = 1;

      let tier: Tier = "OK";
      if (score >= 60) tier = "URGENT";
      else if (score >= 30) tier = "SOON";
      else if (score >= 5) tier = "WATCH";

      // Plain-English reason, built from the same factors as the score —
      // this is what shows when the row is tapped/expanded.
      const parts: string[] = [];
      if (totalQty === 0) {
        parts.push(
          `No sales recorded for this item in the last ${REORDER_WINDOW_MONTHS} months`,
        );
        if (currentStock > 0)
          parts.push(`— ${currentStock} unit(s) sitting unsold.`);
        else parts.push(`, and none in stock either.`);
      } else {
        parts.push(
          `Sold in ${monthsActive} of the last ${REORDER_WINDOW_MONTHS} months (${Math.round(regularity * 100)}% regularity)`,
        );
        parts.push(
          cv < 0.5
            ? "with a fairly steady month-to-month pattern"
            : cv < 1
              ? "with somewhat uneven month-to-month demand"
              : "in a lumpy/irregular pattern (likely including a one-off bulk order rather than repeat demand)",
        );
        parts.push(`— averaging ~${velocityPerDay.toFixed(2)} units/day.`);
        if (daysOfCover !== null) {
          parts.push(
            currentStock === 0
              ? "Currently out of stock."
              : `Current stock (${currentStock}) covers about ${Math.round(daysOfCover)} day(s) at that pace.`,
          );
        }
        if (daysSinceLastSale !== null) {
          parts.push(`Last sold ${daysSinceLastSale} day(s) ago.`);
        }
      }
      if (tier === "URGENT") {
        parts.push(
          "Flagged URGENT: at this pace, stock will likely run out before a new order could arrive.",
        );
      } else if (tier === "SOON") {
        parts.push(
          "Flagged SOON: getting low relative to how it typically sells — worth ordering in the next batch.",
        );
      } else if (tier === "WATCH") {
        parts.push("Flagged WATCH: not urgent yet, but keep an eye on it.");
      } else {
        parts.push("No action needed right now.");
      }

      results.push({
        model: stockRow.model,
        currentStock,
        velocityPerDay,
        daysOfCover,
        regularity,
        monthsActive,
        cv,
        daysSinceLastSale,
        txnCount: entry?.txnCount ?? 0,
        suggestedQty,
        score,
        tier,
        reason: parts.join(" "),
      });
    }

    return results.sort((a, b) => b.score - a.score);
  }, [sales, stock, today]);

  const inRange = (raw: any, f = from, t = to) => {
    const d = parseDate(raw);
    if (!d) return false;
    const iso = toISO(d);
    if (f && iso < f) return false;
    if (t && iso > t) return false;
    return true;
  };

  const stats = useMemo(() => {
    const filteredSales = sales.filter(
      (s) =>
        inRange(s.date) && (location === "both" || s.location === location),
    );
    const filteredPurchases = purchases.filter(
      (p) =>
        inRange(p.date) && (location === "both" || p.location === location),
    );
    const filteredExpenses = expenses.filter((e) => inRange(e.date));

    const salesVal = filteredSales.reduce((s, x) => s + (x.total || 0), 0);

    const salesCost = filteredSales.reduce((s, x) => {
      const fifo = x.costPrice ?? 0;
      const cost =
        fifo > 0 ? fifo : lookupCost(costLookup, x.model, parseDate(x.date));
      return s + (x.qty || 0) * cost;
    }, 0);

    const margin = salesVal > 0 ? ((salesVal - salesCost) / salesVal) * 100 : 0;
    const marginAbs = salesVal - salesCost;
    const purchasesVal = filteredPurchases.reduce(
      (s, x) => s + (x.total || 0),
      0,
    );
    const expensesVal = filteredExpenses.reduce(
      (s, x) => s + (Number(x.amount) || 0),
      0,
    );
    const companyExpensesVal = filteredExpenses
      .filter((e) => e.expense_type === "company")
      .reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const projectExpensesVal = filteredExpenses
      .filter((e) => e.expense_type === "project")
      .reduce((s, x) => s + (Number(x.amount) || 0), 0);

    const netProfit = marginAbs - expensesVal;
    const netProfitPct = salesVal > 0 ? (netProfit / salesVal) * 100 : 0;

    const salesByModel: Record<string, { units: number; value: number }> = {};
    for (const s of filteredSales) {
      if (!salesByModel[s.model])
        salesByModel[s.model] = { units: 0, value: 0 };
      salesByModel[s.model].units += s.qty || 0;
      salesByModel[s.model].value += s.total || 0;
    }
    const topMovers = Object.entries(salesByModel)
      .sort((a, b) => b[1].value - a[1].value)
      .slice(0, 6)
      .map(([model, d]) => ({ model, ...d }));

    const expenseByGroup = new Map<string, number>();
    for (const e of filteredExpenses) {
      const key = e.category_group || "Other";
      expenseByGroup.set(
        key,
        (expenseByGroup.get(key) ?? 0) + Number(e.amount),
      );
    }
    const expenseGroups = Array.from(expenseByGroup.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }));

    const recentExpenses = [...filteredExpenses]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 6);

    return {
      salesVal,
      margin,
      marginAbs,
      purchasesVal,
      expensesVal,
      companyExpensesVal,
      projectExpensesVal,
      netProfit,
      netProfitPct,
      topMovers,
      expenseGroups,
      recentExpenses,
    };
  }, [sales, purchases, expenses, from, to, location, costLookup]);

  const trend = useMemo(() => {
    const months: string[] = [];
    const base = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      months.push(monthKey(d));
    }
    const rows = months.map((key) => {
      const income = sales.reduce((s, x) => {
        const d = parseDate(x.date);
        return d && monthKey(d) === key ? s + (x.total || 0) : s;
      }, 0);
      const purchaseCost = purchases.reduce((s, x) => {
        const d = parseDate(x.date);
        return d && monthKey(d) === key ? s + (x.total || 0) : s;
      }, 0);
      const expenseCost = expenses.reduce((s, x) => {
        const d = parseDate(x.date);
        return d && monthKey(d) === key ? s + (Number(x.amount) || 0) : s;
      }, 0);
      return {
        month: monthLabel(key),
        Income: Math.round(income),
        Expense: Math.round(purchaseCost + expenseCost),
      };
    });
    return rows;
  }, [sales, purchases, expenses]);

  const overdueInvoices = useMemo(() => {
    return invoices
      .filter(
        (inv) =>
          inv.status !== "cancelled" && inv.due_date && inv.due_date < todayStr,
      )
      .map((inv) => {
        const daysOverdue = Math.floor(
          (today.getTime() - new Date(inv.due_date).getTime()) / 86400000,
        );
        return { ...inv, daysOverdue };
      })
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
      .slice(0, 6);
  }, [invoices, todayStr]);

  const pendingDispatch = useMemo(() => {
    const rows = invoices.filter((inv) => inv.status === "pending_dispatch");
    return {
      count: rows.length,
      value: rows.reduce((s, r) => s + (r.total || 0), 0),
    };
  }, [invoices]);

  const recentActivity = useMemo(() => {
    const items: Array<{
      type: "sale" | "expense" | "purchase";
      date: string;
      label: string;
      sub: string;
      amount: number;
    }> = [];
    for (const s of sales.slice(0, 60)) {
      items.push({
        type: "sale",
        date: String(s.date ?? "").split("T")[0],
        label: `Sold ${s.qty ?? ""}× ${s.model}`,
        sub: s.party ?? s.customer ?? "",
        amount: s.total || 0,
      });
    }
    for (const p of purchases.slice(0, 60)) {
      items.push({
        type: "purchase",
        date: String(p.date ?? "").split("T")[0],
        label: `Purchased ${p.qty ?? ""}× ${p.model}`,
        sub: p.party ?? p.vendor ?? "",
        amount: p.total || 0,
      });
    }
    for (const e of expenses.slice(0, 60)) {
      items.push({
        type: "expense",
        date: String(e.date ?? "").split("T")[0],
        label: e.category,
        sub: e.vendor || e.category_group,
        amount: Number(e.amount) || 0,
      });
    }
    return items
      .filter((i) => i.date)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 20);
  }, [sales, purchases, expenses]);

  const card: React.CSSProperties = {
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: 14,
    padding: "14px 16px",
  };
  const sectionLabel: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 500,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 10,
  };

  const Metric = ({ label, value, sub, color }: any) => (
    <div
      style={{
        background: "var(--bg-input)",
        borderRadius: 10,
        padding: "12px 14px",
        minWidth: 0,
      }}
    >
      <div
        style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 5 }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: color || "var(--text)",
          wordBreak: "break-word",
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }}>
          {sub}
        </div>
      )}
    </div>
  );

  const chartTooltipStyle = {
    background: "var(--bg-input)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 12,
  };

  const showDateFilters = activeTab === "sales" || activeTab === "expenses";

  const ErrorBanner = ({
    message,
    onRetry,
  }: {
    message: string;
    onRetry: () => void;
  }) => (
    <div
      style={{
        padding: "8px 12px",
        borderRadius: 6,
        background: "var(--accent-red-bg-subtle)",
        border: "1px solid var(--accent-red-border)",
        fontSize: 11,
        color: "var(--accent-red)",
        marginBottom: 10,
      }}
    >
      ⚠ {message}
      <button
        onClick={onRetry}
        style={{
          marginLeft: 8,
          fontSize: 11,
          color: "var(--accent)",
          background: "none",
          border: "none",
          cursor: "pointer",
          textDecoration: "underline",
        }}
      >
        Retry
      </button>
    </div>
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        width: "100%",
        minWidth: 0,
      }}
    >
      {explainingItem && (
        <ReorderExplainModal
          item={explainingItem}
          sales={sales}
          purchases={purchases}
          onClose={() => setExplainingItem(null)}
        />
      )}

      <style>{`
        .dash-filter-row { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
        .dash-filter-row input[type="date"], .dash-filter-row select { width: 100%; }
        .dash-filter-label { font-size: 11px; color: var(--text-dim); margin-bottom: 0; }
        .dash-kpi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .dash-2col { display: grid; grid-template-columns: 1fr; gap: 12px; }
        .dash-table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }
        .dash-table-wrap table { min-width: 280px; }
        .dash-tab-strip { display: flex; gap: 4px; overflow-x: auto; margin-top: 12px; }
        .dash-tab-btn {
          font-size: 13px; font-weight: 500; color: var(--text-muted);
          background: none; border: none; cursor: pointer; white-space: nowrap;
          padding: 9px 4px; border-bottom: 2px solid transparent; margin-right: 18px;
          transition: color 0.12s, border-color 0.12s;
        }
        .dash-tab-btn:hover { color: var(--text); }
        .dash-tab-btn.active { color: var(--accent); font-weight: 700; border-bottom-color: var(--accent); }
        .dash-chip {
          font-size: 10px; color: var(--text-muted); background: var(--bg-card);
          border: 1px solid var(--border); border-radius: 6px; padding: 3px 8px;
          white-space: nowrap;
        }
        @media (min-width: 721px) {
          .dash-filter-row { flex-direction: row; align-items: center; flex-wrap: wrap; }
          .dash-filter-row input[type="date"] { width: 140px; }
          .dash-filter-row select { width: 160px; }
          .dash-kpi-grid { grid-template-columns: repeat(4, 1fr); }
          .dash-2col { grid-template-columns: 1.4fr 1fr; }
        }
      `}</style>

      <div
        style={{
          ...card,
          background:
            "linear-gradient(135deg, var(--accent-bg-subtle), var(--bg-card) 60%)",
          paddingTop: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              background: "var(--accent-bg)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--accent)",
              flexShrink: 0,
            }}
          >
            <Icon name="dashboard" size={18} />
          </span>
          <div>
            <div
              style={{ fontSize: 17, fontWeight: 700, color: "var(--text)" }}
            >
              Dashboard
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Business overview
            </div>
          </div>
        </div>

        <div className="dash-tab-strip">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`dash-tab-btn${activeTab === t.key ? " active" : ""}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {showDateFilters && (
          <div className="dash-filter-row">
            <span className="dash-filter-label">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <span className="dash-filter-label">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            {activeTab === "sales" && (
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              >
                <option value="both">Both locations</option>
                <option value="Kochi">Kochi only</option>
                <option value="Bangalore">Bangalore only</option>
              </select>
            )}
          </div>
        )}
      </div>

      {activeTab === "sales" && (
        <>
          {expensesError && (
            <ErrorBanner
              message={`Expenses: ${expensesError}`}
              onRetry={loadExpenses}
            />
          )}
          {invoicesError && (
            <ErrorBanner
              message={`Overdue invoices: ${invoicesError}`}
              onRetry={loadInvoices}
            />
          )}
          <div className="dash-kpi-grid">
            <Metric
              label="Sales (period)"
              value={fmt(stats.salesVal)}
              sub="total invoiced value"
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
              sub={
                stats.marginAbs > 0 ? fmtRs(stats.marginAbs) : "sales − COGS"
              }
            />
            <Metric
              label="Net profit"
              value={fmt(stats.netProfit)}
              sub={`${stats.netProfitPct.toFixed(1)}% of sales`}
              color={
                stats.netProfit >= 0
                  ? "var(--accent-green)"
                  : "var(--accent-red)"
              }
            />
          </div>

          <div className="dash-2col">
            <div style={card}>
              <div style={sectionLabel}>Income vs expense — last 6 months</div>
              <div style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer>
                  <BarChart data={trend} barGap={4}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--border)"
                    />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                      axisLine={{ stroke: "var(--border)" }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: "var(--text-muted)", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => fmt(v)}
                      width={48}
                    />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      formatter={(v: any) => fmtRs(Number(v))}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar
                      dataKey="Income"
                      fill="var(--accent-green)"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="Expense"
                      fill="var(--accent-red)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={card}>
              <div style={sectionLabel}>Top selling products (period)</div>
              {stats.topMovers.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  No sales in this period.
                </div>
              ) : (
                <div style={{ width: "100%", height: 220 }}>
                  <ResponsiveContainer>
                    <BarChart
                      data={stats.topMovers}
                      layout="vertical"
                      margin={{ left: 10 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--border)"
                        horizontal={false}
                      />
                      <XAxis
                        type="number"
                        tick={{ fill: "var(--text-muted)", fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => fmt(v)}
                      />
                      <YAxis
                        type="category"
                        dataKey="model"
                        tick={{ fill: "var(--text-dim)", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={90}
                      />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        formatter={(v: any) => fmtRs(Number(v))}
                      />
                      <Bar
                        dataKey="value"
                        fill="var(--accent)"
                        radius={[0, 4, 4, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <div style={card}>
            <div style={sectionLabel}>⚠ Overdue invoices</div>
            {invoicesLoading ? (
              <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                Loading…
              </div>
            ) : overdueInvoices.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                Nothing overdue — nice.
              </div>
            ) : (
              <div className="dash-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Customer</th>
                      <th style={{ textAlign: "right" }}>Amount</th>
                      <th style={{ textAlign: "right" }}>Overdue by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overdueInvoices.map((inv) => (
                      <tr key={inv.id}>
                        <td>{inv.invoice_number}</td>
                        <td style={{ color: "var(--text-muted)" }}>
                          {inv.customer_snapshot?.display_name ||
                            inv.customer_snapshot?.name ||
                            "—"}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 500 }}>
                          {fmtRs(inv.total)}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            color:
                              inv.daysOverdue > 15
                                ? "var(--accent-red)"
                                : "var(--accent-amber)",
                            fontWeight: 600,
                          }}
                        >
                          {inv.daysOverdue}d
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === "leads" && (
        <div style={card}>
          <div style={sectionLabel}>Leads &amp; opportunities</div>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              lineHeight: 1.7,
              marginBottom: 14,
            }}
          >
            The Leads, Contacts, and Opportunities screens (under CRM in the
            sidebar) aren't wired to real data yet — once they are, this tab
            will show live pipeline numbers here automatically.
          </div>
          <div className="dash-kpi-grid">
            <Metric label="Open leads" value="—" sub="not tracked yet" />
            <Metric
              label="Qualified this month"
              value="—"
              sub="not tracked yet"
            />
            <Metric
              label="Open opportunities"
              value="—"
              sub="not tracked yet"
            />
            <Metric label="Conversion rate" value="—" sub="not tracked yet" />
          </div>
        </div>
      )}

      {activeTab === "inventory" && (
        <>
          {stockError && (
            <ErrorBanner message={`Stock: ${stockError}`} onRetry={loadStock} />
          )}
          {invoicesError && (
            <ErrorBanner
              message={`Pending dispatch: ${invoicesError}`}
              onRetry={loadInvoices}
            />
          )}
          <div className="dash-kpi-grid">
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
              label="Total units"
              value={
                stockLoading
                  ? "…"
                  : (
                      stockTotals.kochiItems + stockTotals.bloreItems
                    ).toLocaleString("en-IN")
              }
              sub="across both locations"
            />
            <Metric
              label="Pending dispatch"
              value={invoicesLoading ? "…" : String(pendingDispatch.count)}
              sub={invoicesLoading ? "" : fmt(pendingDispatch.value)}
              color="var(--accent-amber)"
            />
            <Metric
              label="Purchases (period)"
              value={fmt(stats.purchasesVal)}
              sub="incl. courier charges"
            />
          </div>

          <div style={card}>
            <div style={sectionLabel}>Stock by location</div>
            {stockLoading ? (
              <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                Loading…
              </div>
            ) : (
              <div className="dash-table-wrap">
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
          </div>

          <div style={card}>
            <div style={sectionLabel}>📋 Item ordering priority</div>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                lineHeight: 1.6,
                marginBottom: 12,
              }}
            >
              Every item, ranked by how urgently it needs reordering. The score
              combines sales velocity, days of stock remaining, and how{" "}
              <em>regular</em> the demand has been over the last{" "}
              {REORDER_WINDOW_MONTHS} months — a one-time bulk sale scores lower
              than steady repeat sales of the same total quantity, because its
              demand pattern is less predictable. <strong>Tap any row</strong>{" "}
              to see exactly why it got that score.
            </div>

            {/* Always-visible legend — no hover needed, works on touch */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 12,
              }}
            >
              {[
                {
                  tier: "URGENT",
                  color: "var(--accent-red)",
                  bg: "var(--accent-red-bg)",
                  desc: "Will likely run out before a new order can arrive",
                },
                {
                  tier: "SOON",
                  color: "var(--accent-amber)",
                  bg: "var(--accent-amber-bg)",
                  desc: "Getting low for how it typically sells",
                },
                {
                  tier: "WATCH",
                  color: "var(--accent)",
                  bg: "var(--accent-bg)",
                  desc: "Not urgent yet, keep an eye on it",
                },
                {
                  tier: "OK",
                  color: "var(--text-muted)",
                  bg: "var(--bg-input)",
                  desc: "No action needed right now",
                },
              ].map((t) => (
                <div
                  key={t.tier}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 10,
                    color: "var(--text-muted)",
                    background: "var(--bg-input)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "4px 8px",
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      padding: "2px 7px",
                      borderRadius: 99,
                      background: t.bg,
                      color: t.color,
                      flexShrink: 0,
                    }}
                  >
                    {t.tier}
                  </span>
                  {t.desc}
                </div>
              ))}
            </div>

            {reorderList.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                No stock or sales data yet.
              </div>
            ) : (
              <div className="dash-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th
                        style={{ textAlign: "right" }}
                        title="Units currently on hand across both locations"
                      >
                        In stock
                      </th>
                      <th
                        style={{ textAlign: "right" }}
                        title="How many days the current stock will last, at the pace this item has recently been selling"
                      >
                        Days of cover
                      </th>
                      <th
                        style={{ textAlign: "right" }}
                        title={`Percentage of the last ${REORDER_WINDOW_MONTHS} months that had at least one sale — higher means it sells consistently, not just occasionally`}
                      >
                        Regularity
                      </th>
                      <th
                        style={{ textAlign: "right" }}
                        title={`Recommended reorder amount to cover the assumed ${LEAD_TIME_DAYS}-day supplier lead time plus a safety buffer`}
                      >
                        Suggested qty
                      </th>
                      <th
                        style={{ textAlign: "right" }}
                        title="How urgently this item needs reordering — tap Explain on any row for the full reasoning"
                      >
                        Priority
                      </th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {reorderList.map((r) => {
                      const tierColor =
                        r.tier === "URGENT"
                          ? "var(--accent-red)"
                          : r.tier === "SOON"
                            ? "var(--accent-amber)"
                            : r.tier === "WATCH"
                              ? "var(--accent)"
                              : "var(--text-muted)";
                      const tierBg =
                        r.tier === "URGENT"
                          ? "var(--accent-red-bg)"
                          : r.tier === "SOON"
                            ? "var(--accent-amber-bg)"
                            : r.tier === "WATCH"
                              ? "var(--accent-bg)"
                              : "var(--bg-input)";
                      return (
                        <tr key={r.model}>
                          <td style={{ fontWeight: 500 }}>{r.model}</td>
                          <td style={{ textAlign: "right" }}>
                            {r.currentStock}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {r.daysOfCover === null
                              ? "—"
                              : `${Math.round(r.daysOfCover)}d`}
                          </td>
                          <td
                            style={{
                              textAlign: "right",
                              color: "var(--text-muted)",
                            }}
                          >
                            {Math.round(r.regularity * 100)}%
                          </td>
                          <td style={{ textAlign: "right", fontWeight: 500 }}>
                            {r.suggestedQty}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: "2px 8px",
                                borderRadius: 99,
                                background: tierBg,
                                color: tierColor,
                              }}
                            >
                              {r.tier}
                            </span>
                          </td>
                          <td>
                            <button
                              className="btn-ghost"
                              style={{ fontSize: 10, padding: "3px 9px" }}
                              onClick={() =>
                                setExplainingItem({
                                  ...r,
                                  windowMonths: REORDER_WINDOW_MONTHS,
                                  leadTimeDays: LEAD_TIME_DAYS,
                                })
                              }
                            >
                              Explain
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === "expenses" && (
        <>
          {expensesError && (
            <ErrorBanner
              message={`Expenses: ${expensesError}`}
              onRetry={loadExpenses}
            />
          )}
          <div className="dash-kpi-grid">
            <Metric
              label="Total expenses (period)"
              value={expensesLoading ? "…" : fmt(stats.expensesVal)}
              sub="company + project"
              color="var(--accent-amber)"
            />
            <Metric
              label="Company expenses"
              value={expensesLoading ? "…" : fmt(stats.companyExpensesVal)}
            />
            <Metric
              label="Project expenses"
              value={expensesLoading ? "…" : fmt(stats.projectExpensesVal)}
            />
            <Metric
              label="Net profit (period)"
              value={fmt(stats.netProfit)}
              sub="sales − COGS − expenses"
              color={
                stats.netProfit >= 0
                  ? "var(--accent-green)"
                  : "var(--accent-red)"
              }
            />
          </div>

          <div className="dash-2col">
            <div style={card}>
              <div style={sectionLabel}>Top expense categories (period)</div>
              {expensesLoading ? (
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  Loading…
                </div>
              ) : stats.expenseGroups.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  No expenses recorded in this period.
                </div>
              ) : (
                <div
                  style={{
                    width: "100%",
                    height: 240,
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={stats.expenseGroups}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={48}
                        outerRadius={80}
                        paddingAngle={2}
                      >
                        {stats.expenseGroups.map((_, i) => (
                          <Cell
                            key={i}
                            fill={
                              EXPENSE_CHART_COLORS[
                                i % EXPENSE_CHART_COLORS.length
                              ]
                            }
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        formatter={(v: any) => fmtRs(Number(v))}
                      />
                      <Legend
                        layout="vertical"
                        align="right"
                        verticalAlign="middle"
                        wrapperStyle={{ fontSize: 11, lineHeight: "18px" }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div style={card}>
              <div style={sectionLabel}>Recent expenses</div>
              {stats.recentExpenses.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  Nothing recorded in this period.
                </div>
              ) : (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 2 }}
                >
                  {stats.recentExpenses.map((e: any, i: number) => (
                    <div
                      key={e.id ?? i}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 4px",
                        borderBottom:
                          i < stats.recentExpenses.length - 1
                            ? "1px solid var(--border)"
                            : "none",
                        gap: 8,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 500,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {e.category}
                        </div>
                        <div
                          style={{ fontSize: 10, color: "var(--text-muted)" }}
                        >
                          {e.vendor || e.category_group} ·{" "}
                          {String(e.date ?? "").split("T")[0]}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          flexShrink: 0,
                          color: "var(--accent-amber)",
                        }}
                      >
                        {fmtRs(Number(e.amount))}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {activeTab === "activity" && (
        <div style={card}>
          <div style={sectionLabel}>Recent activity</div>
          {recentActivity.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
              Nothing recorded yet.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {recentActivity.map((a, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 4px",
                    borderBottom:
                      i < recentActivity.length - 1
                        ? "1px solid var(--border)"
                        : "none",
                    gap: 8,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {a.label}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                      {a.sub || "—"} · {a.date}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      flexShrink: 0,
                      color:
                        a.type === "sale"
                          ? "var(--accent-green)"
                          : a.type === "purchase"
                            ? "var(--accent)"
                            : "var(--accent-amber)",
                    }}
                  >
                    {a.type === "expense" || a.type === "purchase"
                      ? "− "
                      : "+ "}
                    {fmtRs(a.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
