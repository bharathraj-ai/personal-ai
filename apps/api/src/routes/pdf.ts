/**
 * PDF API routes:
 *   POST /pdf/upload      — upload a PDF file (base64 encoded), extract text
 *   POST /pdf/read-page   — get text for a specific page
 *   POST /pdf/search      — search within a PDF
 *   POST /pdf/summarize   — AI-generated summary of a PDF or page
 *   POST /pdf/generate    — generate a PDF from structured content
 *   GET  /pdf/download/:id — download a previously generated PDF
 */

import type { FastifyInstance } from "fastify";
import { requireAuth, AuthError } from "../auth/index.js";
import {
  readPdf,
  getPage,
  searchPdf,
  buildPdfContext,
  generatePdf,
  buildReportSections,
  type PdfSection,
} from "@personal-ai/tools";

// In-memory store for generated PDFs (keyed by id) — in production, use S3
const generatedPdfs = new Map<string, { buffer: Buffer; filename: string; createdAt: Date }>();

export function registerPdfRoutes(
  app: FastifyInstance,
  deps: {
    /** Optional: use the AI model to generate summaries */
    summarize?: (context: string, question: string) => Promise<string>;
  } = {},
) {
  /**
   * POST /pdf/upload
   * Body: { data: "<base64 PDF>", filename?: string }
   * Returns: { text, pages, pageCount, id }
   * The returned `id` can be used to reference this PDF in subsequent calls.
   */
  app.post<{ Body: { data: string; filename?: string } }>("/pdf/upload", async (request, reply) => {
    try {
      requireAuth(request);
    } catch (err) {
      if (err instanceof AuthError) return reply.status(err.statusCode).send({ error: err.message });
      throw err;
    }

    const { data, filename } = request.body;
    if (!data || typeof data !== "string") {
      return reply.status(400).send({ error: "data (base64 PDF) is required" });
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(data, "base64");
    } catch {
      return reply.status(400).send({ error: "data must be valid base64" });
    }

    if (buffer[0] !== 0x25 || buffer[1] !== 0x50) {
      // Not %PDF
      return reply.status(400).send({ error: "data does not appear to be a valid PDF" });
    }

    const result = await readPdf(buffer);
    if (result.error) {
      return reply.status(422).send({ error: result.error });
    }

    const id = crypto.randomUUID();
    // Store raw buffer for re-reading pages
    (request as unknown as Record<string, unknown>)._pdfCache = result; // ephemeral

    return reply.send({
      id,
      filename: filename ?? "document.pdf",
      pageCount: result.pageCount,
      charCount: result.text.length,
      pages: result.pages.map((p) => ({
        pageNumber: p.pageNumber,
        charCount: p.charCount,
        preview: p.text.slice(0, 200),
      })),
    });
  });

  /**
   * POST /pdf/read-page
   * Body: { data: "<base64 PDF>", page: number }
   * Returns: { pageNumber, text }
   */
  app.post<{ Body: { data: string; page: number } }>("/pdf/read-page", async (request, reply) => {
    try {
      requireAuth(request);
    } catch (err) {
      if (err instanceof AuthError) return reply.status(err.statusCode).send({ error: err.message });
      throw err;
    }

    const { data, page } = request.body;
    if (!data || typeof data !== "string") {
      return reply.status(400).send({ error: "data (base64 PDF) is required" });
    }
    if (!page || typeof page !== "number" || page < 1) {
      return reply.status(400).send({ error: "page must be a positive integer" });
    }

    const buffer = Buffer.from(data, "base64");
    const result = await readPdf(buffer);
    if (result.error) return reply.status(422).send({ error: result.error });

    const pageData = getPage(result, page);
    if (!pageData) {
      return reply.status(404).send({
        error: `Page ${page} not found (PDF has ${result.pageCount} pages)`,
      });
    }

    return reply.send({ pageNumber: pageData.pageNumber, text: pageData.text, charCount: pageData.charCount });
  });

  /**
   * POST /pdf/search
   * Body: { data: "<base64 PDF>", query: string, limit?: number }
   * Returns: { results: [{ pageNumber, excerpt, score }] }
   */
  app.post<{ Body: { data: string; query: string; limit?: number } }>(
    "/pdf/search",
    async (request, reply) => {
      try {
        requireAuth(request);
      } catch (err) {
        if (err instanceof AuthError) return reply.status(err.statusCode).send({ error: err.message });
        throw err;
      }

      const { data, query, limit } = request.body;
      if (!data || !query) {
        return reply.status(400).send({ error: "data and query are required" });
      }

      const buffer = Buffer.from(data, "base64");
      const result = await readPdf(buffer);
      if (result.error) return reply.status(422).send({ error: result.error });

      const results = searchPdf(result, query, limit ?? 5);
      return reply.send({ query, results });
    },
  );

  /**
   * POST /pdf/summarize
   * Body: { data: "<base64 PDF>", question?: string, page?: number }
   * Returns: { summary, sources }
   */
  app.post<{ Body: { data: string; question?: string; page?: number } }>(
    "/pdf/summarize",
    async (request, reply) => {
      try {
        requireAuth(request);
      } catch (err) {
        if (err instanceof AuthError) return reply.status(err.statusCode).send({ error: err.message });
        throw err;
      }

      const { data, question, page } = request.body;
      if (!data) return reply.status(400).send({ error: "data (base64 PDF) is required" });

      const buffer = Buffer.from(data, "base64");
      const result = await readPdf(buffer);
      if (result.error) return reply.status(422).send({ error: result.error });

      let context: string;
      let sources: string[];

      if (page != null) {
        const pageData = getPage(result, page);
        if (!pageData) {
          return reply.status(404).send({ error: `Page ${page} not found` });
        }
        context = `Page ${page}:\n${pageData.text}`;
        sources = [`PDF page ${page}`];
      } else {
        context = buildPdfContext(result, 6000);
        sources = result.pages.slice(0, 5).map((p) => `Page ${p.pageNumber}`);
      }

      const q = question ?? "Provide a clear and concise summary of this content.";

      if (deps.summarize) {
        try {
          const summary = await deps.summarize(context, q);
          return reply.send({ summary, sources, pageCount: result.pageCount });
        } catch (err) {
          return reply.status(500).send({ error: `AI summarization failed: ${String(err)}` });
        }
      }

      // If no AI model provided, return the raw context as summary
      return reply.send({
        summary: context.slice(0, 3000),
        sources,
        pageCount: result.pageCount,
        note: "AI summarization not available — returning raw extracted text",
      });
    },
  );

  /**
   * POST /pdf/generate
   * Body: { title, subtitle?, author?, date?, sections, pageNumbers?, accentColor? }
   * Returns: { id, byteSize, pageCount, downloadUrl }
   *
   * Download via: GET /pdf/download/:id
   */
  app.post<{
    Body: {
      title: string;
      subtitle?: string;
      author?: string;
      date?: string;
      sections: PdfSection[];
      pageNumbers?: boolean;
      accentColor?: string;
    };
  }>("/pdf/generate", async (request, reply) => {
    try {
      requireAuth(request);
    } catch (err) {
      if (err instanceof AuthError) return reply.status(err.statusCode).send({ error: err.message });
      throw err;
    }

    const { title, subtitle, author, date, sections, pageNumbers, accentColor } = request.body;
    if (!title || typeof title !== "string") {
      return reply.status(400).send({ error: "title is required" });
    }
    if (!Array.isArray(sections) || sections.length === 0) {
      return reply.status(400).send({ error: "sections array is required and must not be empty" });
    }

    const result = await generatePdf({
      title,
      subtitle,
      author,
      date: date ?? new Date().toISOString().slice(0, 10),
      sections,
      pageNumbers: pageNumbers !== false,
      accentColor,
    });

    if (result.error) {
      return reply.status(500).send({ error: result.error });
    }

    const id = crypto.randomUUID();
    const filename = `${title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_${id.slice(0, 8)}.pdf`;
    generatedPdfs.set(id, { buffer: result.buffer, filename, createdAt: new Date() });

    // Auto-cleanup after 1 hour
    setTimeout(() => generatedPdfs.delete(id), 3_600_000);

    return reply.send({
      id,
      filename,
      byteSize: result.byteSize,
      pageCount: result.pageCount,
      downloadUrl: `/pdf/download/${id}`,
    });
  });

  /**
   * POST /pdf/generate-report
   * Shortcut to generate a report PDF from a structured report object.
   */
  app.post<{
    Body: {
      title: string;
      summary: string;
      items?: Array<{ label: string; value: string }>;
      details?: string;
      codeBlocks?: Array<{ label: string; code: string }>;
    };
  }>("/pdf/generate-report", async (request, reply) => {
    try {
      requireAuth(request);
    } catch (err) {
      if (err instanceof AuthError) return reply.status(err.statusCode).send({ error: err.message });
      throw err;
    }

    const { title, summary, items = [], details, codeBlocks = [] } = request.body;
    if (!title || !summary) {
      return reply.status(400).send({ error: "title and summary are required" });
    }

    const sections = buildReportSections({ summary, items, details, codeBlocks });
    const result = await generatePdf({
      title,
      author: "Personal AI",
      date: new Date().toISOString().slice(0, 10),
      sections,
    });

    if (result.error) {
      return reply.status(500).send({ error: result.error });
    }

    const id = crypto.randomUUID();
    const filename = `report_${id.slice(0, 8)}.pdf`;
    generatedPdfs.set(id, { buffer: result.buffer, filename, createdAt: new Date() });
    setTimeout(() => generatedPdfs.delete(id), 3_600_000);

    return reply.send({ id, filename, byteSize: result.byteSize, downloadUrl: `/pdf/download/${id}` });
  });

  /**
   * GET /pdf/download/:id
   * Download a previously generated PDF.
   */
  app.get<{ Params: { id: string } }>("/pdf/download/:id", async (request, reply) => {
    const { id } = request.params;
    const entry = generatedPdfs.get(id);
    if (!entry) {
      return reply.status(404).send({ error: "PDF not found or expired" });
    }

    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${entry.filename}"`)
      .header("Content-Length", String(entry.buffer.byteLength))
      .send(entry.buffer);
  });
}
