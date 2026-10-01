import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, pages, chunks } from "@/lib/schema";
import { saveFile } from "@/lib/storage";
import { extractPdf, extractDocx, chunkDocument } from "@/lib/extraction";

export async function POST(req: NextRequest) {
  let createdDocId: string | null = null;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const name = file.name;
    const sizeBytes = file.size;
    let mime = file.type;

    if (!mime || mime === "application/octet-stream") {
      if (name.toLowerCase().endsWith(".pdf")) mime = "application/pdf";
      else if (name.toLowerCase().endsWith(".docx"))
        mime =
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }

    const isPdf =
      mime === "application/pdf" || name.toLowerCase().endsWith(".pdf");
    const isDocx =
      mime.includes("wordprocessingml") || name.toLowerCase().endsWith(".docx");

    if (!isPdf && !isDocx) {
      return NextResponse.json(
        { error: "Unsupported file format. Please upload a PDF or DOCX contract." },
        { status: 400 }
      );
    }

    // 1. Create document record in DB with extracting status
    const [doc] = await db
      .insert(documents)
      .values({
        name,
        mime,
        sizeBytes,
        status: "extracting",
        statusDetail: "Reading contract text and extracting page boundaries...",
      })
      .returning();

    createdDocId = doc.id;

    // 2. Read file bytes and save to PostgreSQL bytea storage
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await saveFile(doc.id, buffer);

    // 3. Extract canonical text and pages
    let extracted;
    if (isPdf) {
      extracted = await extractPdf(buffer);
    } else {
      extracted = await extractDocx(buffer);
    }

    // 4. Batch insert pages
    if (extracted.pages.length > 0) {
      const pageRows = extracted.pages.map((p) => ({
        documentId: doc.id,
        pageNumber: p.pageNumber,
        startOffset: p.startOffset,
        endOffset: p.endOffset,
      }));
      await db.insert(pages).values(pageRows);
    }

    // 5. Chunk canonical text and batch insert chunks
    const chunkList = chunkDocument(extracted.canonicalText, extracted.pages);
    if (chunkList.length > 0) {
      const chunkRows = chunkList.map((c) => ({
        documentId: doc.id,
        idx: c.idx,
        startOffset: c.startOffset,
        endOffset: c.endOffset,
        pageStart: c.pageStart,
        pageEnd: c.pageEnd,
        sectionLabel: c.sectionLabel,
        text: c.text,
      }));
      await db.insert(chunks).values(chunkRows);
    }

    // 6. Update document to ready status
    const [updatedDoc] = await db
      .update(documents)
      .set({
        status: "ready",
        statusDetail: `Extracted ${extracted.pageCount} pages and ${chunkList.length} clauses/chunks`,
        pageCount: extracted.pageCount,
        canonicalText: extracted.canonicalText,
        htmlContent: extracted.htmlContent || null,
      })
      .where(eq(documents.id, doc.id))
      .returning();

    return NextResponse.json({
      success: true,
      document: {
        id: updatedDoc.id,
        name: updatedDoc.name,
        mime: updatedDoc.mime,
        sizeBytes: updatedDoc.sizeBytes,
        pageCount: updatedDoc.pageCount,
        status: updatedDoc.status,
      },
    });
  } catch (error: any) {
    console.error("Document upload/extraction failed:", error);

    if (createdDocId) {
      try {
        await db
          .update(documents)
          .set({
            status: "failed",
            statusDetail: "Extraction failed",
            errorMessage: error?.message || "Unknown error during text extraction",
          })
          .where(eq(documents.id, createdDocId));
      } catch {}
    }

    return NextResponse.json(
      {
        error: "Failed to process document",
        details: error?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
