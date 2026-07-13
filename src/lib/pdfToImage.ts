// src/lib/pdfToImage.ts
// Converts the first page of a PDF file into a PNG File object,
// so it can be fed into image-only vision APIs (Groq, Claude).

// IMPORTANT: pdfjs-dist touches browser-only globals (DOMMatrix) at module
// load time. A static top-level import gets pulled into the SSR bundle via
// GroqSaleScanner -> RecordSale -> page.tsx, and crashes on the server with
// "DOMMatrix is not defined". Load it dynamically, only when actually
// needed, so it never gets evaluated outside the browser.
async function getPdfjs() {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  return pdfjsLib;
}

export async function pdfFileToImageFile(
  file: File,
  opts: { scale?: number; pageNumber?: number } = {},
): Promise<File> {
  const { scale = 2.5, pageNumber = 1 } = opts;
  const pdfjsLib = await getPdfjs();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  if (pageNumber > pdf.numPages) {
    throw new Error(
      `Requested page ${pageNumber} but PDF only has ${pdf.numPages} page(s).`,
    );
  }

  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context");

  await page.render({ canvasContext: ctx, canvas, viewport }).promise;

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("Canvas toBlob failed"));
    }, "image/png");
  });

  const baseName = file.name.replace(/\.pdf$/i, "");
  return new File([blob], `${baseName}-page${pageNumber}.png`, {
    type: "image/png",
  });
}

// Returns page count without rendering, so callers can warn/offer a page
// picker for multi-page PDFs before committing to page 1.
export async function getPdfPageCount(file: File): Promise<number> {
  const pdfjsLib = await getPdfjs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  return pdf.numPages;
}
