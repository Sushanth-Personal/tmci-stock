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
import Ledger from "@/components/Ledger";
import Quotation from "@/components/Quotation";
import Customers from "@/components/Customers";
import Invoices from "@/components/Invoices";
import PriceFinder from "@/components/PriceFinder";
import PendingInvoices from "@/components/PendingInvoices";
import ComingSoon from "@/components/ComingSoon";
import Bin from "@/components/Bin";
import StockSerials from "@/components/StockSerials";
import Settings from "@/components/Settings";
import Expenses from "@/components/Expenses";
export type Screen =
  // existing
  | "dashboard"
  | "stock"
  | "sale"
  | "invoices"
  | "purchase"
  | "transfer"
  | "transfers"
  | "additem"
  | "ledger"
  | "quotation"
  | "downloads"
  | "customers"
  // new CRM
  | "vendors"
  | "projects"
  // new Sales
  | "proforma"
  | "credit_note"
  | "challan"
  | "packing_list"
  | "eway_bill"
  // new Inventory
  | "debit_note"
  // new Expenses
  | "expenses"
  | "proj_expenses"
  // new People / Admin
  | "employees"
  | "bin"
  | "stock_serials"
  | "audit_log"
  | "settings";

const TITLES: Record<Screen, string> = {
  dashboard: "Dashboard",
  stock: "Stock",
  sale: "Record Sale",
  invoices: "Invoice",
  purchase: "Purchase Orders",
  transfer: "Stock Transfer",
  transfers: "Stock Transfer",
  additem: "Add New Item",
  ledger: "Ledger",
  quotation: "Quotation",
  downloads: "Downloads & Reports",
  customers: "Customers",
  vendors: "Vendors",
  projects: "Projects",
  proforma: "Proforma Invoice",
  credit_note: "Credit Note",
  challan: "Delivery Challan",
  packing_list: "Packing List",
  eway_bill: "E-Way Bill",
  debit_note: "Debit Note",
  expenses: "Company Expenses",
  proj_expenses: "Project Expenses",
  employees: "Employees",
  bin: "Bin",
  stock_serials: "Stock & Serials",
  audit_log: "Audit Log",
  settings: "Settings",
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

  useEffect(() => {
    const handleDateInputClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        target.tagName === "INPUT" &&
        (target as HTMLInputElement).type === "date"
      ) {
        const input = target as HTMLInputElement & { showPicker?: () => void };
        if (typeof input.showPicker === "function") {
          try {
            input.showPicker();
          } catch {}
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
          .app-sidebar { position: fixed; inset: 0 auto 0 0; z-index: 50; transform: translateX(-100%); transition: transform 0.2s ease; width: 220px !important; }
          .app-sidebar.open { transform: translateX(0); }
          .sidebar-backdrop.open { display: block; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 40; }
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
        {/* Header */}
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
            <PriceFinder products={products} />
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
              ● Live · TMCI Desk
            </span>
          </div>
        </div>

        {/* Body */}
        <div
          className="app-main-body"
          style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}
        >
          {/* ── Existing screens (unchanged) ── */}
          {screen === "dashboard" && (
            <>
              <PendingInvoices onStockChanged={refresh} />
              <Dashboard
                products={products}
                sales={sales}
                purchases={purchases}
              />
            </>
          )}
          {screen === "stock" && <StockView products={products} />}
          {screen === "sale" && (
            <RecordSale
              products={products}
              onSuccess={() => {
                refresh();
                setScreen("invoices");
              }}
            />
          )}
          {screen === "invoices" && <Invoices onStockChanged={refresh} />}
          {screen === "purchase" && (
            <RecordPurchase
              products={products}
              onSuccess={() => {
                refresh();
                setScreen("stock");
              }}
            />
          )}
          {(screen === "transfer" || screen === "transfers") && (
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
          {screen === "ledger" && (
            <Ledger sales={sales} purchases={purchases} />
          )}
          {screen === "quotation" && <Quotation products={products} />}
          {screen === "downloads" && (
            <Downloads
              products={products}
              sales={sales}
              purchases={purchases}
            />
          )}
          {screen === "customers" && <Customers />}

          {/* ── New CRM screens ── */}
          {screen === "vendors" && (
            <ComingSoon
              title="Vendors"
              icon="🏭"
              description="Manage your supplier and vendor database — contact details, payment terms, GSTIN, and purchase history."
              bullets={[
                "Vendor profile with GSTIN, bank details, payment terms",
                "Link vendors to Purchase Orders and lots",
                "Purchase history per vendor",
                "Outstanding payables tracker",
              ]}
            />
          )}
          {screen === "projects" && (
            <ComingSoon
              title="Projects"
              icon="📁"
              description="Track opportunities, pre-projects, and active projects from lead to closure."
              bullets={[
                "Opportunities — initial enquiries and leads",
                "Pre-Projects — quoted, awaiting PO",
                "Projects — active, with milestones and billing",
                "Link invoices, expenses, and customers to projects",
              ]}
            />
          )}

          {/* ── New Sales screens ── */}
          {screen === "proforma" && (
            <ComingSoon
              title="Proforma Invoice"
              icon="📋"
              description="Generate proforma invoices for customers before raising the final tax invoice."
              bullets={[
                "Same line-item builder as Quotation",
                "Auto-number with PI prefix",
                "Convert to Invoice with one click",
                "PDF export",
              ]}
            />
          )}
          {screen === "credit_note" && (
            <ComingSoon
              title="Credit Note"
              icon="↩"
              description="Issue credit notes against dispatched invoices for returns, short-supply, or price corrections."
              bullets={[
                "Link to original invoice",
                "Partial or full credit",
                "Restore stock on return",
                "GST-compliant credit note format",
              ]}
            />
          )}
          {screen === "challan" && (
            <ComingSoon
              title="Delivery Challan"
              icon="🚚"
              description="Generate delivery challans for goods dispatched without a tax invoice (e.g. demos, approvals)."
              bullets={[
                "Auto-fill from Invoice or Proforma",
                "Serial number capture",
                "Driver and vehicle details",
                "Convert to Invoice on confirmation",
              ]}
            />
          )}
          {screen === "packing_list" && (
            <ComingSoon
              title="Packing List"
              icon="📦"
              description="Generate packing lists for shipments — box-wise breakup of items and quantities."
              bullets={[
                "Box-wise item allocation",
                "Link to Invoice or Challan",
                "Net and gross weight per box",
                "Print-ready format",
              ]}
            />
          )}
          {screen === "eway_bill" && (
            <ComingSoon
              title="E-Way Bill"
              icon="🛣"
              description="Generate and manage E-Way Bills for GST-compliant movement of goods above ₹50,000."
              bullets={[
                "Auto-fill from Invoice",
                "Transporter and vehicle details",
                "E-Way Bill number tracking",
                "Integration with NIC portal (planned)",
              ]}
            />
          )}

          {/* ── New Inventory screens ── */}
          {screen === "debit_note" && (
            <ComingSoon
              title="Debit Note"
              icon="📝"
              description="Issue debit notes to vendors for short supply, price differences, or quality rejections."
              bullets={[
                "Link to Purchase Order or lot",
                "Partial debit on under-delivery",
                "GST-compliant debit note format",
                "Adjust vendor outstanding balance",
              ]}
            />
          )}

          {screen === "expenses" && <Expenses type="company" />}
          {screen === "proj_expenses" && <Expenses type="project" />}

          {/* ── People / Admin ── */}
          {screen === "employees" && (
            <ComingSoon
              title="Employees"
              icon="👤"
              description="Manage your team — contact details, roles, and access levels."
              bullets={[
                "Employee profiles and roles",
                "Assign to projects and customers",
                "Access control per screen (planned)",
                "Attendance and leave tracking (planned)",
              ]}
            />
          )}
          {screen === "stock_serials" && <StockSerials />}
          {screen === "audit_log" && (
            <ComingSoon
              title="Audit Log"
              icon="🔍"
              description="Full activity log — every invoice created, stock dispatched, lot consumed, and setting changed."
              bullets={[
                "Timestamp and user for every action",
                "Filter by date, screen, or action type",
                "Immutable — records cannot be edited",
                "Export for compliance",
              ]}
            />
          )}
          {screen === "settings" && <Settings />}
          {screen === "bin" && <Bin />}
        </div>
      </div>
    </div>
  );
}
