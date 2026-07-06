// src/components/SerialScanner.tsx
// Scans a serial number via phone camera:
//   1. Primary: live barcode/QR scan using html5-qrcode (instant, free, offline)
//   2. Fallback: "Can't read? Take a photo" — sends image to Claude API to
//      read the printed serial as text (for damaged/unreadable barcodes)
//
// npm install html5-qrcode

"use client";
import { useState, useRef, useEffect, useCallback } from "react";

interface Props {
  onScanned: (serial: string) => void;
  onClose: () => void;
}

const SCANNER_ELEMENT_ID = "serial-scanner-viewport";

export default function SerialScanner({ onScanned, onClose }: Props) {
  const [mode, setMode] = useState<"barcode" | "photo">("barcode");
  const [restartKey, setRestartKey] = useState(0);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [lastResult, setLastResult] = useState("");
  const scannerRef = useRef<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Barcode scan mode ──────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "barcode") return;

    let cancelled = false;

    (async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } =
          await import("html5-qrcode");
        if (cancelled) return;

        const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, {
          // Explicitly enable 1D linear barcode formats — Fluke serial/item
          // stickers use CODE_128, with UPC_A/EAN_13 also present on the same
          // label. Without this, the library defaults to QR-only detection
          // and camera preview works fine but nothing ever gets recognised.
          formatsToSupport: [
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.CODE_93,
            Html5QrcodeSupportedFormats.CODABAR,
            Html5QrcodeSupportedFormats.ITF,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.QR_CODE, // keep QR too, just in case
          ],
          verbose: false,
        } as any);
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" }, // rear camera
          {
            fps: 15,
            // Wide + short box matching a 1D barcode's actual shape, rather
            // than a square QR-style box. Narrower height also helps avoid
            // accidentally capturing a neighbouring barcode on the same label
            // (Fluke stickers stack Item No / UPC / S/N barcodes close together).
            qrbox: { width: 300, height: 90 },
            aspectRatio: 1.6,
          },
          (decodedText: string) => {
            // Successful scan
            setLastResult(decodedText);
            onScanned(decodedText.trim());
            scanner.stop().catch(() => {});
          },
          () => {
            // per-frame "not found yet" — ignore, this fires constantly while scanning
          },
        );
      } catch (e: any) {
        setError(
          e?.message?.includes("Permission")
            ? "Camera permission denied. Allow camera access in your browser settings."
            : `Could not start camera: ${e.message ?? "unknown error"}`,
        );
      }
    })();

    return () => {
      cancelled = true;
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current.clear?.();
      }
    };
  }, [mode, restartKey, onScanned]);

  // ── Photo + AI fallback mode ───────────────────────────────────────────
  const handlePhoto = async (file: File) => {
    setScanning(true);
    setError("");

    const apiKey = process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY;
    if (!apiKey) {
      setError(
        "NEXT_PUBLIC_ANTHROPIC_API_KEY not set — photo reading needs this.",
      );
      setScanning(false);
      return;
    }

    const toBase64 = (f: File): Promise<string> =>
      new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve((r.result as string).split(",")[1]);
        r.onerror = reject;
        r.readAsDataURL(f);
      });

    try {
      const base64 = await toBase64(file);
      let mediaType: "image/jpeg" | "image/png" | "image/webp" = "image/jpeg";
      if (file.type === "image/png") mediaType = "image/png";
      if (file.type === "image/webp") mediaType = "image/webp";

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-request-header": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 100,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: mediaType,
                    data: base64,
                  },
                },
                {
                  type: "text",
                  text:
                    "This is a photo of a serial number sticker on a Fluke test/measurement instrument. " +
                    "Read ONLY the serial number printed on it. Return ONLY the serial number text, " +
                    "nothing else — no explanation, no labels. If you cannot read it clearly, return exactly: UNREADABLE",
                },
              ],
            },
          ],
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err?.error?.message ?? `HTTP ${res.status}`);
        setScanning(false);
        return;
      }

      const data = await res.json();
      const text: string = data?.content?.[0]?.text?.trim() ?? "";

      if (!text || text.toUpperCase() === "UNREADABLE") {
        setError(
          "Couldn't read the serial clearly. Try a closer, well-lit photo, or type it manually.",
        );
        setScanning(false);
        return;
      }

      setLastResult(text);
      onScanned(text);
    } catch (e: any) {
      setError(`Network error: ${e.message}`);
    }
    setScanning(false);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.88)",
        zIndex: 300,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          width: "100%",
          maxWidth: 420,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            📷 Scan Serial Number
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 20,
            }}
          >
            ×
          </button>
        </div>

        {/* Mode tabs */}
        <div style={{ display: "flex", gap: 6, padding: "10px 16px 0" }}>
          <button
            className={mode === "barcode" ? "btn-primary" : "btn-ghost"}
            style={{ fontSize: 11, flex: 1 }}
            onClick={() => {
              setMode("barcode");
              setError("");
            }}
          >
            📡 Live barcode scan
          </button>
          <button
            className={mode === "photo" ? "btn-primary" : "btn-ghost"}
            style={{ fontSize: 11, flex: 1 }}
            onClick={() => {
              setMode("photo");
              setError("");
            }}
          >
            📸 Photo (unreadable barcode)
          </button>
        </div>

        <div style={{ padding: 16 }}>
          {mode === "barcode" && (
            <>
              <div
                id={SCANNER_ELEMENT_ID}
                style={{
                  width: "100%",
                  minHeight: 240,
                  borderRadius: 8,
                  overflow: "hidden",
                  background: "#000",
                }}
              />
              <div
                style={{
                  fontSize: 11,
                  color: "var(--accent-amber)",
                  marginTop: 8,
                  textAlign: "center",
                  lineHeight: 1.5,
                }}
              >
                ⚠ Fluke labels have 3 barcodes stacked together (Item No / UPC /
                S/N).
                <br />
                Point closely at the{" "}
                <strong>bottom barcode marked "S/N"</strong> only — cover the
                others with your finger if needed.
              </div>
              {lastResult && (
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 10, flex: 1 }}
                    onClick={() => {
                      // Wrong barcode was scanned — clear and force scanner to restart
                      setLastResult("");
                      setRestartKey((k) => k + 1);
                    }}
                  >
                    ✕ Wrong code — scan again
                  </button>
                </div>
              )}
            </>
          )}

          {mode === "photo" && (
            <div
              onClick={() => fileRef.current?.click()}
              style={{
                border: "2px dashed var(--border)",
                borderRadius: 10,
                padding: "32px 16px",
                textAlign: "center",
                cursor: "pointer",
                background: "var(--bg-input)",
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 8 }}>📸</div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                {scanning ? "Reading serial…" : "Tap to take a photo"}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  marginTop: 6,
                }}
              >
                Get close, good lighting, avoid glare on the sticker
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handlePhoto(f);
                  e.target.value = "";
                }}
              />
            </div>
          )}

          {lastResult && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 12,
                background: "rgba(34,197,94,0.08)",
                border: "1px solid rgba(34,197,94,0.3)",
                color: "var(--accent-green)",
                fontFamily: "monospace",
              }}
            >
              ✓ Scanned: {lastResult}
            </div>
          )}

          {error && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 11.5,
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.3)",
                color: "var(--accent-red)",
                lineHeight: 1.5,
              }}
            >
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
