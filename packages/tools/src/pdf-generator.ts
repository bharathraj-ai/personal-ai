/**
 * PDF Generator — create professional PDFs programmatically.
 * Uses PDFKit for pure-JS PDF creation without external dependencies.
 */

import PDFDocument from "pdfkit";
import { Writable } from "node:stream";

export interface PdfSection {
  type: "heading" | "subheading" | "paragraph" | "table" | "list" | "code" | "divider" | "pagebreak";
  content?: string;
  rows?: string[][];   // For type: "table" — first row is headers
  items?: string[];    // For type: "list"
}

export interface PdfGenerateOptions {
  title: string;
  subtitle?: string;
  author?: string;
  date?: string;
  sections: PdfSection[];
  /** Page margins in points (1 pt = 1/72 inch). Default: 72 */
  margins?: { top?: number; bottom?: number; left?: number; right?: number };
  /** Whether to include page numbers. Default: true */
  pageNumbers?: boolean;
  /** Primary accent color (hex). Default: #1a1a2e */
  accentColor?: string;
}

export interface PdfGenerateResult {
  buffer: Buffer;
  pageCount: number;
  byteSize: number;
  error?: string;
}

/** Generate a PDF and return it as a Buffer */
export async function generatePdf(options: PdfGenerateOptions): Promise<PdfGenerateResult> {
  return new Promise((resolve) => {
    try {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({
        size: "A4",
        margins: {
          top: options.margins?.top ?? 72,
          bottom: options.margins?.bottom ?? 72,
          left: options.margins?.left ?? 72,
          right: options.margins?.right ?? 72,
        },
        info: {
          Title: options.title,
          Author: options.author ?? "Personal AI",
          Creator: "Personal AI PDF Generator",
          CreationDate: new Date(),
        },
      });

      const writable = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          callback();
        },
      });

      doc.pipe(writable);

      const accent = options.accentColor ?? "#1a1a2e";
      const PAGE_WIDTH = doc.page.width - (options.margins?.left ?? 72) - (options.margins?.right ?? 72);

      // ── Cover ──────────────────────────────────────────────────────────────
      doc.rect(0, 0, doc.page.width, 8).fill(accent);
      doc.fillColor(accent)
        .font("Helvetica-Bold")
        .fontSize(26)
        .text(options.title, { align: "left" });

      if (options.subtitle) {
        doc.moveDown(0.4).fillColor("#555555").fontSize(14).font("Helvetica").text(options.subtitle, { align: "left" });
      }

      const meta = [options.author, options.date].filter(Boolean).join("  ·  ");
      if (meta) {
        doc.moveDown(0.3).fillColor("#888888").fontSize(10).text(meta, { align: "left" });
      }

      doc.moveDown(1.5)
        .strokeColor(accent)
        .lineWidth(1)
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.margins.left + PAGE_WIDTH, doc.y)
        .stroke();
      doc.moveDown(1.5);

      // ── Body sections ──────────────────────────────────────────────────────
      for (const section of options.sections) {
        switch (section.type) {
          case "heading":
            doc
              .fillColor(accent)
              .font("Helvetica-Bold")
              .fontSize(16)
              .text(section.content ?? "", { underline: false })
              .moveDown(0.4)
              .strokeColor("#e0e0e0")
              .lineWidth(0.5)
              .moveTo(doc.page.margins.left, doc.y)
              .lineTo(doc.page.margins.left + PAGE_WIDTH, doc.y)
              .stroke()
              .moveDown(0.6);
            break;

          case "subheading":
            doc
              .fillColor("#333333")
              .font("Helvetica-Bold")
              .fontSize(13)
              .text(section.content ?? "")
              .moveDown(0.4);
            break;

          case "paragraph":
            doc
              .fillColor("#222222")
              .font("Helvetica")
              .fontSize(11)
              .text(section.content ?? "", { lineGap: 3 })
              .moveDown(0.8);
            break;

          case "code":
            doc
              .fillColor("#f5f5f5")
              .rect(doc.page.margins.left, doc.y, PAGE_WIDTH, 12)
              .fill();
            doc
              .fillColor("#cc3300")
              .font("Courier")
              .fontSize(9)
              .text(section.content ?? "", {
                lineGap: 2,
              })
              .moveDown(0.8);
            break;

          case "list":
            for (const item of (section.items ?? [])) {
              doc
                .fillColor("#222222")
                .font("Helvetica")
                .fontSize(11)
                .text(`• ${item}`, {
                  indent: 12,
                  lineGap: 2,
                });
            }
            doc.moveDown(0.8);
            break;

          case "table": {
            const rows = section.rows ?? [];
            if (rows.length === 0) break;
            const colCount = Math.max(...rows.map((r) => r.length));
            const colWidth = PAGE_WIDTH / colCount;
            let y = doc.y;

            for (let ri = 0; ri < rows.length; ri++) {
              const row = rows[ri];
              const isHeader = ri === 0;
              const rowHeight = 20;

              if (isHeader) {
                doc.fillColor(accent).rect(doc.page.margins.left, y, PAGE_WIDTH, rowHeight).fill();
              } else {
                const bg = ri % 2 === 0 ? "#f9f9f9" : "#ffffff";
                doc.fillColor(bg).rect(doc.page.margins.left, y, PAGE_WIDTH, rowHeight).fill();
              }

              for (let ci = 0; ci < colCount; ci++) {
                const cell = row[ci] ?? "";
                const x = doc.page.margins.left + ci * colWidth;
                doc
                  .fillColor(isHeader ? "#ffffff" : "#222222")
                  .font(isHeader ? "Helvetica-Bold" : "Helvetica")
                  .fontSize(10)
                  .text(cell, x + 4, y + 5, { width: colWidth - 8, height: rowHeight - 6 });
              }

              // Border
              doc.strokeColor("#dddddd").lineWidth(0.5)
                .rect(doc.page.margins.left, y, PAGE_WIDTH, rowHeight).stroke();

              y += rowHeight;
            }
            doc.y = y + 12;
            doc.moveDown(0.4);
            break;
          }

          case "divider":
            doc.moveDown(0.5)
              .strokeColor("#e0e0e0")
              .lineWidth(0.5)
              .moveTo(doc.page.margins.left, doc.y)
              .lineTo(doc.page.margins.left + PAGE_WIDTH, doc.y)
              .stroke()
              .moveDown(0.5);
            break;

          case "pagebreak":
            doc.addPage();
            break;
        }
      }

      // ── Page numbers ───────────────────────────────────────────────────────
      if (options.pageNumbers !== false) {
        const totalPages = (doc as unknown as { _pageBuffer?: unknown[] })._pageBuffer?.length ?? 1;
        for (let i = 0; i < totalPages; i++) {
          doc.switchToPage(i);
          doc
            .fillColor("#aaaaaa")
            .font("Helvetica")
            .fontSize(9)
            .text(
              `${options.title}  ·  Page ${i + 1} of ${totalPages}`,
              doc.page.margins.left,
              doc.page.height - doc.page.margins.bottom + 10,
              { align: "center", width: PAGE_WIDTH },
            );
        }
      }

      doc.end();

      writable.on("finish", () => {
        const buffer = Buffer.concat(chunks);
        resolve({ buffer, pageCount: 1, byteSize: buffer.byteLength });
      });

      writable.on("error", (err) => {
        resolve({ buffer: Buffer.alloc(0), pageCount: 0, byteSize: 0, error: String(err) });
      });
    } catch (err) {
      resolve({
        buffer: Buffer.alloc(0),
        pageCount: 0,
        byteSize: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

/** Helper — build a report PDF from a structured report object */
export function buildReportSections(report: {
  summary: string;
  items: Array<{ label: string; value: string }>;
  details?: string;
  codeBlocks?: Array<{ label: string; code: string }>;
}): PdfSection[] {
  const sections: PdfSection[] = [];

  if (report.summary) {
    sections.push({ type: "paragraph", content: report.summary });
    sections.push({ type: "divider" });
  }

  if (report.items.length > 0) {
    sections.push({ type: "heading", content: "Summary" });
    sections.push({
      type: "table",
      rows: [["Field", "Value"], ...report.items.map((i) => [i.label, i.value])],
    });
  }

  if (report.details) {
    sections.push({ type: "heading", content: "Details" });
    sections.push({ type: "paragraph", content: report.details });
  }

  for (const block of report.codeBlocks ?? []) {
    sections.push({ type: "subheading", content: block.label });
    sections.push({ type: "code", content: block.code });
  }

  return sections;
}
