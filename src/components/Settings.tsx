"use client";
// src/components/Settings.tsx
//
// Company profile, branches/locations, bank details, and operational
// defaults (invoice GST rate, low-stock threshold) — all editable and
// backing the rest of the app (InvoicePaper.tsx reads company profile +
// bank details from here; RecordSale/RecordPurchase/Dashboard can read
// default_gst_rate / low_stock_threshold going forward).

import { useState, useEffect } from "react";

interface CompanySettings {
  logo_url: string | null;
  company_name: string;
  company_id: string;
  gstin: string;
  address_line1: string;
  address_line2: string;
  address_line3: string;
  address_line4: string;
  phone: string;
  email: string;
  website: string;
  gst_state: string;
  bank_name: string;
  account_number: string;
  branch_name: string;
  ifsc_code: string;
  default_terms: string;
  default_gst_rate: number;
  low_stock_threshold: number;
  invoice_prefix: string;
}

interface Location {
  id: number;
  name: string;
  state: string | null;
  gstin: string | null;
  address: string | null;
  is_active: boolean;
}

const FG = ({ label, children, note }: any) => (
  <div>
    <label
      style={{
        fontSize: 11,
        color: "var(--text-muted)",
        display: "block",
        marginBottom: 4,
      }}
    >
      {label}
      {note && (
        <span style={{ color: "var(--text-muted)", opacity: 0.7 }}> — {note}</span>
      )}
    </label>
    {children}
  </div>
);

const SectionCard = ({ title, children }: any) => (
  <div
    style={{
      background: "var(--bg-card)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      padding: "14px 16px",
    }}
  >
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        color: "var(--text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        marginBottom: 12,
      }}
    >
      {title}
    </div>
    {children}
  </div>
);

