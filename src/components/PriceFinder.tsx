"use client";
import { useState, useEffect, useMemo, useRef } from "react";

interface Props {
  products: any[];
}

const DISCS = [22, 25, 28, 30];
const GST = 18;
const fmt = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const fmtD = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

export default function PriceFinder({ products }: Props) {
  const [open, setOpen] = useState(false);
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
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

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
      // Fetch both locations in parallel
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

  // Calculations
  const lp = +(listPrice || 0);
  const d = +(disc || 0);
  const fifoK = lot?.kochi?.found ? lot.kochi.fifoPrice : 0;
  const fifoB = lot?.bangalore?.found ? lot.bangalore.fifoPrice : 0;
  const fifo = fifoK || fifoB || 0; // use whichever location has stock for margin calc
  const purchDisc = lp > 0 && fifo > 0 ? ((lp - fifo) / lp) * 100 : 0;
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
        .pf-trigger {
          display: inline-flex; align-items: center; gap: 5px;
          background: transparent; border: 1px solid var(--border);
          border-radius: 6px; padding: 4px 10px; font-size: 11px;
          color: var(--text-dim); cursor: pointer; white-space: nowrap; transition: all 0.12s;
        }
        .pf-trigger:hover, .pf-trigger.on {
          border-color: var(--accent); color: var(--accent); background: rgba(59,130,246,0.07);
        }
        .pf-panel {
          position: fixed; top: 52px; right: 12px;
          width: 380px; max-width: calc(100vw - 24px);
          max-height: calc(100vh - 70px); overflow-y: auto;
          z-index: 200; background: var(--bg-card);
          border: 1px solid var(--border); border-radius: 12px;
          box-shadow: 0 16px 48px rgba(0,0,0,0.5);
          animation: pfin 0.14s ease;
        }
        @keyframes pfin { from{opacity:0;transform:translateY(-5px)} to{opacity:1;transform:translateY(0)} }
        .pf-panel input, .pf-panel select { font-size: 16px !important; }
        .pf-row { border-bottom: 1px solid var(--border); padding: 14px 16px; }
        .pf-row:last-child { border-bottom: none; }
        .pf-search-box {
          display: flex; align-items: center; gap: 10px;
          background: var(--bg-input); border: 1px solid var(--border);
          border-radius: 10px; padding: 11px 13px; cursor: text;
        }
        .pf-search-box.active { border-color: var(--accent); }
        .pf-drop {
          position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 299;
          background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4); overflow: hidden;
        }
        .pf-drop-item {
          display: flex; justify-content: space-between; align-items: center;
          padding: 12px 14px; cursor: pointer; border-bottom: 1px solid var(--border); gap: 8px;
        }
        .pf-drop-item:last-child { border-bottom: none; }
        .pf-drop-item:active { background: rgba(59,130,246,0.08); }
        .pf-chips { display: flex; gap: 6px; margin-bottom: 8px; }
        .pf-chip {
          flex: 1; text-align: center; padding: 11px 0;
          border-radius: 8px; font-size: 15px; font-weight: 500;
          border: 1px solid var(--border); background: var(--bg-input);
          color: var(--text-dim); cursor: pointer; transition: all 0.1s;
        }
        .pf-chip:active { opacity: 0.7; }
        .pf-chip.on {
          background: rgba(59,130,246,0.1); border-color: var(--accent);
          color: var(--accent); border-width: 1.5px;
        }
        .pf-other {
          display: flex; align-items: center; gap: 10px;
          background: var(--bg-input); border: 1px solid var(--border);
          border-radius: 8px; padding: 9px 12px;
        }
        .pf-results { background: var(--bg-input); }
        .pf-result-grid { display: grid; grid-template-columns: 1fr 1fr; }
        .pf-result-cell { padding: 16px; }
        .pf-result-cell:first-child { border-right: 1px solid var(--border); }
        .pf-result-label { font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 5px; }
        .pf-result-value { font-size: 26px; font-weight: 500; line-height: 1; }
        .pf-result-sub { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
        .pf-margin-row {
          padding: 14px 16px; display: flex; align-items: center;
          justify-content: space-between; border-top: 1px solid var(--border);
        }
        .pf-stock-row {
          display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
          padding: 12px 16px; border-top: 1px solid var(--border);
          background: var(--bg-card);
        }
        .pf-stock-pill {
          display: flex; align-items: center; justify-content: space-between;
          background: var(--bg-input); border: 1px solid var(--border);
          border-radius: 7px; padding: 8px 10px;
        }
        @media (max-width: 860px) {
          .pf-panel {
            top: 0; right: 0; left: 0; bottom: 0;
            width: 100vw; max-width: 100vw;
            height: 100dvh; max-height: 100dvh;
            border-radius: 0; border: none;
          }
          :root { --pf-backdrop-display: none; }
        }
      `}</style>

      {/* Trigger */}
      <button
        className={`pf-trigger${open ? " on" : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span style={{ fontSize: 13 }}>⚡</span> Price finder
      </button>

      {/* Backdrop (desktop only) */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 199,
            background: "transparent",
            display: "var(--pf-backdrop-display, block)",
          }}
        />
      )}

      {/* Panel */}
      {open && (
        <div
          className="pf-panel"
          onTouchStart={(e) => {
            touchStartX.current = e.touches[0].clientX;
          }}
          onTouchEnd={(e) => {
            if (touchStartX.current === null) return;
            if (e.changedTouches[0].clientX - touchStartX.current > 80)
              setOpen(false);
            touchStartX.current = null;
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 16px",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-card)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>⚡</span>
              <span
                style={{ fontSize: 15, fontWeight: 500, color: "var(--text)" }}
              >
                Price finder
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {query && (
                <button
                  onClick={reset}
                  style={{
                    fontSize: 12,
                    padding: "5px 10px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "transparent",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                  }}
                >
                  Clear
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 22,
                  lineHeight: 1,
                  padding: "0 2px",
                }}
              >
                ×
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="pf-row" style={{ position: "relative" }}>
            <div
              className={`pf-search-box${dropOpen && query ? " active" : ""}`}
              onClick={() => inputRef.current?.focus()}
            >
              <span style={{ fontSize: 16, color: "var(--text-muted)" }}>
                🔍
              </span>
              <input
                ref={inputRef}
                type="text"
                value={query}
                placeholder="Search model…"
                autoComplete="off"
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "var(--text)",
                  fontWeight: query ? 500 : 400,
                }}
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
                <span
                  onClick={openDs}
                  style={{
                    cursor: "pointer",
                    fontSize: 16,
                    color:
                      dsState === "none"
                        ? "var(--text-muted)"
                        : "var(--accent)",
                  }}
                >
                  {dsState === "loading" ? "⏳" : "📄"}
                </span>
              )}
            </div>

            {dropOpen && filtered.length > 0 && (
              <>
                <div
                  onClick={() => setDropOpen(false)}
                  style={{
                    position: "fixed",
                    inset: 0,
                    zIndex: 298,
                    background: "transparent",
                  }}
                />
                <div className="pf-drop">
                  {filtered.map((p) => (
                    <div
                      key={p.model}
                      className="pf-drop-item"
                      onClick={() => pick(p)}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 15,
                            fontWeight: 500,
                            color: "var(--text)",
                          }}
                        >
                          {p.model}
                        </div>
                        {p.description && (
                          <div
                            style={{
                              fontSize: 12,
                              color: "var(--text-muted)",
                              marginTop: 2,
                            }}
                          >
                            {p.description}
                          </div>
                        )}
                      </div>
                      {p.listPrice && (
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 500,
                            color: "var(--accent)",
                            flexShrink: 0,
                          }}
                        >
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
          <div className="pf-row">
            <div
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                marginBottom: 6,
              }}
            >
              List price (ex-GST)
            </div>
            <input
              type="number"
              value={listPrice}
              placeholder="Auto-filled on selection"
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--bg-input)",
                color: "var(--text)",
                fontWeight: 500,
              }}
              onChange={(e) =>
                setListPrice(e.target.value === "" ? "" : +e.target.value)
              }
            />
          </div>

          {/* Discount */}
          <div className="pf-row">
            <div
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                marginBottom: 8,
              }}
            >
              Customer discount
            </div>
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
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  whiteSpace: "nowrap",
                }}
              >
                Other discount
              </span>
              <input
                type="number"
                min={0}
                max={100}
                value={
                  activeDisc !== null ? "" : disc === "" ? "" : String(disc)
                }
                placeholder="Type %"
                style={{
                  flex: 1,
                  background: "var(--bg-input)",
                  border: "none",
                  outline: "none",
                  color: "var(--text)",
                  textAlign: "center",
                  fontWeight: 500,
                  fontSize: "16px",
                }}
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
            <div className="pf-results">
              <div
                className="pf-result-grid"
                style={{ borderTop: "1px solid var(--border)" }}
              >
                <div className="pf-result-cell">
                  <div
                    className="pf-result-label"
                    style={{ color: "var(--accent-green)" }}
                  >
                    Ex-GST
                  </div>
                  <div
                    className="pf-result-value"
                    style={{ color: "var(--accent-green)" }}
                  >
                    {fmt(custExGst)}
                  </div>
                  <div className="pf-result-sub">after {d}% disc</div>
                </div>
                <div className="pf-result-cell">
                  <div
                    className="pf-result-label"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Incl. GST
                  </div>
                  <div
                    className="pf-result-value"
                    style={{ color: "var(--text)" }}
                  >
                    {fmt(custIncl)}
                  </div>
                  <div className="pf-result-sub">+{fmt(custGst)} GST</div>
                </div>
              </div>

              {fifo > 0 && (
                <div
                  className="pf-margin-row"
                  style={{
                    background: profitable
                      ? "rgba(34,197,94,0.08)"
                      : "rgba(239,68,68,0.07)",
                    borderTopColor: profitable
                      ? "rgba(34,197,94,0.2)"
                      : "rgba(239,68,68,0.2)",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: profitable
                          ? "var(--accent-green)"
                          : "var(--accent-red)",
                      }}
                    >
                      Your margin
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        marginTop: 3,
                        color: profitable
                          ? "var(--accent-green)"
                          : "var(--accent-red)",
                        opacity: 0.8,
                      }}
                    >
                      {profitable ? "+" : ""}
                      {fmt(margin)} / unit
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 34,
                      fontWeight: 500,
                      lineHeight: 1,
                      color: profitable
                        ? "var(--accent-green)"
                        : "var(--accent-red)",
                    }}
                  >
                    {marginPct.toFixed(1)}%
                  </span>
                </div>
              )}

              {/* Stock */}
              {selectedModel && (
                <div className="pf-stock-row">
                  <div className="pf-stock-pill">
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Kochi
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color:
                          kochiQty > 0
                            ? "var(--accent-green)"
                            : "var(--text-muted)",
                      }}
                    >
                      {lotLoading ? "…" : `${kochiQty} units`}
                    </span>
                  </div>
                  <div className="pf-stock-pill">
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Bangalore
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color:
                          bloreQty > 0
                            ? "var(--accent-green)"
                            : "var(--text-muted)",
                      }}
                    >
                      {lotLoading ? "…" : `${bloreQty} units`}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Stock without results (model selected but no list price yet) */}
          {!hasCalc && selectedModel && (
            <div
              className="pf-stock-row"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              <div className="pf-stock-pill">
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Kochi
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color:
                      kochiQty > 0
                        ? "var(--accent-green)"
                        : "var(--text-muted)",
                  }}
                >
                  {lotLoading ? "…" : `${kochiQty} units`}
                </span>
              </div>
              <div className="pf-stock-pill">
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Bangalore
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color:
                      bloreQty > 0
                        ? "var(--accent-green)"
                        : "var(--text-muted)",
                  }}
                >
                  {lotLoading ? "…" : `${bloreQty} units`}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
