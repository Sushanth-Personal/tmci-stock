// src/app/api/datasheet/route.ts
// Searches Google Drive for a datasheet file matching a model name.
// Files should be in a shared folder, named like "Fluke 289.pdf".
// The folder ID is set via GOOGLE_DRIVE_DATASHEET_FOLDER_ID env var.
// If no folder ID is set, searches all of Drive (slower).

import { NextResponse } from "next/server";
import { google } from "googleapis";

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Missing Google service account env vars");
  return new google.auth.JWT({
    email,
    key,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const model = searchParams.get("model");

    if (!model) {
      return NextResponse.json({ error: "model param required" }, { status: 400 });
    }

    const auth = getAuth();
    const drive = google.drive({ version: "v3", auth });
    const folderId = process.env.GOOGLE_DRIVE_DATASHEET_FOLDER_ID;

    // Build query: search by name containing the model string
    // Tries exact match first, then fuzzy (model words)
    const inFolder = folderId ? ` and '${folderId}' in parents` : "";
    const q = `name contains '${model.replace(/'/g, "\\'")}' and trashed = false${inFolder}`;

    const res = await drive.files.list({
      q,
      fields: "files(id, name, mimeType, webViewLink, webContentLink, size)",
      orderBy: "name",
      pageSize: 5,
    });

    const files = res.data.files ?? [];

    if (files.length === 0) {
      return NextResponse.json({ found: false, files: [] });
    }

    // Make files publicly accessible via link (if not already)
    // This uses the service account — ensure the folder is shared with the service account
    const enriched = files.map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      viewLink: f.webViewLink,   // opens in Drive viewer
      downloadLink: f.webContentLink, // direct download
      size: f.size ? Math.round(+f.size / 1024) + " KB" : null,
    }));

    return NextResponse.json({ found: true, files: enriched });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}