"use client";
// src/components/Customers.tsx
//
// Full Zoho-Books-style customer management screen.
// Left: searchable list of all customers.
// Right: detail / edit panel for the selected customer.
// New customer button opens a blank edit panel.

import { useState, useEffect, useCallback, useMemo } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Customer {
  id: string;
  display_name: string;
  company_name?: string;
  salutation?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  mobile?: string;
  email?: string;
  billing_address?: string;
  billing_street2?: string;
  billing_city?: string;
  billing_state?: string;
  billing_country?: string;
  billing_pincode?: string;
  shipping_address?: string;
  shipping_street2?: string;
  shipping_city?: string;
  shipping_state?: string;
  shipping_country?: string;
  shipping_pincode?: string;
  gstin?: string;
  gst_treatment?: string;
  place_of_contact?: string;
  place_of_contact_label?: string;
  payment_terms?: string;
  customer_sub_type?: string;
  credit_limit?: number;
  status?: string;
  notes?: string;
  website?: string;
  zoho_contact_id?: string;
  created_at?: string;
}

const EMPTY: Partial<Customer> = {
  display_name: "",
  company_name: "",
  salutation: "",
  first_name: "",
  last_name: "",
  phone: "",
  mobile: "",
  email: "",
  billing_address: "",
  billing_street2: "",
  billing_city: "",
  billing_state: "",
  billing_country: "India",
  billing_pincode: "",
  shipping_address: "",
  shipping_street2: "",
  shipping_city: "",
  shipping_state: "",
  shipping_country: "India",
  shipping_pincode: "",
  gstin: "",
  gst_treatment: "business_gst",
  place_of_contact: "",
  place_of_contact_label: "",
  payment_terms: "Due on Receipt",
  customer_sub_type: "business",
  credit_limit: 0,
  status: "Active",
  notes: "",
  website: "",
};

const GST_TREATMENTS: Record<string, string> = {
  business_gst: "Registered Business - Regular",
  business_none: "Registered Business - Composition",
  business_registered_composition: "Registered Business - Composition Scheme",
  overseas: "Overseas",
  consumer: "Consumer",
  tax_deductor: "Tax Deductor",
  business_sez: "SEZ",
  unregistered: "Unregistered Business",
};

const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Delhi",
  "Jammu & Kashmir",
  "Ladakh",
  "Puducherry",
  "Chandigarh",
  "Andaman & Nicobar Islands",
  "Dadra & Nagar Haveli",
  "Daman & Diu",
  "Lakshadweep",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}
function fmtDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const FG = ({ label, children, full, half }: any) => (
  <div style={{ gridColumn: full ? "1/-1" : half ? "span 1" : undefined }}>
    <label
      style={{
        fontSize: 11,
        color: "var(--text-muted)",
        display: "block",
        marginBottom: 3,
      }}
    >
      {label}
    </label>
    {children}
  </div>
);

const SL = ({ children }: any) => (
  <div
    style={{
      fontSize: 10,
      fontWeight: 600,
      color: "var(--text-muted)",
      textTransform: "uppercase",
      letterSpacing: "0.06em",
      marginBottom: 8,
      marginTop: 4,
    }}
  >
    {children}
  </div>
);

