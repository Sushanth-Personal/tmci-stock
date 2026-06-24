// src/components/DatasheetButton.tsx
// A small button that fetches and opens the datasheet for a given model.
// Shows a loading spinner while searching, then opens Drive link in new tab.
// If multiple files found (e.g. different revisions), shows a small dropdown.
"use client";
import { useState } from "react";

interface FileResult {
  id: string;
  name: string;
  mimeType: string;
  viewLink: string;
  downloadLink: string;
  size: string | null;
}

export default function DatasheetButton({ model }: { model: string }) {
  const [state, setState] = useState<
    "idle" | "loading" | "found" | "none" | "error"
  >("idle");
  const [files, setFiles] = useState<FileResult[]>([]);
  const [showMenu, setShowMenu] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();

    // If already found and single file, just open it
    if (state === "found" && files.length === 1) {
      window.open(files[0].viewLink, "_blank");
      return;
    }
    // If multiple files, toggle the menu
    if (state === "found" && files.length > 1) {
      setShowMenu((v) => !v);
      return;
    }
    // Otherwise fetch
    setState("loading");
    setShowMenu(false);
    try {
      const r = await fetch(
        `/api/datasheet?model=${encodeURIComponent(model)}`,
      );
      const d = await r.json();
      if (!r.ok) {
        setState("error");
        setErrorMsg(d.error || "Failed");
        return;
      }
      if (!d.found || d.files.length === 0) {
        setState("none");
        return;
      }
      setFiles(d.files);
      setState("found");
      if (d.files.length === 1) {
        window.open(d.files[0].viewLink, "_blank");
      } else {
        setShowMenu(true);
      }
    } catch {
      setState("error");
      setErrorMsg("Network error");
    }
  };

  const btnStyle: React.CSSProperties = {
    background: "transparent",
    border: "1px solid",
    borderRadius: 4,
    fontSize: 10,
    padding: "2px 7px",
    cursor: state === "none" ? "default" : "pointer",
    whiteSpace: "nowrap",
    position: "relative",
    ...(state === "none"
      ? { borderColor: "var(--border)", color: "var(--text-muted)" }
      : state === "error"
        ? { borderColor: "rgba(239,68,68,0.4)", color: "var(--accent-red)" }
        : state === "found"
          ? { borderColor: "rgba(59,130,246,0.4)", color: "var(--accent)" }
          : { borderColor: "var(--border)", color: "var(--text-dim)" }),
  };

  const label =
    state === "loading"
      ? "…"
      : state === "none"
        ? "no datasheet"
        : state === "error"
          ? "error"
          : state === "found"
            ? files.length > 1
              ? `📄 ${files.length} files`
              : "📄 datasheet"
            : "📄 datasheet";

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        style={btnStyle}
        onClick={handleClick}
        title={
          state === "error"
            ? errorMsg
            : state === "none"
              ? "No datasheet found in Drive"
              : state === "found"
                ? `Open datasheet for ${model}`
                : `Search Drive for ${model} datasheet`
        }
        disabled={state === "loading" || state === "none"}
      >
        {label}
      </button>

      {showMenu && files.length > 1 && (
        <>
          {/* Click-outside overlay */}
          <div
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
            onClick={() => setShowMenu(false)}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              right: 0,
              zIndex: 50,
              background: "var(--bg-input)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
              minWidth: 220,
              overflow: "hidden",
            }}
          >
            {files.map((f) => (
              <div
                key={f.id}
                style={{
                  padding: "8px 12px",
                  cursor: "pointer",
                  fontSize: 11,
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "rgba(59,130,246,0.1)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(f.viewLink, "_blank");
                  setShowMenu(false);
                }}
              >
                <span style={{ color: "var(--text)", fontWeight: 500 }}>
                  {f.name}
                </span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {f.size && (
                    <span style={{ color: "var(--text-muted)" }}>{f.size}</span>
                  )}
                  <a
                    href={f.downloadLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--accent)", fontSize: 10 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    ⬇ download
                  </a>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
