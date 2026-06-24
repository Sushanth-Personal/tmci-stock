"use client";
import { useState, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import DatasheetButton from "@/components/DatasheetButton";

interface Props {
  products: any[];
}
interface LineItem {
  desc: string;
  qty: number;
  rate: number;
  disc: number;
  instock: boolean;
  leadtime: string;
}

const FG = ({ label, children, full }: any) => (
  <div style={{ gridColumn: full ? "1/-1" : undefined }}>
    <label>{label}</label>
    {children}
  </div>
);
function fmt(v: number) {
  return v.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function fmtInt(v: number) {
  return Math.round(v).toLocaleString("en-IN");
}
function fmtDate(val: string) {
  if (!val) return "—";
  return new Date(val).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Searchable product combobox for a quotation line item.
// Searches model, category, AND item code. Selecting a product auto-fills
// the List Rate. Free typing still works for custom line items.
//
// The dropdown panel is rendered via a portal into document.body with
// position:fixed, anchored to the input's live bounding rect. This is
// necessary because the line-items table wraps in a horizontally
// scrolling div (overflowX: auto) — and setting overflow on one axis
// implicitly sets the other axis to auto too, which clips (and eats
// clicks on) any normal absolutely-positioned dropdown rendered inside
// it. Going through a portal sidesteps that clipping completely.
// ─────────────────────────────────────────────────────────────────────────
function LineItemCombobox({
  products,
  value,
  onTextChange,
  onSelect,
}: {
  products: any[];
  value: string;
  onTextChange: (text: string) => void;
  onSelect: (product: any) => void;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      const model = (p.model || "").toLowerCase();
      const cat = (p.category || "").toLowerCase();
      const code = String(p.itemCode || "").toLowerCase();
      return model.includes(q) || cat.includes(q) || code.includes(q);
    });
  }, [products, query]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  // Recompute the input's on-screen position so the portal can anchor to it.
  const updatePosition = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left, width: r.width });
  };

  // 'scroll' events don't bubble, but a capturing listener on window still
  // fires for scrolls on any nested scrollable ancestor (e.g. the table's
  // overflowX wrapper) because capture happens on the way down to the
  // target, regardless of bubbling.
  useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  // Click-outside needs to check both the input wrapper AND the portaled
  // dropdown, since the dropdown now lives in document.body, not inside
  // wrapRef.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideInput = wrapRef.current?.contains(target);
      const insideDropdown = dropdownRef.current?.contains(target);
      if (!insideInput && !insideDropdown) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const choose = (p: any) => {
    setQuery(p.model);
    onSelect(p);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlight]) choose(filtered[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const dropdown =
    open && pos
      ? createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: Math.max(pos.width, 280),
              zIndex: 1000,
              background: "var(--bg-input)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              maxHeight: 260,
              overflowY: "auto",
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            }}
          >
            {filtered.length === 0 ? (
              <div
                style={{
                  padding: "8px 10px",
                  fontSize: 12,
                  color: "var(--text-muted)",
                }}
              >
                No matching products — you can type a custom line item
              </div>
            ) : (
              filtered.map((p, i) => (
                <div
                  key={p.model}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(p);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  style={{
                    padding: "7px 10px",
                    fontSize: 12,
                    cursor: "pointer",
                    background:
                      i === highlight ? "rgba(59,130,246,0.15)" : "transparent",
                    color: i === highlight ? "var(--text)" : "var(--text-dim)",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <span style={{ fontWeight: 500, color: "var(--text)" }}>
                    {p.model}
                    {p.category ? (
                      <span
                        style={{ color: "var(--text-muted)", fontWeight: 400 }}
                      >
                        {" "}
                        ({p.category})
                      </span>
                    ) : null}
                  </span>
                  <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>
                    {p.itemCode} · ₹{(p.listPrice || 0).toLocaleString("en-IN")}
                  </span>
                </div>
              ))
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder="Search model, category, item code… or type custom item"
        onChange={(e) => {
          setQuery(e.target.value);
          onTextChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {dropdown}
    </div>
  );
}

export default function Quotation({ products }: Props) {
  const today = new Date().toISOString().split("T")[0];
  const validTill = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const [qnum, setQnum] = useState("Quote/26-27/KL/001");
  const [qdate, setQdate] = useState(today);
  const [qvalid, setQvalid] = useState(validTill);
  const [cname, setCname] = useState("");
  const [lines, setLines] = useState<LineItem[]>([
    {
      desc: "",
      qty: 1,
      rate: 0,
      disc: 0,
      instock: true,
      leadtime: "",
    },
  ]);
  const [gstRate, setGstRate] = useState(18);
  const [copied, setCopied] = useState(false);
  const [subCopied, setSubCopied] = useState(false);

  const addLine = () =>
    setLines((prev) => [
      ...prev,
      {
        desc: "",
        qty: 1,
        rate: 0,
        disc: 0,
        instock: true,
        leadtime: "",
      },
    ]);
  const removeLine = (i: number) =>
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  const setLine = (i: number, key: keyof LineItem, val: any) =>
    setLines((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, [key]: val } : l)),
    );

  const sub = useMemo(
    () => lines.reduce((s, l) => s + l.qty * l.rate * (1 - l.disc / 100), 0),
    [lines],
  );
  const gstAmt = (sub * gstRate) / 100;
  const total = sub + gstAmt;

  // ── Opening message ───────────────────────────────────────────────────
  // Default greeting is auto-generated from customer name + the line-item
  // discounts. It auto-detects a single uniform discount % across all
  // discounted lines (e.g. "22%") and mentions it directly; if discounts
  // vary across lines, it falls back to a generic mention rather than
  // guessing a number. Once the user edits the textarea, auto-regeneration
  // stops (introEdited = true) so their wording is never silently
  // overwritten — "Reset to default" brings the auto-text back.
  const defaultIntro = useMemo(() => {
    const salutation = cname ? `Dear ${cname},` : "Dear Sir/Madam,";
    const discountedLines = lines.filter((l) => l.disc > 0);
    let discountLine = "";
    if (discountedLines.length > 0) {
      const uniqueDiscs = new Set(discountedLines.map((l) => l.disc));
      discountLine =
        uniqueDiscs.size === 1
          ? `\n\nWe are pleased to offer a special discount of ${[...uniqueDiscs][0]}% on the listed items.`
          : "\n\nWe are pleased to offer a special discount on the listed items.";
    }
    return (
      `${salutation}\n\nHope you are doing well!\n\n` +
      `Please find below our quotation for your reference.${discountLine}`
    );
  }, [cname, lines]);

  const [introText, setIntroText] = useState(defaultIntro);
  const [introEdited, setIntroEdited] = useState(false);

  useEffect(() => {
    if (!introEdited) setIntroText(defaultIntro);
  }, [defaultIntro, introEdited]);

  const emailBody = useMemo(() => {
    const itemBlock =
      lines.length === 0
        ? "  (no items added)"
        : lines
            .map((l, i) => {
              const unitAfterDisc = l.rate * (1 - l.disc / 100);
              const lineTotal = unitAfterDisc * l.qty;
              const rows = [];
              rows.push(`  ${i + 1}.  ${l.desc || "Unnamed item"}`);
              rows.push(`      List price     :  ₹${fmtInt(l.rate)}`);
              if (l.disc > 0) {
                rows.push(`      Discount       :  ${l.disc}%`);
                rows.push(`      Price after disc :  ₹${fmt(unitAfterDisc)}`);
              }
              rows.push(`      Qty            :  ${l.qty}`);
              rows.push(`      Line total     :  ₹${fmt(lineTotal)}`);
              rows.push(
                `      Availability   :  ${l.instock ? "✓ In stock" : "✕ Not in stock"}`,
              );
              rows.push(
                `      Delivery       :  ${l.instock ? "Immediate" : l.leadtime || "To be confirmed"}`,
              );
              return rows.join("\n");
            })
            .join("\n\n");
    return (
      introText.trim() +
      "\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nQUOTATION DETAILS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
      `Quote No   : ${qnum}\n` +
      `Date       : ${fmtDate(qdate)}\n` +
      `Valid till : ${fmtDate(qvalid)}\n` +
      (cname ? `Customer   : ${cname}\n` : "") +
      "\nITEMS\n─────────────────────────────────\n\n" +
      itemBlock +
      "\n\n─────────────────────────────────\n" +
      `Sub total  : ₹${fmt(sub)}\n` +
      `GST (${gstRate}%)  : ₹${fmt(gstAmt)}\n` +
      `TOTAL      : ₹${fmt(total)}\n` +
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nKindly confirm your acceptance or revert with any queries."
    );
  }, [
    introText,
    lines,
    qnum,
    qdate,
    qvalid,
    cname,
    gstRate,
    sub,
    gstAmt,
    total,
  ]);

  const subject = `Quotation ${qnum} — TMCI Technology${cname ? ` for ${cname}` : ""}`;
  const copyEmail = () => {
    navigator.clipboard.writeText(emailBody).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  const copySubject = () => {
    navigator.clipboard.writeText(subject).then(() => {
      setSubCopied(true);
      setTimeout(() => setSubCopied(false), 2000);
    });
  };

  const card: React.CSSProperties = {
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "12px 14px",
  };
  const sectionLabel: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 500,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 10,
  };
  const grid2: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Quote reference */}
      <div style={card}>
        <div style={sectionLabel}>Quote reference</div>
        <div style={grid2}>
          <FG label="Quote number">
            <input value={qnum} onChange={(e) => setQnum(e.target.value)} />
          </FG>
          <FG label="Quote date">
            <input
              type="date"
              value={qdate}
              onChange={(e) => setQdate(e.target.value)}
            />
          </FG>
          <FG label="Valid until">
            <input
              type="date"
              value={qvalid}
              onChange={(e) => setQvalid(e.target.value)}
            />
          </FG>
          <FG label="Customer name">
            <input
              value={cname}
              onChange={(e) => setCname(e.target.value)}
              placeholder="e.g. FITEC POWER"
            />
          </FG>
        </div>
      </div>

      {/* Line items */}
      <div style={card}>
        <div
          style={{
            ...sectionLabel,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>Line items</span>
          <button
            className="btn-primary"
            style={{ fontSize: 11, padding: "3px 10px" }}
            onClick={addLine}
          >
            + Add item
          </button>
        </div>
        <div
          style={{
            overflowX: "auto",
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}
        >
          <table style={{ minWidth: 780 }}>
            <thead>
              <tr>
                <th style={{ width: 24 }}>#</th>
                <th style={{ minWidth: 130 }}>Product / Model</th>
                <th style={{ width: 60 }}>Qty</th>
                <th style={{ width: 95 }}>List Rate (₹)</th>
                <th style={{ width: 78 }}>Disc %</th>
                <th style={{ width: 95 }}>After Disc (₹)</th>
                <th style={{ width: 95 }}>Line Total (₹)</th>
                <th style={{ width: 105 }}>Availability</th>
                <th style={{ width: 115 }}>Delivery / Lead time</th>
                <th style={{ width: 28 }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const unitAfterDisc = l.rate * (1 - l.disc / 100);
                const lineTotal = unitAfterDisc * l.qty;
                return (
                  <tr key={i}>
                    <td style={{ color: "var(--text-muted)", fontSize: 11 }}>
                      {i + 1}
                    </td>
                    <td>
                      <LineItemCombobox
                        products={products}
                        value={l.desc}
                        onTextChange={(text) => setLine(i, "desc", text)}
                        onSelect={(p) => {
                          setLine(i, "desc", p.model);
                          setLine(i, "rate", p.listPrice || 0);
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={l.qty === 0 ? "" : String(l.qty)}
                        placeholder="1"
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^0-9.]/g, "");
                          setLine(i, "qty", v === "" ? 0 : parseFloat(v));
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={l.rate === 0 ? "" : String(l.rate)}
                        placeholder="0"
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^0-9.]/g, "");
                          setLine(i, "rate", v === "" ? 0 : parseFloat(v));
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={l.disc === 0 ? "" : String(l.disc)}
                        placeholder="0"
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^0-9.]/g, "");
                          const n = v === "" ? 0 : parseFloat(v);
                          setLine(i, "disc", Math.min(100, n));
                        }}
                      />
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        fontSize: 11,
                        color: "var(--text-dim)",
                      }}
                    >
                      ₹{fmt(unitAfterDisc)}
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        fontSize: 11,
                        fontWeight: 500,
                      }}
                    >
                      ₹{fmt(lineTotal)}
                    </td>
                    <td>
                      <select
                        value={l.instock ? "true" : "false"}
                        onChange={(e) =>
                          setLine(i, "instock", e.target.value === "true")
                        }
                      >
                        <option value="true">In stock</option>
                        <option value="false">Not in stock</option>
                      </select>
                    </td>
                    <td>
                      {l.instock ? (
                        <span
                          style={{ fontSize: 11, color: "var(--accent-green)" }}
                        >
                          Immediate
                        </span>
                      ) : (
                        <input
                          value={l.leadtime}
                          onChange={(e) =>
                            setLine(i, "leadtime", e.target.value)
                          }
                          placeholder="e.g. 7 days"
                          style={{ borderColor: "rgba(239,68,68,.4)" }}
                        />
                      )}
                    </td>
                    <td>
                      <button
                        onClick={() => removeLine(i)}
                        style={{
                          background: "transparent",
                          border: "1px solid rgba(239,68,68,.3)",
                          borderRadius: 4,
                          color: "var(--accent-red)",
                          fontSize: 10,
                          padding: "2px 7px",
                          cursor: "pointer",
                        }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Totals */}
        <div
          style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10 }}
        >
          <div style={{ flex: 1, minWidth: 120 }}>
            <label>GST rate</label>
            <select
              value={gstRate}
              onChange={(e) => setGstRate(+e.target.value)}
            >
              <option value={5}>5%</option>
              <option value={12}>12%</option>
              <option value={18}>18%</option>
              <option value={28}>28%</option>
            </select>
          </div>
          <div
            style={{
              background: "var(--bg-input)",
              borderRadius: 8,
              padding: "8px 14px",
              flex: 2,
              minWidth: 200,
              display: "flex",
              flexDirection: "column",
              gap: 3,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                color: "var(--text-dim)",
              }}
            >
              <span>Sub total</span>
              <span>₹{fmt(sub)}</span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                color: "var(--text-dim)",
              }}
            >
              <span>GST ({gstRate}%)</span>
              <span>₹{fmt(gstAmt)}</span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--text)",
                borderTop: "1px solid var(--border)",
                paddingTop: 4,
                marginTop: 2,
              }}
            >
              <span>Total (incl. GST)</span>
              <span>₹{fmt(total)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Opening message — default-generated, fully editable */}
      <div style={card}>
        <div
          style={{
            ...sectionLabel,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>Opening message</span>
          {introEdited && (
            <button
              className="btn-ghost"
              style={{ fontSize: 10, padding: "3px 9px" }}
              onClick={() => setIntroEdited(false)}
            >
              ↺ Reset to default
            </button>
          )}
        </div>
        <textarea
          value={introText}
          onChange={(e) => {
            setIntroText(e.target.value);
            setIntroEdited(true);
          }}
          rows={6}
          style={{
            width: "100%",
            resize: "vertical",
            fontFamily: "inherit",
            lineHeight: 1.6,
          }}
        />
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 6 }}>
          Auto-fills from customer name &amp; line-item discounts. Once you edit
          it, your wording stays — use "Reset to default" to regenerate.
        </div>
      </div>

      {/* Generated email */}
      <div style={card}>
        <div style={sectionLabel}>Generated email</div>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginBottom: 10,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: "var(--text-dim)",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            Subject:
          </span>
          <input readOnly value={subject} style={{ flex: 1 }} />
          <button
            className="btn-ghost"
            style={{ fontSize: 11, padding: "5px 12px", flexShrink: 0 }}
            onClick={copySubject}
          >
            {subCopied ? "✓ Copied" : "Copy"}
          </button>
        </div>
        <div
          style={{
            background: "var(--bg-input)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "14px 16px",
            fontSize: 12,
            color: "var(--text-dim)",
            lineHeight: 1.75,
            whiteSpace: "pre-wrap",
            fontFamily: "inherit",
          }}
        >
          {emailBody}
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            marginTop: 8,
          }}
        >
          <button className="btn-primary" onClick={copyEmail}>
            {copied ? "✓ Copied!" : "Copy email body"}
          </button>
        </div>
        {lines.length > 0 && lines.some((l) => l.desc) && (
          <div style={card}>
            <div style={sectionLabel}>
              Datasheets for items in this quotation
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              {lines
                .filter((l) => l.desc)
                .map((l, i) => (
                  <div
                    key={i}
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
                      {l.desc}
                    </span>
                    <DatasheetButton model={l.desc} />
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
