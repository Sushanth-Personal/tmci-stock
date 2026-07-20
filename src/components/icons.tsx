// src/components/icons.tsx
//
// A small shared icon set used to replace emoji throughout the app.
// Deliberately monochrome, stroke-based (currentColor), 24x24 viewBox —
// this is the same visual language used in Expenses.tsx's category
// badges, so anything using <Icon name="..."/> automatically looks
// consistent with that screen instead of falling back to OS emoji glyphs.
//
// Usage:
//   <Icon name="dashboard" size={16} />
//   <Icon name="factory" size={20} style={{ color: "var(--accent)" }} />
//
// To add a new icon: add its key to IconName below and a <path>/<circle>
// set in the switch in Icon(). Keep strokeWidth around 1.7-1.9 and favor
// simple geometric shapes (circles, rounded rects) so new icons match the
// existing set without needing a design pass.

import React from "react";

export type IconName =
  | "dashboard"
  | "users"
  | "user"
  | "factory"
  | "folder"
  | "file"
  | "clipboard"
  | "arrow-up"
  | "arrow-down"
  | "receipt"
  | "undo"
  | "truck"
  | "box"
  | "road"
  | "swap"
  | "note"
  | "wallet"
  | "hash"
  | "trash"
  | "search"
  | "book"
  | "download"
  | "settings"
  | "list"
  | "refresh"
  | "check"
  | "close"
  | "plus"
  | "menu"
  | "warning"
  | "info"
  | "calendar"
  | "filter"
  | "chevron-right"
  | "chevron-down"
  | "print"
  | "camera"
  | "link"
  | "eye"
  | "edit"
  | "lightning";

