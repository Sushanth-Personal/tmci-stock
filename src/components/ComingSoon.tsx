// src/components/ComingSoon.tsx
// Placeholder for screens not yet built
"use client";

interface Props {
  title: string;
  icon?: string;
  description?: string;
  bullets?: string[];
}

export default function ComingSoon({
  title,
  icon = "🚧",
  description,
  bullets,
}: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 320,
        padding: 24,
      }}
    >
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "32px 40px",
          maxWidth: 480,
          width: "100%",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 14 }}>{icon}</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
          {title}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            lineHeight: 1.7,
            marginBottom: bullets ? 16 : 0,
          }}
        >
          {description ??
            "This module is coming soon. The structure is in place — functionality will be wired up next."}
        </div>
        {bullets && (
          <div
            style={{
              background: "var(--bg-input)",
              borderRadius: 8,
              padding: "12px 16px",
              textAlign: "left",
              marginTop: 8,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: 8,
              }}
            >
              Planned features
            </div>
            {bullets.map((b, i) => (
              <div
                key={i}
                style={{
                  fontSize: 12,
                  color: "var(--text-dim)",
                  padding: "4px 0",
                  borderBottom:
                    i < bullets.length - 1 ? "1px solid var(--border)" : "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span style={{ color: "var(--accent)", fontSize: 10 }}>◆</span>
                {b}
              </div>
            ))}
          </div>
        )}
        <div
          style={{
            marginTop: 20,
            display: "inline-block",
            fontSize: 10,
            padding: "4px 12px",
            borderRadius: 99,
            background: "rgba(59,130,246,0.1)",
            color: "var(--accent)",
            fontWeight: 500,
          }}
        >
          Coming soon
        </div>
      </div>
    </div>
  );
}
