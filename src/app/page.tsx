"use client";
import { useEffect, useState, useCallback } from "react";
import Sidebar from "@/components/Sidebar";
import Dashboard from "@/components/Dashboard";
import StockView from "@/components/StockView";
import RecordSale from "@/components/RecordSale";
import RecordPurchase from "@/components/RecordPurchase";
import StockTransfer from "@/components/StockTransfer";
import AddItem from "@/components/AddItem";
import Downloads from "@/components/Downloads";
import Transactions from "@/components/Transactions";
import Quotation from "@/components/Quotation";

export type Screen =
  | "dashboard"
  | "stock"
  | "sale"
  | "purchase"
  | "transfer"
  | "additem"
  | "transactions"
  | "quotation"
  | "downloads";

const TITLES: Record<Screen, string> = {
  dashboard: "Dashboard",
  stock: "Stock View",
  sale: "Record Sale",
  purchase: "Record Purchase",
  transfer: "Stock Transfer",
  additem: "Add New Item",
  transactions: "Transaction History",
  quotation: "Quotation",
  downloads: "Downloads & Reports",
};

export default function Home() {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);

  const refreshProducts = useCallback(async () => {
    try {
      const r = await fetch("/api/products");
      const d = await r.json();
      if (d.products) setProducts(d.products);
    } catch {}
  }, []);
  const refreshSales = useCallback(async () => {
    try {
      const r = await fetch("/api/sales");
      const d = await r.json();
      if (d.sales) setSales(d.sales);
    } catch {}
  }, []);
  const refreshPurchases = useCallback(async () => {
    try {
      const r = await fetch("/api/purchases");
      const d = await r.json();
      if (d.purchases) setPurchases(d.purchases);
    } catch {}
  }, []);

  useEffect(() => {
    refreshProducts();
    refreshSales();
    refreshPurchases();
  }, [refreshProducts, refreshSales, refreshPurchases]);
  const refresh = () => {
    refreshProducts();
    refreshSales();
    refreshPurchases();
  };

  // Native <input type="date"> only opens the calendar dropdown when you
  // click the small icon on the right — clicking anywhere else in the
  // field just drops a text cursor into a date segment, which feels
  // broken next to every other clickable-anywhere control in the app.
  // This delegates clicks on ANY date input, anywhere in the app, to
  // showPicker() so the whole field behaves like a single button.
  // One listener at the root covers every screen — no need to repeat
  // this in each component that has a date field.
  //
  // showPicker() is newer (Chrome/Edge 99+, Safari 16.4+) and isn't in
  // older TS DOM lib typings, so it's accessed via an optional cast
  // rather than assumed to exist. Browsers without it (older Firefox)
  // simply keep the old "click the icon" behavior — nothing breaks.
  useEffect(() => {
    const handleDateInputClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        target.tagName === "INPUT" &&
        (target as HTMLInputElement).type === "date"
      ) {
        const input = target as HTMLInputElement & {
          showPicker?: () => void;
        };
        if (typeof input.showPicker === "function") {
          try {
            input.showPicker();
          } catch {
            // Ignore — e.g. picker already open, or a browser quirk
            // around calling showPicker() outside a direct user gesture.
          }
        }
      }
    };
    document.addEventListener("click", handleDateInputClick);
    return () => document.removeEventListener("click", handleDateInputClick);
  }, []);

  const handleScreenChange = (s: Screen) => {
    setScreen(s);
    setSidebarOpen(false);
  };

  return (
    <div
      className="app-shell"
      style={{ display: "flex", height: "100vh", overflow: "hidden" }}
    >
      <style>{`
        .mobile-menu-btn { display: none; }
        .sidebar-backdrop { display: none; }
        @media (max-width: 860px) {
          .mobile-menu-btn { display: inline-flex !important; }
          .app-sidebar {
            position: fixed;
            inset: 0 auto 0 0;
            z-index: 50;
            transform: translateX(-100%);
            transition: transform 0.2s ease;
            width: 220px !important;
          }
          .app-sidebar.open { transform: translateX(0); }
          .sidebar-backdrop.open {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.5);
            z-index: 40;
          }
          .app-main-header { padding: 10px 12px !important; }
          .app-main-body { padding: 12px !important; }
          .app-header-title { font-size: 13px !important; }
          .app-live-badge { display: none; }
        }
      `}</style>

      <div className={`app-sidebar${sidebarOpen ? " open" : ""}`}>
        <Sidebar current={screen} onChange={handleScreenChange} />
      </div>
      <div
        className={`sidebar-backdrop${sidebarOpen ? " open" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          minWidth: 0,
        }}
      >
        <div
          className="app-main-header"
          style={{
            background: "var(--bg-card)",
            borderBottom: "1px solid var(--border)",
            padding: "10px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
            gap: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minWidth: 0,
            }}
          >
            <button
              className="mobile-menu-btn btn-ghost"
              style={{ fontSize: 14, padding: "5px 9px", flexShrink: 0 }}
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              ☰
            </button>
            <span
              className="app-header-title"
              style={{
                fontWeight: 500,
                fontSize: 14,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {TITLES[screen]}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexShrink: 0,
            }}
          >
            <button
              className="btn-ghost"
              style={{ fontSize: 11, padding: "4px 10px" }}
              onClick={refresh}
            >
              ↻ Refresh
            </button>
            <span
              className="app-live-badge"
              style={{
                fontSize: 10,
                padding: "2px 8px",
                borderRadius: 99,
                background: "rgba(34,197,94,0.12)",
                color: "var(--accent-green)",
              }}
            >
              ● Live · Google Sheets
            </span>
          </div>
        </div>
        <div
          className="app-main-body"
          style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}
        >
          {screen === "dashboard" && (
            <Dashboard
              products={products}
              sales={sales}
              purchases={purchases}
            />
          )}
          {screen === "stock" && <StockView products={products} />}
          {screen === "sale" && (
            <RecordSale
              products={products}
              onSuccess={() => {
                refresh();
                setScreen("stock");
              }}
            />
          )}
          {screen === "purchase" && (
            <RecordPurchase
              products={products}
              onSuccess={() => {
                refresh();
                setScreen("stock");
              }}
            />
          )}
          {screen === "transfer" && (
            <StockTransfer
              products={products}
              onSuccess={() => {
                refresh();
                setScreen("stock");
              }}
            />
          )}
          {screen === "additem" && (
            <AddItem
              onSuccess={() => {
                refresh();
                setScreen("stock");
              }}
            />
          )}
          {screen === "transactions" && (
            <Transactions sales={sales} purchases={purchases} />
          )}
          {screen === "quotation" && <Quotation products={products} />}
          {screen === "downloads" && (
            <Downloads
              products={products}
              sales={sales}
              purchases={purchases}
            />
          )}
        </div>
      </div>
    </div>
  );
}
