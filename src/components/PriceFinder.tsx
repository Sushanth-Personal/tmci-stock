"use client";
import { useState, useEffect, useMemo, useRef } from "react";

interface Props {
  products: any[];
}

const DISCS = [22, 25, 28, 30];
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
  const [disc, setDisc] = useState<number | "">(30);
  const [activeDisc, setActiveDisc] = useState<number | null>(30);
  const [gst, setGst] = useState(18);
  const [dropOpen, setDropOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [dsState, setDsState] = useState<"idle" | "loading" | "none">("idle");
  const [lot, setLot] = useState<any>(null);
  const [lotLoading, setLotLoading] = useState(false);
  const [location, setLocation] = useState("Kochi");
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

  const fetchLot = async (model: string, loc: string) => {
    setLotLoading(true);
    setLot(null);
    try {
      const r = await fetch(
        `/api/lot-cost?model=${encodeURIComponent(model)}&location=${encodeURIComponent(loc)}`,
      );
      const d = await r.json();
      setLot(d);
    } catch {}
    setLotLoading(false);
  };

  const pick = (p: any) => {
    setQuery(p.model);
    setSelectedModel(p.model);
    setListPrice(p.listPrice ?? "");
    setDropOpen(false);
    setDsState("idle");
    fetchLot(p.model, location);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selectedModel) fetchLot(selectedModel, location);
  }, [location]);

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

  // ── Calculations ───────────────────────────────────────────────────────────
  const lp = +(listPrice || 0);
  const d = +(disc || 0);

  // Your real cost from FIFO lot
  const yourCost = lot?.found ? lot.fifoPrice : 0;

  // What % off list you actually paid — e.g. cost ₹2972 on list ₹4600 = 35.4% off
  const purchaseDiscPct =
    lp > 0 && yourCost > 0 ? ((lp - yourCost) / lp) * 100 : 0;

  // What customer pays
  const custExGst = lp * (1 - d / 100);
  const custGst = (custExGst * gst) / 100;
  const custIncl = custExGst + custGst;

  // Margin in ₹ = customer ex-GST − your cost
  const margin = yourCost > 0 && custExGst > 0 ? custExGst - yourCost : 0;

  // Margin % = spread on list price
  // bought 35.4% off list, selling 22% off list → 35.4 − 22 = 13.4% of list
  const marginPct =
    lp > 0 && yourCost > 0 ? ((custExGst - yourCost) / lp) * 100 : 0;

  const profitable = margin > 0;
  const hasCalc = lp > 0 && d >= 0;

  return (
    <>
      <style>{`
        .pf-btn { display:inline-flex; align-items:center; gap:5px; background:transparent;
          border:1px solid var(--border); border-radius:6px; padding:4px 10px; font-size:11px;
          color:var(--text-dim); cursor:pointer; white-space:nowrap; transition:all 0.12s; }
        .pf-btn:hover,.pf-btn.on { border-color:var(--accent); color:var(--accent); background:rgba(59,130,246,0.07); }
        .pf-panel { position:fixed; top:52px; right:12px; width:420px; max-width:calc(100vw - 24px);
          z-index:200; background:var(--bg-card); border:1px solid var(--border); border-radius:12px;
          box-shadow:0 16px 48px rgba(0,0,0,0.5); padding:16px; animation:pfin 0.14s ease;
          max-height:calc(100vh - 70px); overflow-y:auto; }
        @keyframes pfin { from{opacity:0;transform:translateY(-5px)} to{opacity:1;transform:translateY(0)} }
        @media(max-width:860px){
          .pf-panel {
            top:0 !important; right:0 !important; left:0 !important; bottom:0 !important;
            width:100vw !important; max-width:100vw !important;
            max-height:100vh !important; height:100vh !important;
            border-radius:0 !important; border:none !important;
            padding:20px 16px !important;
          }
        }
        .pf-dchip { font-size:13px; font-weight:600; padding:7px 16px; border-radius:8px;
          border:1px solid var(--border); background:var(--bg-input); color:var(--text-dim);
          cursor:pointer; transition:all 0.12s; }
        .pf-dchip:hover { border-color:var(--accent); color:var(--accent); }
        .pf-dchip.on { background:var(--accent); border-color:var(--accent); color:#fff; }
        .pf-drop { position:absolute; top:calc(100% + 4px); left:0; right:0; z-index:299;
          background:var(--bg-input); border:1px solid var(--border); border-radius:8px;
          max-height:200px; overflow-y:auto; box-shadow:0 8px 24px rgba(0,0,0,0.4); }
        .pf-drop-item { padding:8px 10px; cursor:pointer; border-bottom:1px solid var(--border);
          font-size:12px; display:flex; justify-content:space-between; align-items:center; gap:8px; }
        .pf-drop-item:last-child { border-bottom:none; }
        .pf-drop-item:hover { background:rgba(59,130,246,0.08); }
        .pf-row { display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; margin-top:12px; }
        .pf-card { border-radius:8px; padding:10px 12px; border:1px solid var(--border); background:var(--bg-input); }
        .pf-card.green  { background:rgba(34,197,94,0.08);  border-color:rgba(34,197,94,0.25); }
        .pf-card.green-s{ background:rgba(34,197,94,0.14);  border-color:rgba(34,197,94,0.4);  }
        .pf-card.red    { background:rgba(239,68,68,0.08);  border-color:rgba(239,68,68,0.25); }
        .pf-card-l { font-size:9px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px; }
        .pf-card-v { font-size:20px; font-weight:700; }
        .pf-card-s { font-size:10px; color:var(--text-muted); margin-top:2px; }
        .pf-lot { font-size:11px; padding:7px 10px; border-radius:7px; margin-top:10px;
          background:rgba(245,158,11,0.06); border:1px solid rgba(245,158,11,0.25);
          display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        /* iOS zoom fix: inputs must be >= 16px to prevent autozoom on focus */
        .pf-panel input, .pf-panel select { font-size: 16px !important; }
        @media(max-width:860px){
          .pf-row { grid-template-columns:1fr 1fr; }
          :root { --pf-backdrop-display: none; }
        }
      `}</style>

      {/* ── Trigger button ── */}
      <button
        className={`pf-btn${open ? " on" : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span style={{ fontSize: 13 }}>⚡</span> Price finder
      </button>

      {/* Backdrop — desktop only. On mobile the panel fills the screen so no backdrop needed */}
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

      {/* ── Panel ── */}
      {open && (
        <div
          className="pf-panel"
          onTouchStart={(e) => {
            touchStartX.current = e.touches[0].clientX;
          }}
          onTouchEnd={(e) => {
            if (touchStartX.current === null) return;
            const dx = e.changedTouches[0].clientX - touchStartX.current;
            if (dx > 80) setOpen(false); // right swipe → close
            touchStartX.current = null;
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <span
              style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}
            >
              ⚡ Price finder
            </span>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {selectedModel && (
                <button
                  className="pf-btn"
                  style={{ fontSize: 10, padding: "3px 8px" }}
                  onClick={openDs}
                >
                  📄{" "}
                  {dsState === "loading"
                    ? "…"
                    : dsState === "none"
                      ? "Not found"
                      : "Datasheet"}
                </button>
              )}
              {query && (
                <button
                  className="btn-ghost"
                  style={{ fontSize: 10, padding: "3px 8px" }}
                  onClick={reset}
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
                  fontSize: 20,
                  lineHeight: 1,
                  padding: "0 2px",
                }}
              >
                ×
              </button>
            </div>
          </div>

          {/* Model search */}
          <div style={{ position: "relative", marginBottom: 10 }}>
            <input
              ref={inputRef}
              type="text"
              value={query}
              placeholder="Type model name…"
              autoComplete="off"
              style={{ fontSize: 14, fontWeight: 500 }}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedModel("");
                setListPrice("");
                setLot(null);
                setDropOpen(true);
              }}
              onFocus={() => query && setDropOpen(true)}
            />
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
                        <span style={{ fontWeight: 600, color: "var(--text)" }}>
                          {p.model}
                        </span>
                        {p.description && (
                          <span
                            style={{
                              marginLeft: 6,
                              fontSize: 10,
                              color: "var(--text-muted)",
                            }}
                          >
                            {p.description}
                          </span>
                        )}
                      </div>
                      {p.listPrice && (
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--accent)",
                            fontWeight: 600,
                            flexShrink: 0,
                          }}
                        >
                          ₹{p.listPrice.toLocaleString("en-IN")}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* List price + GST */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 8,
              marginBottom: 14,
              alignItems: "end",
            }}
          >
            <div>
              <label
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  display: "block",
                  marginBottom: 3,
                }}
              >
                LIST PRICE (₹ EX-GST)
              </label>
              <input
                type="number"
                value={listPrice}
                placeholder="Auto-filled or enter manually"
                onChange={(e) =>
                  setListPrice(e.target.value === "" ? "" : +e.target.value)
                }
              />
            </div>
            <div>
              <label
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  display: "block",
                  marginBottom: 3,
                }}
              >
                GST
              </label>
              <select
                value={gst}
                onChange={(e) => setGst(+e.target.value)}
                style={{ width: 80 }}
              >
                {[5, 12, 18, 28].map((g) => (
                  <option key={g} value={g}>
                    {g}%
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Discount chips */}
          <label
            style={{
              fontSize: 10,
              color: "var(--text-muted)",
              display: "block",
              marginBottom: 6,
            }}
          >
            CUSTOMER DISCOUNT
          </label>
          <div
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              marginBottom: 4,
            }}
          >
            {DISCS.map((dc) => (
              <button
                key={dc}
                className={`pf-dchip${activeDisc === dc ? " on" : ""}`}
                onClick={() => {
                  setDisc(dc);
                  setActiveDisc(dc);
                }}
              >
                {dc}%
              </button>
            ))}
            <input
              type="number"
              min={0}
              max={100}
              value={disc === "" ? "" : String(disc)}
              placeholder="—"
              style={{
                width: 60,
                textAlign: "center",
                fontWeight: 600,
                fontSize: 13,
              }}
              onChange={(e) => {
                const v =
                  e.target.value === "" ? "" : Math.min(100, +e.target.value);
                setDisc(v);
                setActiveDisc(null);
              }}
            />
          </div>

          {/* Location toggle */}
          {selectedModel && (
            <div style={{ display: "flex", gap: 5, marginTop: 8 }}>
              {["Kochi", "Bangalore"].map((loc) => (
                <button
                  key={loc}
                  className={`pf-btn${location === loc ? " on" : ""}`}
                  style={{ fontSize: 10, padding: "3px 9px" }}
                  onClick={() => setLocation(loc)}
                >
                  {loc}
                </button>
              ))}
            </div>
          )}

          {/* FIFO lot cost */}
          {selectedModel && (
            <div className="pf-lot">
              {lotLoading ? (
                <span style={{ color: "var(--text-muted)" }}>Loading lot…</span>
              ) : lot?.found ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--text-muted)",
                        marginBottom: 2,
                      }}
                    >
                      Purchase cost
                    </div>
                    <span
                      style={{
                        fontSize: 18,
                        fontWeight: 700,
                        background: "rgba(34,197,94,0.13)",
                        color: "var(--accent-green)",
                        padding: "2px 10px",
                        borderRadius: 6,
                        display: "inline-block",
                      }}
                    >
                      {fmt(lot.fifoPrice)}
                    </span>
                  </div>
                  {lp > 0 && (
                    <div>
                      <div
                        style={{
                          fontSize: 10,
                          color: "var(--text-muted)",
                          marginBottom: 2,
                        }}
                      >
                        Purchase discount
                      </div>
                      <span
                        style={{
                          fontSize: 18,
                          fontWeight: 700,
                          color: "var(--accent-amber)",
                        }}
                      >
                        {purchaseDiscPct.toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <span style={{ fontSize: 11, color: "var(--accent-red)" }}>
                  No open lots in {location}
                </span>
              )}
            </div>
          )}

          {/* Result cards */}
          {hasCalc && (
            <div className="pf-row">
              {/* Ex-GST */}
              <div className="pf-card green">
                <div
                  className="pf-card-l"
                  style={{ color: "var(--accent-green)" }}
                >
                  Ex-GST
                </div>
                <div
                  className="pf-card-v"
                  style={{ color: "var(--accent-green)" }}
                >
                  {fmt(custExGst)}
                </div>
                <div className="pf-card-s">after {d}% disc</div>
              </div>

              {/* Incl GST */}
              <div className="pf-card">
                <div className="pf-card-l">Incl. GST</div>
                <div className="pf-card-v" style={{ color: "var(--text)" }}>
                  {fmt(custIncl)}
                </div>
                <div className="pf-card-s">+{fmt(custGst)} GST</div>
              </div>

              {/* Margin */}
              {yourCost > 0 && (
                <div className={`pf-card ${profitable ? "green-s" : "red"}`}>
                  <div
                    className="pf-card-l"
                    style={{
                      color: profitable
                        ? "var(--accent-green)"
                        : "var(--accent-red)",
                    }}
                  >
                    Your margin
                  </div>
                  <div
                    className="pf-card-v"
                    style={{
                      color: profitable
                        ? "var(--accent-green)"
                        : "var(--accent-red)",
                    }}
                  >
                    {marginPct.toFixed(1)}%
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 400,
                        marginLeft: 2,
                        color: "var(--text-muted)",
                      }}
                    >
                      of list
                    </span>
                  </div>
                  <div className="pf-card-s">
                    {profitable ? "+" : ""}
                    {fmt(margin)} / unit
                  </div>
                  <div className="pf-card-s" style={{ marginTop: 2 }}>
                    bought {purchaseDiscPct.toFixed(1)}% · sold {d}%
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