const COMMON = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function Icon({
  name,
  size = 16,
  style,
  className,
}: {
  name: IconName;
  size?: number;
  style?: React.CSSProperties;
  className?: string;
}) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    style: { display: "block", flexShrink: 0, ...style },
    className,
    ...COMMON,
  };

  switch (name) {
    case "dashboard":
      return (
        <svg {...props}>
          <rect x="3" y="3" width="7.5" height="7.5" rx="1.3" />
          <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.3" />
          <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.3" />
          <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.3" />
        </svg>
      );
    case "users":
      return (
        <svg {...props}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
          <circle cx="17" cy="8" r="2.4" />
          <path d="M15.5 14.2c2.6.4 4.5 2.7 4.5 5.8" />
        </svg>
      );
    case "user":
      return (
        <svg {...props}>
          <circle cx="12" cy="8" r="3.4" />
          <path d="M4.5 20c0-4.1 3.4-7.5 7.5-7.5s7.5 3.4 7.5 7.5" />
        </svg>
      );
    case "factory":
      return (
        <svg {...props}>
          <path d="M3 21V10l5 3.5V10l5 3.5V10l5 3.5V6h3v15Z" />
          <path d="M3 21h18" />
        </svg>
      );
    case "folder":
      return (
        <svg {...props}>
          <path d="M3 6.5a1.5 1.5 0 0 1 1.5-1.5H9l2 2.2h8.5A1.5 1.5 0 0 1 21 8.7v9.3a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18Z" />
        </svg>
      );
    case "file":
      return (
        <svg {...props}>
          <path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
          <path d="M14 3v5h5" />
          <path d="M8 13h8M8 17h5" />
        </svg>
      );
    case "clipboard":
      return (
        <svg {...props}>
          <rect x="5" y="4" width="14" height="17" rx="1.5" />
          <rect x="9" y="2.3" width="6" height="3.4" rx="1" />
          <path d="M8.5 11h7M8.5 15h7" />
        </svg>
      );
    case "arrow-up":
      return (
        <svg {...props}>
          <path d="M12 19V5" />
          <path d="M6 11l6-6 6 6" />
        </svg>
      );
    case "arrow-down":
      return (
        <svg {...props}>
          <path d="M12 5v14" />
          <path d="M18 13l-6 6-6-6" />
        </svg>
      );
    case "receipt":
      return (
        <svg {...props}>
          <path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5Z" />
          <path d="M9 8h6M9 12h6M9 16h4" />
        </svg>
      );
    case "undo":
      return (
        <svg {...props}>
          <path d="M8.5 8.5 4 12l4.5 3.5" />
          <path d="M4 12h10a5.5 5.5 0 0 1 0 11h-2" />
        </svg>
      );
    case "truck":
      return (
        <svg {...props}>
          <rect x="2" y="7" width="12" height="9" rx="1" />
          <path d="M14 10h4l3.5 3.5V16H14Z" />
          <circle cx="6.5" cy="17.5" r="1.7" />
          <circle cx="17" cy="17.5" r="1.7" />
        </svg>
      );
    case "box":
      return (
        <svg {...props}>
          <path d="M12 3 3 7.5 12 12l9-4.5Z" />
          <path d="M3 7.5V16l9 4.5 9-4.5V7.5" />
          <path d="M12 12v8.5" />
        </svg>
      );
    case "road":
      return (
        <svg {...props}>
          <path d="M9 3 5 21" />
          <path d="M15 3l4 18" />
          <path d="M12 4v3M12 10.5v3M12 17v3" />
        </svg>
      );
    case "swap":
      return (
        <svg {...props}>
          <path d="M4 8h13" />
          <path d="M13 4l4 4-4 4" />
          <path d="M20 16H7" />
          <path d="M11 20l-4-4 4-4" />
        </svg>
      );
    case "note":
      return (
        <svg {...props}>
          <path d="M4 20.5 4.8 17 16 5.8a1.8 1.8 0 0 1 2.5 0l.7.7a1.8 1.8 0 0 1 0 2.5L8 20.2Z" />
          <path d="M14 8l2.5 2.5" />
        </svg>
      );
    case "wallet":
      return (
        <svg {...props}>
          <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h13A1.5 1.5 0 0 1 19 7.5V9h-4a3 3 0 0 0 0 6h4v1.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 16.5Z" />
          <circle cx="15.5" cy="12" r="1" />
        </svg>
      );
    case "hash":
      return (
        <svg {...props}>
          <path d="M9 3 7 21M17 3l-2 18M4 8.5h16M3.5 15.5h16" />
        </svg>
      );
    case "trash":
      return (
        <svg {...props}>
          <path d="M4 7h16" />
          <path d="M6 7l1 13a1.5 1.5 0 0 0 1.5 1.4h7a1.5 1.5 0 0 0 1.5-1.4L18 7" />
          <path d="M9.5 7V4.5A1 1 0 0 1 10.5 3.5h3a1 1 0 0 1 1 1V7" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      );
    case "search":
      return (
        <svg {...props}>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M20 20l-4.8-4.8" />
        </svg>
      );
    case "book":
      return (
        <svg {...props}>
          <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H12v16H5.5A1.5 1.5 0 0 1 4 18.5Z" />
          <path d="M12 4h6.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H12" />
        </svg>
      );
    case "download":
      return (
        <svg {...props}>
          <path d="M12 3v12" />
          <path d="M7 10l5 5 5-5" />
          <path d="M4 19.5h16" />
        </svg>
      );
    case "settings":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3.2" />
          <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.3-1.6-2.8-2.3.8a7.5 7.5 0 0 0-2.6-1.5L14.5 3h-5l-.4 2.7a7.5 7.5 0 0 0-2.6 1.5l-2.3-.8-1.6 2.8 2 1.3a7.6 7.6 0 0 0 0 3l-2 1.3 1.6 2.8 2.3-.8a7.5 7.5 0 0 0 2.6 1.5l.4 2.7h5l.4-2.7a7.5 7.5 0 0 0 2.6-1.5l2.3.8 1.6-2.8Z" />
        </svg>
      );
    case "list":
      return (
        <svg {...props}>
          <path d="M8 6h13M8 12h13M8 18h13" />
          <circle cx="3.5" cy="6" r="1" fill="currentColor" stroke="none" />
          <circle cx="3.5" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="3.5" cy="18" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...props}>
          <path d="M20 11a8 8 0 0 0-14.6-4.4M4 13a8 8 0 0 0 14.6 4.4" />
          <path d="M5 3v4.5H9.5M19 21v-4.5H14.5" />
        </svg>
      );
    case "check":
      return (
        <svg {...props}>
          <path d="M4 12.5l5.5 5.5L20 6.5" />
        </svg>
      );
    case "close":
      return (
        <svg {...props}>
          <path d="M5 5l14 14M19 5 5 19" />
        </svg>
      );
    case "plus":
      return (
        <svg {...props}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "menu":
      return (
        <svg {...props}>
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      );
    case "warning":
      return (
        <svg {...props}>
          <path d="M12 3 22 20H2Z" />
          <path d="M12 9.5v5" />
          <circle cx="12" cy="17.3" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case "info":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6" />
          <circle cx="12" cy="7.5" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...props}>
          <rect x="3.5" y="5" width="17" height="16" rx="1.5" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
      );
    case "filter":
      return (
        <svg {...props}>
          <path d="M4 5h16l-6.5 7.5V19l-3 2v-8.5Z" />
        </svg>
      );
    case "chevron-right":
      return (
        <svg {...props}>
          <path d="M9 5l7 7-7 7" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg {...props}>
          <path d="M5 9l7 7 7-7" />
        </svg>
      );
    case "print":
      return (
        <svg {...props}>
          <path d="M7 9V3h10v6" />
          <rect x="4" y="9" width="16" height="8" rx="1.3" />
          <path d="M7 14h10v7H7Z" />
        </svg>
      );
    case "camera":
      return (
        <svg {...props}>
          <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.3-2h5.4L16 7h2.5A1.5 1.5 0 0 1 20 8.5v10A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5Z" />
          <circle cx="12" cy="13" r="3.3" />
        </svg>
      );
    case "link":
      return (
        <svg {...props}>
          <path d="M9.5 14.5 14.5 9.5" />
          <path d="M11 6.5l1.5-1.5a4 4 0 0 1 5.6 5.6L16.5 12" />
          <path d="M13 17.5 11.5 19a4 4 0 0 1-5.6-5.6L7.5 12" />
        </svg>
      );
    case "eye":
      return (
        <svg {...props}>
          <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
          <circle cx="12" cy="12" r="2.7" />
        </svg>
      );
    case "edit":
      return (
        <svg {...props}>
          <path d="M4 20.5 4.8 17 16 5.8a1.8 1.8 0 0 1 2.5 0l.7.7a1.8 1.8 0 0 1 0 2.5L8 20.2Z" />
          <path d="M14 8l2.5 2.5" />
        </svg>
      );
    case "lightning":
      return (
        <svg {...props}>
          <path d="M13 3 5 13.5h5.5L11 21l8-11h-5.5Z" />
        </svg>
      );
    default:
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
  }
}