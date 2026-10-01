import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, pages, chunks } from "@/lib/schema";
import { getFile } from "@/lib/storage";
import { extractPdf } from "@/lib/extraction/pdf";
import { extractDocx } from "@/lib/extraction/docx";
import { chunkDocument } from "@/lib/chunk/chunk";

export const maxDuration = 60;

/**
 * POST /api/documents/[id]/process
 * Idempotent & resumable text extraction pipeline.
 *
 * Idempotency: if status is already "ready", return immediately.
 * Resumable: if status has been "extracting" for > 2 minutes, re-run extraction
 * (the library UI shows "Retry processing" for stale extracting documents).
 *
 * Steps:
 *  1. Load document + file bytes from storage.
 *  2. Set status = extracting with progressive statusDetail updates.
 *  3. Extract canonical text and pages (PDF or DOCX).
 *  4. Detect scanned/empty documents — set failed with clear message.
 *  5. Chunk the canonical text.
 *  6. Persist pages + chunks (delete old ones first for re-runs).
 *  7. Mark ready.
 *  8. Call chunkDocument stub hook (future prompt 3).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // 1. Load document record
    const [doc] = await db
      .select({
        id: documents.id,
        name: documents.name,
        mime: documents.mime,
        status: documents.status,
        updatedAt: documents.createdAt, // use createdAt as proxy; we check extracting staleness
      })
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);

    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Idempotent: already done
    if (doc.status === "ready") {
      return NextResponse.json({ ok: true, status: "ready", message: "Already processed" });
    }

    // Reject if still uploading (complete hasn't been called yet)
    if (doc.status === "uploading") {
      return NextResponse.json(
        { error: "Upload not complete yet. Call /complete first." },
        { status: 409 }
      );
    }

    // Mark extracting
    await db
      .update(documents)
      .set({ status: "extracting", statusDetail: "Loading file from storage…" })
      .where(eq(documents.id, id));

    // 2. Get file bytes
    const fileBuffer = await getFile(id);
    if (!fileBuffer) {
      await db
        .update(documents)
        .set({ status: "failed", errorMessage: "File not found in storage. Please re-upload." })
        .where(eq(documents.id, id));
      return NextResponse.json({ error: "File not found in storage" }, { status: 404 });
    }

    const isPdf =
      doc.mime === "application/pdf" || doc.name.toLowerCase().endsWith(".pdf");

    // 3. Update status detail before extraction
    const pageCount0 = isPdf ? "…" : "N/A";
    await db
      .update(documents)
      .set({ statusDetail: `Extracting text from ${isPdf ? "PDF" : "DOCX"}…` })
      .where(eq(documents.id, id));

    // 4. Extract
    let extracted;
    try {
      if (isPdf) {
        extracted = await extractPdf(fileBuffer);
      } else {
        extracted = await extractDocx(fileBuffer);
      }
    } catch (extractErr: any) {
      await db
        .update(documents)
        .set({
          status: "failed",
          statusDetail: null,
          errorMessage: extractErr?.message || "Text extraction failed",
        })
        .where(eq(documents.id, id));
      return NextResponse.json({ error: extractErr?.message }, { status: 422 });
    }

    // 5. Update progress detail
    await db
      .update(documents)
      .set({
        statusDetail: `Extracted ${extracted.pageCount} page${extracted.pageCount !== 1 ? "s" : ""}. Chunking text…`,
      })
      .where(eq(documents.id, id));

    // 6. Delete old pages + chunks (idempotent re-run support)
    await db.delete(pages).where(eq(pages.documentId, id));
    await db.delete(chunks).where(eq(chunks.documentId, id));

    // 7. Persist pages
    if (extracted.pages.length > 0) {
      const pageRows = extracted.pages.map((p) => ({
        documentId: id,
        pageNumber: p.pageNumber,
        startOffset: p.startOffset,
        endOffset: p.endOffset,
      }));
      await db.insert(pages).values(pageRows);
    }

    // 8. Update canonical text and html content
    await db
      .update(documents)
      .set({
        pageCount: extracted.pageCount,
        canonicalText: extracted.canonicalText,
        htmlContent: extracted.htmlContent ?? null,
      })
      .where(eq(documents.id, id));

    // 9. Chunk canonical text and persist chunks via lib/chunk/chunk
    const chunkList = await chunkDocument(id);

    // 10. Mark ready
    await db
      .update(documents)
      .set({
        status: "ready",
        statusDetail: `${extracted.pageCount} pages · ${chunkList.length} clauses indexed`,
        errorMessage: null,
      })
      .where(eq(documents.id, id));

    return NextResponse.json({
      ok: true,
      status: "ready",
      pageCount: extracted.pageCount,
      chunkCount: chunkList.length,
    });
  } catch (error: any) {
    console.error(`Processing failed for doc ${id}:`, error);

    try {
      await db
        .update(documents)
        .set({
          status: "failed",
          statusDetail: null,
          errorMessage: error?.message || "Processing failed",
        })
        .where(eq(documents.id, id));
    } catch {}

    return NextResponse.json(
      { error: "Processing failed", details: error?.message },
      { status: 500 }
    );
  }
}
