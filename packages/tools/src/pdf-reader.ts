/**
 * PDF Reader — extract text from PDFs.
 * Uses pdf-parse@2.4.5 (class-based API with getText / getInfo methods).
 * Falls back gracefully if the library is unavailable.
 */

export interface PdfPage {
  pageNumber: number;
  text: string;
  charCount: number;
}

export interface PdfReadResult {
  /** Full concatenated text */
  text: string;
  pages: PdfPage[];
  pageCount: number;
  info?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface PdfSearchResult {
  pageNumber: number;
  excerpt: string;
  score: number;
}

/** Extract all text from a PDF buffer */
export async function readPdf(buffer: Buffer): Promise<PdfReadResult> {
  try {
    // pdf-parse@2.4.5: class-based API. Constructor requires LoadParameters object.
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });

    // getText() returns TextResult { pages: [{num, text}], text: string }
    const textResult = await parser.getText();
    await parser.destroy();

    const pages: PdfPage[] = (textResult.pages ?? []).map(
      (p, i: number) => ({
        pageNumber: (p as unknown as { num?: number }).num ?? i + 1,
        text: (p.text ?? "").trim(),
        charCount: (p.text ?? "").trim().length,
      }),
    );

    // If no structured pages, try splitting by form-feed
    if (pages.length === 0 && textResult.text?.trim()) {
      const rawPages = textResult.text.split(/\f/).filter((p: string) => p.trim());
      for (let i = 0; i < rawPages.length; i++) {
        const t = rawPages[i].trim();
        pages.push({ pageNumber: i + 1, text: t, charCount: t.length });
      }
      if (pages.length === 0) {
        const t = textResult.text.trim();
        pages.push({ pageNumber: 1, text: t, charCount: t.length });
      }
    }

    // Optional: get info/metadata
    let info: Record<string, unknown> | undefined;
    try {
      const infoResult = await (async () => {
        const parser2 = new PDFParse({ data: new Uint8Array(buffer) });
        const r = await parser2.getInfo();
        await parser2.destroy();
        return r;
      })();
      info = infoResult as unknown as Record<string, unknown>;
    } catch {
      // metadata is optional — don't fail the whole extraction
    }

    return {
      text: textResult.text ?? pages.map((p) => p.text).join("\n\n"),
      pages,
      pageCount: pages.length,
      info,
    };
  } catch (err) {
    return {
      text: "",
      pages: [],
      pageCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Get text for a specific page (1-indexed) */
export function getPage(result: PdfReadResult, pageNumber: number): PdfPage | null {
  return result.pages.find((p) => p.pageNumber === pageNumber) ?? null;
}

/** Search for a query within PDF pages */
export function searchPdf(result: PdfReadResult, query: string, limit = 5): PdfSearchResult[] {
  const q = query.toLowerCase();
  const results: PdfSearchResult[] = [];

  for (const page of result.pages) {
    const text = page.text.toLowerCase();
    const idx = text.indexOf(q);
    if (idx === -1) continue;

    const start = Math.max(0, idx - 100);
    const end = Math.min(page.text.length, idx + q.length + 200);
    const excerpt =
      (start > 0 ? "…" : "") +
      page.text.slice(start, end) +
      (end < page.text.length ? "…" : "");

    // Simple score: term frequency
    const freq = (
      text.match(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []
    ).length;
    results.push({ pageNumber: page.pageNumber, excerpt, score: freq });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Summarize a PDF — returns the first N chars per page as structured context */
export function buildPdfContext(result: PdfReadResult, maxChars = 4000): string {
  if (result.error) return `PDF extraction failed: ${result.error}`;
  if (result.pages.length === 0) return "No text content found in PDF.";

  const parts: string[] = [`[PDF: ${result.pageCount} pages]\n`];
  let remaining = maxChars;

  for (const page of result.pages) {
    if (remaining <= 0) break;
    const chunk = page.text.slice(0, remaining);
    parts.push(`--- Page ${page.pageNumber} ---\n${chunk}`);
    remaining -= chunk.length;
  }

  return parts.join("\n\n");
}
