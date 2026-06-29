// src/app/pricefinder/page.tsx
// Standalone Fluke-branded Price Finder
// Fluke brand: Yellow #FFC20E, Dark navy #1A2035, White #FFFFFF

"use client";
import { useEffect, useState, useMemo, useRef } from "react";

const DISCS = [22, 25, 28, 30];
const GST = 18;
const fmt = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

// Fluke logo as inline SVG
const FlukeLogo = () => (
  <svg
    width="80"
    height="28"
    viewBox="0 0 80 28"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect width="80" height="28" rx="2" fill="#FFC20E" />
    <text
      x="8"
      y="20"
      fontFamily="Arial Black, Arial"
      fontWeight="900"
      fontSize="16"
      fill="#1A2035"
      letterSpacing="1"
    >
      FLUKE
    </text>
  </svg>
);

export default function PriceFinderPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [listPrice, setListPrice] = useState<number | "">("");
  const [disc, setDisc] = useState<number | "">(22);
  const [activeDisc, setActiveDisc] = useState<number | null>(22);
  const [dropOpen, setDropOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [dsState, setDsState] = useState<"idle" | "loading" | "none">("idle");
  const [lot, setLot] = useState<any>(null);
  const [lotLoading, setLotLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/products")
      .then((r) => r.json())
      .then((d) => {
        if (d.products) setProducts(d.products);
      });
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return products
      .filter(
        (p) =>
          String(p.model ?? "")
            .toLowerCase()
            .includes(q) ||
          String(p.description ?? "")
            .toLowerCase()
            .includes(q),
      )
      .slice(0, 8);
  }, [products, query]);

  const fetchLot = async (model: string) => {
    setLotLoading(true);
    setLot(null);
    try {
      const [rK, rB] = await Promise.all([
        fetch(
          `/api/lot-cost?model=${encodeURIComponent(model)}&location=Kochi`,
        ),
        fetch(
          `/api/lot-cost?model=${encodeURIComponent(model)}&location=Bangalore`,
        ),
      ]);
      const [dK, dB] = await Promise.all([rK.json(), rB.json()]);
      setLot({ kochi: dK, bangalore: dB });
    } catch {}
    setLotLoading(false);
  };

  const pick = (p: any) => {
    setQuery(p.model);
    setSelectedModel(p.model);
    setListPrice(p.listPrice ?? "");
    setDropOpen(false);
    setDsState("idle");
    fetchLot(p.model);
  };

  const reset = () => {
    setQuery("");
    setListPrice("");
    setSelectedModel("");
    setLot(null);
    setDsState("idle");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const openDs = async () => {
    if (!selectedModel) return;
    setDsState("loading");
    try {
      const r = await fetch(
        `/api/datasheet?model=${encodeURIComponent(selectedModel)}`,
      );
      const d = await r.json();
      if (d.found && d.files?.[0]) {
        window.open(d.files[0].viewLink, "_blank");
        setDsState("idle");
      } else {
        setDsState("none");
        setTimeout(() => setDsState("idle"), 2000);
      }
    } catch {
      setDsState("idle");
    }
  };

  const lp = +(listPrice || 0);
  const d = +(disc || 0);
  const fifoK = lot?.kochi?.found ? lot.kochi.fifoPrice : 0;
  const fifoB = lot?.bangalore?.found ? lot.bangalore.fifoPrice : 0;
  const fifo = fifoK || fifoB || 0;
  const custExGst = lp * (1 - d / 100);
  const custGst = (custExGst * GST) / 100;
  const custIncl = custExGst + custGst;
  const margin = fifo > 0 && custExGst > 0 ? custExGst - fifo : 0;
  const marginPct = lp > 0 && fifo > 0 ? ((custExGst - fifo) / lp) * 100 : 0;
  const profitable = margin > 0;
  const hasCalc = lp > 0;
  const kochiQty = lot?.kochi?.found ? lot.kochi.totalOpenQty : 0;
  const bloreQty = lot?.bangalore?.found ? lot.bangalore.totalOpenQty : 0;

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; }
        body {
          background: #F5F6F8;
          color: #1A2035;
          font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
          font-size: 14px;
          min-height: 100vh;
        }

        /* Header */
        .pf-header {
          background: #1A2035;
          padding: 0 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 56px;
          position: sticky;
          top: 0;
          z-index: 100;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }
        .pf-header-right {
          font-size: 11px;
          color: #8896B0;
          text-align: right;
          line-height: 1.4;
        }
        .pf-header-right strong {
          display: block;
          color: #C8D0E0;
          font-size: 12px;
        }

        /* Yellow accent bar */
        .pf-accent-bar {
          height: 4px;
          background: #FFC20E;
        }

        /* Main container */
        .pf-main {
          max-width: 520px;
          margin: 0 auto;
          padding: 20px 16px 40px;
        }

        /* Section title */
        .pf-section-title {
          font-size: 11px;
          font-weight: 600;
          color: #8896B0;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 6px;
        }

        /* Search box */
        .pf-search-wrap {
          background: #fff;
          border: 1.5px solid #DDE1EA;
          border-radius: 8px;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 12px;
          height: 50px;
          transition: border-color 0.15s, box-shadow 0.15s;
          margin-bottom: 16px;
        }
        .pf-search-wrap:focus-within {
          border-color: #FFC20E;
          box-shadow: 0 0 0 3px rgba(255,194,14,0.15);
        }
        .pf-search-wrap input {
          flex: 1;
          border: none;
          outline: none;
          font-size: 15px;
          color: #1A2035;
          background: transparent;
          font-weight: 500;
        }
        .pf-search-wrap input::placeholder { color: #B0B8CC; font-weight: 400; }

        /* Dropdown */
        .pf-dropdown {
          background: #fff;
          border: 1.5px solid #DDE1EA;
          border-radius: 8px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.12);
          overflow: hidden;
          position: absolute;
          top: calc(100% + 6px);
          left: 0; right: 0;
          z-index: 50;
        }
        .pf-drop-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 11px 14px;
          cursor: pointer;
          border-bottom: 1px solid #F0F2F5;
          gap: 8px;
          transition: background 0.1s;
        }
        .pf-drop-item:last-child { border-bottom: none; }
        .pf-drop-item:hover { background: #FFF8E1; }
        .pf-drop-item-model { font-size: 14px; font-weight: 600; color: #1A2035; }
        .pf-drop-item-desc { font-size: 12px; color: #8896B0; margin-top: 1px; }
        .pf-drop-item-price { font-size: 13px; font-weight: 600; color: #1A2035; flex-shrink: 0; }

        /* Cards */
        .pf-card {
          background: #fff;
          border: 1.5px solid #DDE1EA;
          border-radius: 8px;
          padding: 14px 16px;
          margin-bottom: 12px;
        }

        /* List price input */
        .pf-price-input {
          width: 100%;
          border: 1.5px solid #DDE1EA;
          border-radius: 6px;
          padding: 10px 12px;
          font-size: 16px;
          font-weight: 600;
          color: #1A2035;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
          background: #fff;
        }
        .pf-price-input:focus {
          border-color: #FFC20E;
          box-shadow: 0 0 0 3px rgba(255,194,14,0.15);
        }
        .pf-price-input::placeholder { color: #B0B8CC; font-weight: 400; font-size: 14px; }

        /* Discount chips */
        .pf-chips { display: flex; gap: 8px; margin-bottom: 10px; }
        .pf-chip {
          flex: 1;
          text-align: center;
          padding: 10px 0;
          border-radius: 6px;
          font-size: 15px;
          font-weight: 600;
          border: 1.5px solid #DDE1EA;
          background: #F5F6F8;
          color: #5A6478;
          cursor: pointer;
          transition: all 0.1s;
        }
        .pf-chip:hover { border-color: #FFC20E; color: #1A2035; }
        .pf-chip.on {
          background: #FFC20E;
          border-color: #FFC20E;
          color: #1A2035;
        }

        /* Other discount row */
        .pf-other {
          display: flex;
          align-items: center;
          gap: 10px;
          border: 1.5px solid #DDE1EA;
          border-radius: 6px;
          padding: 8px 12px;
          background: #F5F6F8;
        }
        .pf-other input {
          flex: 1;
          border: none;
          outline: none;
          background: transparent;
          font-size: 15px;
          font-weight: 600;
          color: #1A2035;
          text-align: center;
        }
        .pf-other input::placeholder { color: #B0B8CC; font-weight: 400; }

        /* Result card */
        .pf-result-card {
          background: #fff;
          border: 1.5px solid #DDE1EA;
          border-radius: 8px;
          overflow: hidden;
          margin-bottom: 12px;
        }
        .pf-result-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
        }
        .pf-result-cell {
          padding: 16px;
        }
        .pf-result-cell:first-child {
          border-right: 1.5px solid #DDE1EA;
          background: #FFFBEE;
        }
        .pf-result-label {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 6px;
          color: #8896B0;
        }
        .pf-result-cell:first-child .pf-result-label { color: #B8860B; }
        .pf-result-value {
          font-size: 28px;
          font-weight: 700;
          line-height: 1;
          color: #1A2035;
        }
        .pf-result-cell:first-child .pf-result-value { color: #1A2035; }
        .pf-result-sub { font-size: 11px; color: #8896B0; margin-top: 5px; }

        /* Margin row */
        .pf-margin-row {
          padding: 14px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-top: 1.5px solid #DDE1EA;
        }
        .pf-margin-row.good { background: #F0FDF4; }
        .pf-margin-row.bad  { background: #FFF5F5; }
        .pf-margin-label { font-size: 13px; font-weight: 600; }
        .pf-margin-amount { font-size: 12px; margin-top: 3px; }
        .pf-margin-pct { font-size: 32px; font-weight: 700; line-height: 1; }
        .good .pf-margin-label, .good .pf-margin-amount, .good .pf-margin-pct { color: #16A34A; }
        .bad  .pf-margin-label, .bad  .pf-margin-amount, .bad  .pf-margin-pct  { color: #DC2626; }

        /* Stock pills */
        .pf-stock-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          padding: 12px 16px;
          border-top: 1.5px solid #DDE1EA;
          background: #F5F6F8;
        }
        .pf-stock-pill {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #fff;
          border: 1.5px solid #DDE1EA;
          border-radius: 6px;
          padding: 8px 12px;
        }
        .pf-stock-loc { font-size: 12px; color: #8896B0; font-weight: 500; }
        .pf-stock-qty { font-size: 13px; font-weight: 700; }
        .pf-stock-qty.in  { color: #16A34A; }
        .pf-stock-qty.out { color: #B0B8CC; }

        /* Icon button */
        .pf-icon-btn {
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px;
          color: #8896B0;
          font-size: 18px;
          line-height: 1;
          display: flex;
          align-items: center;
          transition: color 0.1s;
        }
        .pf-icon-btn:hover { color: #1A2035; }
        .pf-icon-btn.active { color: #FFC20E; }

        /* Datasheet btn */
        .pf-ds-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          font-weight: 500;
          color: #1A2035;
          background: #FFC20E;
          border: none;
          border-radius: 5px;
          padding: 4px 10px;
          cursor: pointer;
          transition: opacity 0.1s;
        }
        .pf-ds-btn:hover { opacity: 0.85; }

        /* Footer */
        .pf-footer {
          text-align: center;
          padding: 24px 16px 16px;
          color: #B0B8CC;
          font-size: 11px;
          line-height: 1.8;
        }
        .pf-footer strong { color: #8896B0; }

        /* Yellow divider */
        .pf-ydivider {
          height: 3px;
          background: #FFC20E;
          border-radius: 2px;
          margin: 16px 0;
          opacity: 0.4;
        }
      `}</style>

      {/* Header */}
      <div className="pf-header">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <FlukeLogo />
          <div style={{ borderLeft: "1px solid #2E3D5A", paddingLeft: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#C8D0E0" }}>
              Price Finder
            </div>
            <div style={{ fontSize: 10, color: "#8896B0", marginTop: 1 }}>
              TMCI Technology · Authorised Dealer
            </div>
          </div>
        </div>
        <div className="pf-header-right">
          <strong>Kerala · Karnataka</strong>
          Live pricing & availability
        </div>
      </div>

      {/* Yellow accent bar */}
      <div className="pf-accent-bar" />

      {/* Main content */}
      <div className="pf-main">
        {/* Search */}
        <div style={{ position: "relative", marginBottom: 16 }}>
          <div className="pf-section-title">Search product</div>
          <div className="pf-search-wrap">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#B0B8CC"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              placeholder="Search model name…"
              autoComplete="off"
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedModel("");
                setListPrice("");
                setLot(null);
                setDropOpen(true);
              }}
              onFocus={() => query && setDropOpen(true)}
            />
            {selectedModel && (
              <button className={`pf-ds-btn`} onClick={openDs}>
                {dsState === "loading"
                  ? "…"
                  : dsState === "none"
                    ? "No datasheet"
                    : "📄 Datasheet"}
              </button>
            )}
            {query && (
              <button className="pf-icon-btn" onClick={reset}>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>

          {dropOpen && filtered.length > 0 && (
            <>
              <div
                onClick={() => setDropOpen(false)}
                style={{ position: "fixed", inset: 0, zIndex: 40 }}
              />
              <div className="pf-dropdown">
                {filtered.map((p) => (
                  <div
                    key={p.model}
                    className="pf-drop-item"
                    onClick={() => pick(p)}
                  >
                    <div>
                      <div className="pf-drop-item-model">{p.model}</div>
                      {p.description && (
                        <div className="pf-drop-item-desc">{p.description}</div>
                      )}
                    </div>
                    {p.listPrice && (
                      <div className="pf-drop-item-price">
                        {fmt(p.listPrice)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* List price */}
        <div className="pf-card">
          <div className="pf-section-title">List price (ex-GST)</div>
          <input
            className="pf-price-input"
            type="number"
            value={listPrice}
            placeholder="Auto-filled on model selection"
            onChange={(e) =>
              setListPrice(e.target.value === "" ? "" : +e.target.value)
            }
          />
        </div>

        {/* Discount */}
        <div className="pf-card">
          <div className="pf-section-title">Customer discount</div>
          <div className="pf-chips">
            {DISCS.map((dc) => (
              <button
                key={dc}
                className={`pf-chip${activeDisc === dc ? " on" : ""}`}
                onClick={() => {
                  setDisc(dc);
                  setActiveDisc(dc);
                }}
              >
                {dc}%
              </button>
            ))}
          </div>
          <div className="pf-other">
            <span
              style={{ fontSize: 12, color: "#8896B0", whiteSpace: "nowrap" }}
            >
              Other discount
            </span>
            <input
              type="number"
              min={0}
              max={100}
              value={activeDisc !== null ? "" : disc === "" ? "" : String(disc)}
              placeholder="Type %"
              onFocus={() => setActiveDisc(null)}
              onChange={(e) => {
                const v =
                  e.target.value === "" ? "" : Math.min(100, +e.target.value);
                setDisc(v);
                setActiveDisc(null);
              }}
            />
          </div>
        </div>

        {/* Results */}
        {hasCalc && (
          <div className="pf-result-card">
            <div className="pf-result-grid">
              <div className="pf-result-cell">
                <div className="pf-result-label">Price ex-GST</div>
                <div className="pf-result-value">{fmt(custExGst)}</div>
                <div className="pf-result-sub">after {d}% discount</div>
              </div>
              <div className="pf-result-cell">
                <div className="pf-result-label">Incl. GST (18%)</div>
                <div className="pf-result-value">{fmt(custIncl)}</div>
                <div className="pf-result-sub">+{fmt(custGst)} GST</div>
              </div>
            </div>

            {selectedModel && (
              <div className="pf-stock-row">
                <div className="pf-stock-pill">
                  <span className="pf-stock-loc">Kochi</span>
                  <span
                    className={`pf-stock-qty ${kochiQty > 0 ? "in" : "out"}`}
                  >
                    {lotLoading ? "…" : `${kochiQty} units`}
                  </span>
                </div>
                <div className="pf-stock-pill">
                  <span className="pf-stock-loc">Bangalore</span>
                  <span
                    className={`pf-stock-qty ${bloreQty > 0 ? "in" : "out"}`}
                  >
                    {lotLoading ? "…" : `${bloreQty} units`}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Stock without results */}
        {!hasCalc && selectedModel && (
          <div className="pf-result-card">
            <div className="pf-stock-row" style={{ border: "none" }}>
              <div className="pf-stock-pill">
                <span className="pf-stock-loc">Kochi</span>
                <span className={`pf-stock-qty ${kochiQty > 0 ? "in" : "out"}`}>
                  {lotLoading ? "…" : `${kochiQty} units`}
                </span>
              </div>
              <div className="pf-stock-pill">
                <span className="pf-stock-loc">Bangalore</span>
                <span className={`pf-stock-qty ${bloreQty > 0 ? "in" : "out"}`}>
                  {lotLoading ? "…" : `${bloreQty} units`}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="pf-footer">
          <div className="pf-ydivider" />
          <strong>TMCI Technology Private Limited</strong>
          <br />
          Authorised Fluke Dealer · Kerala &amp; Karnataka
          <br />
          GST: 32AAECT4944P1ZW
          <div style={{ marginTop: 12, fontSize: 10, color: "#D0D4DC" }}>
            Developed by Sushanth P
          </div>
        </div>
      </div>
    </>
  );
}