// ─── Customer Edit Panel ──────────────────────────────────────────────────────
function CustomerEdit({
  customer,
  isNew,
  onSaved,
  onDeleted,
  onCancel,
}: {
  customer: Partial<Customer>;
  isNew: boolean;
  onSaved: (c: Customer) => void;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Partial<Customer>>(customer);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sameAsBilling, setSameAsBilling] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "details" | "address" | "tax" | "other"
  >("details");

  useEffect(() => {
    setForm(customer);
    setError("");
    setSuccess("");
    setConfirmDelete(false);
    setActiveTab("details");
  }, [customer]);

  const set = (key: keyof Customer, val: any) =>
    setForm((f) => ({ ...f, [key]: val }));

  const copyBillingToShipping = () => {
    setForm((f) => ({
      ...f,
      shipping_address: f.billing_address,
      shipping_street2: f.billing_street2,
      shipping_city: f.billing_city,
      shipping_state: f.billing_state,
      shipping_country: f.billing_country,
      shipping_pincode: f.billing_pincode,
    }));
    setSameAsBilling(true);
  };

  const handleSave = async () => {
    if (!form.display_name?.trim()) {
      setError("Display name is required.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const url = isNew ? "/api/customers" : `/api/customers?id=${customer.id}`;
      const method = isNew ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || "Failed to save.");
        return;
      }
      setSuccess(isNew ? "Customer created!" : "Changes saved.");
      setTimeout(() => {
        setSuccess("");
        onSaved(d.customer);
      }, 1200);
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!customer.id) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/customers?id=${customer.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError("Failed to delete.");
        return;
      }
      onDeleted();
    } catch {
      setError("Network error.");
    } finally {
      setDeleting(false);
    }
  };

  const tabs: Array<{ id: typeof activeTab; label: string }> = [
    { id: "details", label: "Details" },
    { id: "address", label: "Address" },
    { id: "tax", label: "GST / Tax" },
    { id: "other", label: "Other" },
  ];

  const card: React.CSSProperties = {
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "14px 16px",
  };
  const grid2: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {!isNew && (
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "rgba(59,130,246,0.15)",
                color: "var(--accent)",
                fontWeight: 700,
                fontSize: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {initials(form.display_name || "?")}
            </div>
          )}
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              {isNew ? "New customer" : form.display_name || "—"}
            </div>
            {!isNew && form.gstin && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginTop: 1,
                }}
              >
                GSTIN: {form.gstin}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {!isNew && !confirmDelete && (
            <button
              className="btn-ghost"
              style={{
                fontSize: 11,
                color: "var(--accent-red)",
                borderColor: "rgba(239,68,68,0.3)",
              }}
              onClick={() => setConfirmDelete(true)}
            >
              Deactivate
            </button>
          )}
          {confirmDelete && (
            <>
              <span style={{ fontSize: 11, color: "var(--accent-red)" }}>
                Sure?
              </span>
              <button
                className="btn-ghost"
                style={{ fontSize: 11 }}
                onClick={() => setConfirmDelete(false)}
              >
                No
              </button>
              <button
                className="btn-primary"
                style={{ fontSize: 11, background: "var(--accent-red)" }}
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "…" : "Yes, deactivate"}
              </button>
            </>
          )}
          <button
            className="btn-ghost"
            style={{ fontSize: 11 }}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="btn-primary"
            style={{ fontSize: 11 }}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : isNew ? "Create customer" : "Save changes"}
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: "7px 12px",
            borderRadius: 6,
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.3)",
            fontSize: 12,
            color: "var(--accent-red)",
            flexShrink: 0,
          }}
        >
          {error}
        </div>
      )}
      {success && (
        <div
          style={{
            padding: "7px 12px",
            borderRadius: 6,
            background: "rgba(34,197,94,0.08)",
            border: "1px solid rgba(34,197,94,0.25)",
            fontSize: 12,
            color: "var(--accent-green)",
            flexShrink: 0,
          }}
        >
          {success}
        </div>
      )}

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        {tabs.map((t) => (
          <div
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: "7px 14px",
              fontSize: 12,
              cursor: "pointer",
              color: activeTab === t.id ? "var(--text)" : "var(--text-muted)",
              borderBottom:
                activeTab === t.id
                  ? "2px solid var(--accent)"
                  : "2px solid transparent",
              fontWeight: activeTab === t.id ? 500 : 400,
              marginBottom: -1,
            }}
          >
            {t.label}
          </div>
        ))}
      </div>

      {/* Tab content */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {/* ── DETAILS ── */}
        {activeTab === "details" && (
          <div style={card}>
            <SL>Contact details</SL>
            <div style={grid2}>
              <FG label="Display name" full>
                <input
                  value={form.display_name || ""}
                  onChange={(e) => set("display_name", e.target.value)}
                  placeholder="e.g. Guru Agencies"
                />
              </FG>
              <FG label="Company name" full>
                <input
                  value={form.company_name || ""}
                  onChange={(e) => set("company_name", e.target.value)}
                  placeholder="Legal company name"
                />
              </FG>
              <FG label="Salutation">
                <select
                  value={form.salutation || ""}
                  onChange={(e) => set("salutation", e.target.value)}
                >
                  <option value="">—</option>
                  <option>Mr.</option>
                  <option>Mrs.</option>
                  <option>Ms.</option>
                  <option>Dr.</option>
                </select>
              </FG>
              <FG label="Customer type">
                <select
                  value={form.customer_sub_type || "business"}
                  onChange={(e) => set("customer_sub_type", e.target.value)}
                >
                  <option value="business">Business</option>
                  <option value="individual">Individual</option>
                </select>
              </FG>
              <FG label="First name">
                <input
                  value={form.first_name || ""}
                  onChange={(e) => set("first_name", e.target.value)}
                  placeholder="First name"
                />
              </FG>
              <FG label="Last name">
                <input
                  value={form.last_name || ""}
                  onChange={(e) => set("last_name", e.target.value)}
                  placeholder="Last name"
                />
              </FG>
            </div>

            <SL style={{ marginTop: 12 }}>Contact info</SL>
            <div style={grid2}>
              <FG label="Phone">
                <input
                  value={form.phone || ""}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="Landline"
                />
              </FG>
              <FG label="Mobile">
                <input
                  value={form.mobile || ""}
                  onChange={(e) => set("mobile", e.target.value)}
                  placeholder="Mobile number"
                />
              </FG>
              <FG label="Email" full>
                <input
                  type="email"
                  value={form.email || ""}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="contact@company.com"
                />
              </FG>
              <FG label="Website" full>
                <input
                  value={form.website || ""}
                  onChange={(e) => set("website", e.target.value)}
                  placeholder="https://www.company.com"
                />
              </FG>
            </div>

            <SL style={{ marginTop: 12 }}>Payment</SL>
            <div style={grid2}>
              <FG label="Payment terms">
                <select
                  value={form.payment_terms || "Due on Receipt"}
                  onChange={(e) => set("payment_terms", e.target.value)}
                >
                  <option>Due on Receipt</option>
                  <option>Net 15</option>
                  <option>Net 30</option>
                  <option>Net 45</option>
                  <option>Net 60</option>
                </select>
              </FG>
              <FG label="Credit limit (₹)">
                <input
                  type="number"
                  min={0}
                  value={form.credit_limit ?? 0}
                  onChange={(e) => set("credit_limit", +e.target.value || 0)}
                />
              </FG>
              <FG label="Status">
                <select
                  value={form.status || "Active"}
                  onChange={(e) => set("status", e.target.value)}
                >
                  <option>Active</option>
                  <option>Inactive</option>
                </select>
              </FG>
            </div>
          </div>
        )}

        {/* ── ADDRESS ── */}
        {activeTab === "address" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={card}>
              <SL>Billing address</SL>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <FG label="Street address 1">
                  <input
                    value={form.billing_address || ""}
                    onChange={(e) => set("billing_address", e.target.value)}
                    placeholder="Street / building"
                  />
                </FG>
                <FG label="Street address 2">
                  <input
                    value={form.billing_street2 || ""}
                    onChange={(e) => set("billing_street2", e.target.value)}
                    placeholder="Area / landmark"
                  />
                </FG>
                <div style={grid2}>
                  <FG label="City">
                    <input
                      value={form.billing_city || ""}
                      onChange={(e) => set("billing_city", e.target.value)}
                      placeholder="City"
                    />
                  </FG>
                  <FG label="Pincode">
                    <input
                      value={form.billing_pincode || ""}
                      onChange={(e) => set("billing_pincode", e.target.value)}
                      placeholder="560001"
                    />
                  </FG>
                  <FG label="State">
                    <select
                      value={form.billing_state || ""}
                      onChange={(e) => set("billing_state", e.target.value)}
                    >
                      <option value="">— select state —</option>
                      {INDIAN_STATES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </FG>
                  <FG label="Country">
                    <input
                      value={form.billing_country || "India"}
                      onChange={(e) => set("billing_country", e.target.value)}
                    />
                  </FG>
                </div>
              </div>
            </div>

            <div style={card}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 8,
                }}
              >
                <SL>Shipping address</SL>
                <button
                  className="btn-ghost"
                  style={{ fontSize: 10, padding: "3px 9px" }}
                  onClick={copyBillingToShipping}
                >
                  Copy from billing
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <FG label="Street address 1">
                  <input
                    value={form.shipping_address || ""}
                    onChange={(e) => {
                      set("shipping_address", e.target.value);
                      setSameAsBilling(false);
                    }}
                    placeholder="Street / building"
                  />
                </FG>
                <FG label="Street address 2">
                  <input
                    value={form.shipping_street2 || ""}
                    onChange={(e) => {
                      set("shipping_street2", e.target.value);
                      setSameAsBilling(false);
                    }}
                    placeholder="Area / landmark"
                  />
                </FG>
                <div style={grid2}>
                  <FG label="City">
                    <input
                      value={form.shipping_city || ""}
                      onChange={(e) => set("shipping_city", e.target.value)}
                      placeholder="City"
                    />
                  </FG>
                  <FG label="Pincode">
                    <input
                      value={form.shipping_pincode || ""}
                      onChange={(e) => set("shipping_pincode", e.target.value)}
                      placeholder="560001"
                    />
                  </FG>
                  <FG label="State">
                    <select
                      value={form.shipping_state || ""}
                      onChange={(e) => set("shipping_state", e.target.value)}
                    >
                      <option value="">— select state —</option>
                      {INDIAN_STATES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </FG>
                  <FG label="Country">
                    <input
                      value={form.shipping_country || "India"}
                      onChange={(e) => set("shipping_country", e.target.value)}
                    />
                  </FG>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── GST / TAX ── */}
        {activeTab === "tax" && (
          <div style={card}>
            <SL>GST details</SL>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <FG label="GST treatment">
                <select
                  value={form.gst_treatment || "business_gst"}
                  onChange={(e) => set("gst_treatment", e.target.value)}
                >
                  {Object.entries(GST_TREATMENTS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </FG>
              <FG label="GSTIN">
                <input
                  value={form.gstin || ""}
                  onChange={(e) => set("gstin", e.target.value.toUpperCase())}
                  placeholder="29AABCT1332L000"
                  style={{ fontFamily: "monospace", letterSpacing: "0.05em" }}
                />
              </FG>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                }}
              >
                <FG label="Place of supply (state code)">
                  <input
                    value={form.place_of_contact || ""}
                    onChange={(e) =>
                      set("place_of_contact", e.target.value.toUpperCase())
                    }
                    placeholder="KL"
                  />
                </FG>
                <FG label="Place of supply (full)">
                  <select
                    value={form.place_of_contact_label || ""}
                    onChange={(e) =>
                      set("place_of_contact_label", e.target.value)
                    }
                  >
                    <option value="">—</option>
                    {INDIAN_STATES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </FG>
              </div>

              {/* GSTIN validation indicator */}
              {form.gstin && form.gstin.length > 0 && (
                <div
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    fontSize: 11,
                    background:
                      form.gstin.length === 15
                        ? "rgba(34,197,94,0.07)"
                        : "rgba(245,158,11,0.07)",
                    border: `1px solid ${form.gstin.length === 15 ? "rgba(34,197,94,0.25)" : "rgba(245,158,11,0.25)"}`,
                    color:
                      form.gstin.length === 15
                        ? "var(--accent-green)"
                        : "var(--accent-amber)",
                  }}
                >
                  {form.gstin.length === 15
                    ? `✓ Valid length · State code: ${form.gstin.slice(0, 2)} · PAN: ${form.gstin.slice(2, 12)}`
                    : `⚠ GSTIN must be 15 characters (currently ${form.gstin.length})`}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── OTHER ── */}
        {activeTab === "other" && (
          <div style={card}>
            <SL>Additional info</SL>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <FG label="Notes">
                <textarea
                  value={form.notes || ""}
                  onChange={(e) => set("notes", e.target.value)}
                  rows={4}
                  placeholder="Internal notes about this customer…"
                  style={{
                    resize: "vertical",
                    fontFamily: "inherit",
                    lineHeight: 1.6,
                  }}
                />
              </FG>
              {!isNew && (
                <div
                  style={{
                    marginTop: 8,
                    padding: "10px 12px",
                    background: "var(--bg-input)",
                    borderRadius: 8,
                    fontSize: 11,
                    color: "var(--text-muted)",
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 6,
                  }}
                >
                  <div>
                    Created:{" "}
                    <span style={{ color: "var(--text-dim)" }}>
                      {fmtDate(customer.created_at)}
                    </span>
                  </div>
                  {customer.zoho_contact_id && (
                    <div>
                      Zoho ID:{" "}
                      <span
                        style={{
                          color: "var(--text-dim)",
                          fontFamily: "monospace",
                        }}
                      >
                        {customer.zoho_contact_id}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Customers screen ────────────────────────────────────────────────────
export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Customer | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [filter, setFilter] = useState<"all" | "gst" | "no_gst" | "overseas">(
    "all",
  );

  const load = useCallback(async (q = "") => {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/customers?q=${encodeURIComponent(q)}&limit=200`,
      );
      const d = await r.json();
      setCustomers(d.customers ?? []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => load(search), 250);
    return () => clearTimeout(t);
  }, [search, load]);

  const filtered = useMemo(() => {
    if (filter === "all") return customers;
    if (filter === "gst")
      return customers.filter((c) => c.gst_treatment === "business_gst");
    if (filter === "no_gst")
      return customers.filter(
        (c) =>
          c.gst_treatment === "business_none" || c.gst_treatment === "consumer",
      );
    if (filter === "overseas")
      return customers.filter((c) => c.gst_treatment === "overseas");
    return customers;
  }, [customers, filter]);

  const handleSaved = (c: Customer) => {
    setCustomers((prev) => {
      const idx = prev.findIndex((x) => x.id === c.id);
      if (idx >= 0) {
        const n = [...prev];
        n[idx] = c;
        return n;
      }
      return [c, ...prev];
    });
    setSelected(c);
    setIsNew(false);
  };

  const handleDeleted = () => {
    if (selected)
      setCustomers((prev) => prev.filter((c) => c.id !== selected.id));
    setSelected(null);
    setIsNew(false);
  };

  const handleNew = () => {
    setSelected(null);
    setIsNew(true);
  };

  const handleCancel = () => {
    setIsNew(false);
    if (!selected) return;
    // if we opened new but cancelled just go back to list
  };

  // ── Styles ──────────────────────────────────────────────────────────────────
  const gstBadge = (treatment?: string) => {
    if (!treatment) return null;
    const labels: Record<string, { label: string; color: string; bg: string }> =
      {
        business_gst: {
          label: "GST Reg",
          color: "var(--accent-green)",
          bg: "rgba(34,197,94,0.1)",
        },
        business_none: {
          label: "Unregd",
          color: "var(--text-muted)",
          bg: "var(--bg-input)",
        },
        business_registered_composition: {
          label: "Comp",
          color: "var(--accent-amber)",
          bg: "rgba(245,158,11,0.1)",
        },
        overseas: {
          label: "Overseas",
          color: "var(--accent)",
          bg: "rgba(59,130,246,0.1)",
        },
        consumer: {
          label: "Consumer",
          color: "var(--text-muted)",
          bg: "var(--bg-input)",
        },
        tax_deductor: {
          label: "TDS",
          color: "var(--accent-amber)",
          bg: "rgba(245,158,11,0.1)",
        },
        business_sez: {
          label: "SEZ",
          color: "var(--accent)",
          bg: "rgba(59,130,246,0.1)",
        },
      };
    const b = labels[treatment] ?? {
      label: treatment,
      color: "var(--text-muted)",
      bg: "var(--bg-input)",
    };
    return (
      <span
        style={{
          fontSize: 9,
          padding: "1px 5px",
          borderRadius: 4,
          background: b.bg,
          color: b.color,
          fontWeight: 600,
          marginLeft: 6,
        }}
      >
        {b.label}
      </span>
    );
  };

  const showPanel = isNew || selected !== null;

  return (
    <div
      style={{ display: "flex", gap: 0, height: "100%", overflow: "hidden" }}
    >
      <style>{`
        .cust-list-item { cursor: pointer; padding: 10px 12px; border-bottom: 1px solid var(--border); transition: background 0.1s; }
        .cust-list-item:hover { background: rgba(255,255,255,0.03); }
        .cust-list-item.active { background: rgba(59,130,246,0.08); border-left: 2px solid var(--accent); }
        .cust-filter-tab { font-size: 11px; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--text-muted); cursor: pointer; }
        .cust-filter-tab.active { background: rgba(59,130,246,0.1); color: var(--accent); border-color: rgba(59,130,246,0.3); }
      `}</style>

      {/* ── LEFT: Customer list ────────────────────────────────────────────── */}
      <div
        style={{
          width: showPanel ? 280 : "100%",
          minWidth: showPanel ? 280 : undefined,
          flexShrink: 0,
          borderRight: showPanel ? "1px solid var(--border)" : "none",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          transition: "width 0.2s",
        }}
      >
        {/* List header */}
        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <input
              placeholder="Search name, GSTIN, city…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              className="btn-primary"
              style={{ fontSize: 11, padding: "6px 12px", flexShrink: 0 }}
              onClick={handleNew}
            >
              + New
            </button>
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {(["all", "gst", "no_gst", "overseas"] as const).map((f) => (
              <button
                key={f}
                className={`cust-filter-tab${filter === f ? " active" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f === "all"
                  ? `All (${customers.length})`
                  : f === "gst"
                    ? "GST Reg"
                    : f === "no_gst"
                      ? "Unreg"
                      : "Overseas"}
              </button>
            ))}
          </div>
        </div>

        {/* List body */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div
              style={{
                padding: 16,
                fontSize: 12,
                color: "var(--text-muted)",
                textAlign: "center",
              }}
            >
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div
              style={{
                padding: 16,
                fontSize: 12,
                color: "var(--text-muted)",
                textAlign: "center",
              }}
            >
              No customers found.
            </div>
          ) : (
            filtered.map((c) => (
              <div
                key={c.id}
                className={`cust-list-item${selected?.id === c.id ? " active" : ""}`}
                onClick={() => {
                  setSelected(c);
                  setIsNew(false);
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: "rgba(59,130,246,0.12)",
                      color: "var(--accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {initials(c.display_name)}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      {c.display_name}
                      {gstBadge(c.gst_treatment)}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--text-muted)",
                        marginTop: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.gstin
                        ? c.gstin
                        : c.billing_city
                          ? c.billing_city
                          : c.place_of_contact_label || "—"}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* List footer */}
        <div
          style={{
            padding: "6px 12px",
            borderTop: "1px solid var(--border)",
            fontSize: 10,
            color: "var(--text-muted)",
            flexShrink: 0,
          }}
        >
          {filtered.length} of {customers.length} customers
        </div>
      </div>

      {/* ── RIGHT: Edit panel ──────────────────────────────────────────────── */}
      {showPanel && (
        <div
          style={{
            flex: 1,
            overflow: "hidden",
            padding: "12px 16px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <CustomerEdit
            customer={isNew ? { ...EMPTY } : (selected ?? { ...EMPTY })}
            isNew={isNew}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
            onCancel={handleCancel}
          />
        </div>
      )}

      {/* Empty state when nothing selected */}
      {!showPanel && !loading && filtered.length > 0 && (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            fontSize: 13,
          }}
        >
          Select a customer to view or edit
        </div>
      )}
    </div>
  );
}
