// src/components/SerialScanner.tsx
// Scans a serial number via phone camera:
//   1. Primary: live barcode scan using @zxing/browser (Code 128, UPC, EAN, etc.)
//      — more reliable for 1D linear barcodes than html5-qrcode.
//   2. Fallback: "Can't read? Take a photo" — sends image to Claude API to
//      read the printed serial as text (for damaged/unreadable barcodes)
//
// npm uninstall html5-qrcode
// npm install @zxing/browser @zxing/library

"use client";
import { useState, useRef, useEffect } from "react";

interface Props {
  onScanned: (serial: string) => void;
  onClose: () => void;
}

export default function SerialScanner({ onScanned, onClose }: Props) {
  const [mode, setMode] = useState<"barcode" | "photo">("barcode");
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [lastResult, setLastResult] = useState("");
  const [restartKey, setRestartKey] = useState(0);
  const [cameraStarting, setCameraStarting] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<any>(null);
  const controlsRef = useRef<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Barcode scan mode (ZXing) ────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "barcode") return;
    let cancelled = false;
    setCameraStarting(true);
    setError("");

    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const { DecodeHintType, BarcodeFormat } =
          await import("@zxing/library");
        if (cancelled) return;

        // Restrict to the formats actually used on Fluke labels — this both
        // speeds up detection and reduces false negatives compared to
        // scanning for every possible format at once.
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.CODE_93,
          BarcodeFormat.CODABAR,
          BarcodeFormat.ITF,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.QR_CODE,
        ]);
        hints.set(DecodeHintType.TRY_HARDER, true);

        const reader = new BrowserMultiFormatReader(hints);
        readerRef.current = reader;

        // List video input devices, prefer the rear/environment camera
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        const rearCam =
          devices.find((d: MediaDeviceInfo) =>
            /back|rear|environment/i.test(d.label),
          ) ??
          devices[devices.length - 1] ??
          devices[0];

        if (!rearCam) {
          setError("No camera found on this device.");
          setCameraStarting(false);
          return;
        }

        if (cancelled) return;
        setCameraStarting(false);

        const controls = await reader.decodeFromVideoDevice(
          rearCam.deviceId,
          videoRef.current!,
          (result: any, err: any) => {
            if (cancelled) return;
            if (result) {
              const text = result.getText().trim();
              setLastResult(text);
              onScanned(text);
              controls?.stop();
            }
            // err fires constantly while nothing is detected — ignore it,
            // only NotFoundException-type errors, which are expected per-frame.
          },
        );
        controlsRef.current = controls;
      } catch (e: any) {
        if (cancelled) return;
        setCameraStarting(false);
        setError(
          e?.name === "NotAllowedError" || e?.message?.includes("Permission")
            ? "Camera permission denied. Allow camera access in your browser settings."
            : `Could not start camera: ${e?.message ?? "unknown error"}`,
        );
      }
    })();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
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
                    "There may be multiple barcodes on the label (Item No, UPC, S/N) — find the one " +
                    "labelled 'S/N:' specifically and read ONLY the text printed below/next to that barcode. " +
                    "Return ONLY the serial number text, nothing else — no explanation, no labels. " +
                    "If you cannot read it clearly, return exactly: UNREADABLE",
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
              setLastResult("");
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
              setLastResult("");
            }}
          >
            📸 Photo (unreadable barcode)
          </button>
        </div>

        <div style={{ padding: 16 }}>
          {mode === "barcode" && (
            <>
              <div
                style={{
                  width: "100%",
                  minHeight: 240,
                  borderRadius: 8,
                  overflow: "hidden",
                  background: "#000",
                  position: "relative",
                }}
              >
                <video
                  ref={videoRef}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                  muted
                  playsInline
                />
                {cameraStarting && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      fontSize: 12,
                    }}
                  >
                    Starting camera…
                  </div>
                )}
                {/* Scan guide overlay — wide box matching a 1D barcode shape */}
                {!cameraStarting && (
                  <div
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                      width: "80%",
                      height: 70,
                      border: "2px solid rgba(34,197,94,0.8)",
                      borderRadius: 6,
                      boxShadow: "0 0 0 2000px rgba(0,0,0,0.35)",
                      pointerEvents: "none",
                    }}
                  />
                )}
              </div>
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
                Align the <strong>bottom barcode marked "S/N"</strong> inside
                the green box — cover the others with your finger if needed.
                Hold steady, ~8-10cm away.
              </div>
              {lastResult && (
                <button
                  className="btn-ghost"
                  style={{ fontSize: 10, width: "100%", marginTop: 8 }}
                  onClick={() => {
                    setLastResult("");
                    setRestartKey((k) => k + 1);
                  }}
                >
                  ✕ Wrong code — scan again
                </button>
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