export default function Settings() {
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const [locations, setLocations] = useState<Location[]>([]);
  const [locLoading, setLocLoading] = useState(true);
  const [newLocName, setNewLocName] = useState("");
  const [newLocState, setNewLocState] = useState("");
  const [addingLoc, setAddingLoc] = useState(false);
  const [locError, setLocError] = useState("");

  const loadSettings = () => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d.settings) {
          setSettings(d.settings);
          setLogoPreview(d.settings.logo_url ?? null);
        }
      })
      .catch(() => setError("Could not load settings."))
      .finally(() => setLoading(false));
  };

  const loadLocations = () => {
    setLocLoading(true);
    fetch("/api/locations")
      .then((r) => r.json())
      .then((d) => setLocations(d.locations ?? []))
      .catch(() => setLocError("Could not load locations."))
      .finally(() => setLocLoading(false));
  };

  useEffect(() => {
    loadSettings();
    loadLocations();
  }, []);

  const handleLogoFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file (PNG or JPG).");
      return;
    }
    if (file.size > 300_000) {
      setError(
        "Logo is too large — please use an image under ~250KB (a simple PNG/JPG of your logo mark is plenty).",
      );
      return;
    }
    setError("");
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setLogoPreview(dataUrl);
      setSettings((s) => (s ? { ...s, logo_url: dataUrl } : s));
    };
    reader.readAsDataURL(file);
  };

  const removeLogo = () => {
    setLogoPreview(null);
    setSettings((s) => (s ? { ...s, logo_url: null } : s));
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || "Failed to save settings.");
        return;
      }
      setSettings(d.settings);
      setSuccess("Settings saved.");
      setTimeout(() => setSuccess(""), 2000);
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  };

  const addLocation = async () => {
    if (!newLocName.trim()) {
      setLocError("Location name is required.");
      return;
    }
    setAddingLoc(true);
    setLocError("");
    try {
      const res = await fetch("/api/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newLocName.trim(), state: newLocState.trim() }),
      });
      const d = await res.json();
      if (!res.ok) {
        setLocError(d.error || "Failed to add location.");
        return;
      }
      setLocations((prev) => [...prev, d.location]);
      setNewLocName("");
      setNewLocState("");
    } catch {
      setLocError("Network error.");
    } finally {
      setAddingLoc(false);
    }
  };

  const updateLocationField = (id: number, field: keyof Location, value: any) => {
    setLocations((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)),
    );
  };

  const saveLocation = async (loc: Location) => {
    try {
      await fetch("/api/locations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loc),
      });
    } catch {
      setLocError("Failed to save location changes.");
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 20, color: "var(--text-muted)", fontSize: 12 }}>
        Loading settings…
      </div>
    );
  }

  if (!settings) {
    return (
      <div style={{ padding: 20, color: "var(--accent-red)", fontSize: 12 }}>
        {error || "Could not load settings."}
      </div>
    );
  }

  const set = (patch: Partial<CompanySettings>) =>
    setSettings((s) => (s ? { ...s, ...patch } : s));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        maxWidth: 760,
      }}
    >
      {/* Company profile */}
      <SectionCard title="Company profile">
        <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              border: "2px dashed var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              flexShrink: 0,
              background: "var(--bg-input)",
            }}
          >
            {logoPreview ? (
              <img
                src={logoPreview}
                alt="Logo preview"
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            ) : (
              <span style={{ fontSize: 9, color: "var(--text-muted)" }}>No logo</span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, justifyContent: "center" }}>
            <label
              className="btn-ghost"
              style={{ fontSize: 11, cursor: "pointer", display: "inline-block" }}
            >
              {logoPreview ? "Change logo" : "Upload logo"}
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleLogoFile(f);
                }}
              />
            </label>
            {logoPreview && (
              <button
                className="btn-ghost"
                style={{ fontSize: 11, color: "var(--accent-red)" }}
                onClick={removeLogo}
              >
                Remove logo
              </button>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <FG label="Company name">
            <input
              value={settings.company_name}
              onChange={(e) => set({ company_name: e.target.value })}
            />
          </FG>
          <FG label="Company ID / CIN">
            <input
              value={settings.company_id}
              onChange={(e) => set({ company_id: e.target.value })}
            />
          </FG>
          <FG label="GSTIN (main registration)">
            <input
              value={settings.gstin}
              onChange={(e) => set({ gstin: e.target.value.toUpperCase() })}
            />
          </FG>
          <FG label="GST state (Place of Supply on invoices)">
            <input
              value={settings.gst_state}
              onChange={(e) => set({ gst_state: e.target.value })}
              placeholder="e.g. Kerala (32)"
            />
          </FG>
          <FG label="Phone">
            <input value={settings.phone} onChange={(e) => set({ phone: e.target.value })} />
          </FG>
          <FG label="Email">
            <input value={settings.email} onChange={(e) => set({ email: e.target.value })} />
          </FG>
          <FG label="Website">
            <input value={settings.website} onChange={(e) => set({ website: e.target.value })} />
          </FG>
        </div>

        <div style={{ marginTop: 10 }}>
          <FG label="Registered address (as printed on invoices, one line each)">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <input
                value={settings.address_line1}
                onChange={(e) => set({ address_line1: e.target.value })}
                placeholder="Address line 1"
              />
              <input
                value={settings.address_line2}
                onChange={(e) => set({ address_line2: e.target.value })}
                placeholder="Address line 2"
              />
              <input
                value={settings.address_line3}
                onChange={(e) => set({ address_line3: e.target.value })}
                placeholder="City, State, Pincode"
              />
              <input
                value={settings.address_line4}
                onChange={(e) => set({ address_line4: e.target.value })}
                placeholder="Country"
              />
            </div>
          </FG>
        </div>
      </SectionCard>

      {/* Locations / branches */}
      <SectionCard title="Locations (warehouses / branches)">
        <div
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            marginBottom: 10,
            lineHeight: 1.6,
          }}
        >
          Stock is tracked per location below. Each is a warehouse under the
          same company — give a location its own GSTIN only if it's a real,
          separately-registered GST branch for that state; otherwise leave
          it blank and invoices from that location use the main company
          GSTIN above (with IGST for out-of-state customers, CGST+SGST for
          in-state — handled automatically).
        </div>

        {locLoading ? (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading…</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {locations.map((loc) => (
              <div
                key={loc.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1.4fr auto",
                  gap: 8,
                  alignItems: "end",
                  background: "var(--bg-input)",
                  padding: "8px 10px",
                  borderRadius: 8,
                }}
              >
                <FG label="Name">
                  <input
                    value={loc.name}
                    onChange={(e) => updateLocationField(loc.id, "name", e.target.value)}
                    onBlur={() => saveLocation(loc)}
                  />
                </FG>
                <FG label="State">
                  <input
                    value={loc.state ?? ""}
                    onChange={(e) => updateLocationField(loc.id, "state", e.target.value)}
                    onBlur={() => saveLocation(loc)}
                  />
                </FG>
                <FG label="GSTIN (optional — separate branch registration)">
                  <input
                    value={loc.gstin ?? ""}
                    onChange={(e) =>
                      updateLocationField(loc.id, "gstin", e.target.value.toUpperCase())
                    }
                    onBlur={() => saveLocation(loc)}
                    placeholder="blank = uses main GSTIN"
                  />
                </FG>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 10,
                    color: "var(--text-muted)",
                    marginBottom: 6,
                    whiteSpace: "nowrap",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={loc.is_active}
                    onChange={(e) => {
                      updateLocationField(loc.id, "is_active", e.target.checked);
                      saveLocation({ ...loc, is_active: e.target.checked });
                    }}
                    style={{ width: "auto" }}
                  />
                  Active
                </label>
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px solid var(--border)",
          }}
        >
          <input
            placeholder="New location name (e.g. Chennai)"
            value={newLocName}
            onChange={(e) => setNewLocName(e.target.value)}
            style={{ flex: 1 }}
          />
          <input
            placeholder="State"
            value={newLocState}
            onChange={(e) => setNewLocState(e.target.value)}
            style={{ width: 160 }}
          />
          <button className="btn-ghost" onClick={addLocation} disabled={addingLoc}>
            {addingLoc ? "Adding…" : "+ Add location"}
          </button>
        </div>
        {locError && (
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--accent-red)" }}>
            {locError}
          </div>
        )}
      </SectionCard>

      {/* Bank details */}
      <SectionCard title="Bank details (shown on invoices)">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <FG label="Bank name">
            <input
              value={settings.bank_name}
              onChange={(e) => set({ bank_name: e.target.value })}
            />
          </FG>
          <FG label="Account number">
            <input
              value={settings.account_number}
              onChange={(e) => set({ account_number: e.target.value })}
            />
          </FG>
          <FG label="Branch name">
            <input
              value={settings.branch_name}
              onChange={(e) => set({ branch_name: e.target.value })}
            />
          </FG>
          <FG label="IFSC code">
            <input
              value={settings.ifsc_code}
              onChange={(e) => set({ ifsc_code: e.target.value })}
            />
          </FG>
        </div>
      </SectionCard>

      {/* Invoice & stock defaults */}
      <SectionCard title="Invoice & stock defaults">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <FG label="Default payment terms" note="e.g. 'Due on Receipt', 'Net 30'">
            <input
              value={settings.default_terms}
              onChange={(e) => set({ default_terms: e.target.value })}
            />
          </FG>
          <FG label="Default GST rate (%)" note="pre-filled on new invoices">
            <input
              type="number"
              value={settings.default_gst_rate}
              onChange={(e) => set({ default_gst_rate: Number(e.target.value) || 0 })}
            />
          </FG>
          <FG label="Invoice number prefix" note="optional, e.g. '2026-2027-KL-'">
            <input
              value={settings.invoice_prefix}
              onChange={(e) => set({ invoice_prefix: e.target.value })}
            />
          </FG>
          <FG label="Low stock threshold" note="flag a model when total stock ≤ this">
            <input
              type="number"
              min={0}
              value={settings.low_stock_threshold}
              onChange={(e) => set({ low_stock_threshold: Number(e.target.value) || 0 })}
            />
          </FG>
        </div>
      </SectionCard>

      {error && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.3)",
            fontSize: 12,
            color: "var(--accent-red)",
          }}
        >
          {error}
        </div>
      )}
      {success && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            background: "rgba(34,197,94,0.08)",
            border: "1px solid rgba(34,197,94,0.25)",
            fontSize: 12,
            color: "var(--accent-green)",
          }}
        >
          {success}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>
    </div>
  );
}