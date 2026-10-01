import { NextRequest, NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, uploadParts } from "@/lib/schema";
import { saveFile } from "@/lib/storage";
import { validateFile, MAX_FILE_BYTES } from "@/lib/validate";

export const maxDuration = 30;

/**
 * POST /api/documents/[id]/complete
 * Assembles all upload_parts in order, validates the assembled buffer
 * (magic bytes + total size), saves via lib/storage, deletes parts,
 * then triggers async processing by returning immediately with { ok: true }.
 *
 * The client should then POST /api/documents/[id]/process to start extraction.
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
        sizeBytes: documents.sizeBytes,
        status: documents.status,
      })
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);

    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (doc.status !== "uploading") {
      return NextResponse.json(
        { error: `Document is in state "${doc.status}", expected "uploading"` },
        { status: 409 }
      );
    }

    // 2. Load all parts in order
    const parts = await db
      .select({ partIndex: uploadParts.partIndex, bytes: uploadParts.bytes })
      .from(uploadParts)
      .where(eq(uploadParts.documentId, id))
      .orderBy(asc(uploadParts.partIndex));

    if (parts.length === 0) {
      return NextResponse.json(
        { error: "No upload parts found for this document" },
        { status: 400 }
      );
    }

    // 3. Validate no missing indexes
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].partIndex !== i) {
        return NextResponse.json(
          { error: `Missing part at index ${i}. Expected sequential parts starting from 0.` },
          { status: 400 }
        );
      }
    }

    // 4. Assemble buffer
    const buffers = parts.map((p) => {
      const b = p.bytes;
      return Buffer.isBuffer(b) ? b : Buffer.from(b as any);
    });
    const assembled = Buffer.concat(buffers);

    // 5. Validate total size
    if (assembled.length > MAX_FILE_BYTES) {
      const mb = (assembled.length / 1024 / 1024).toFixed(1);
      await db
        .update(documents)
        .set({ status: "failed", errorMessage: `Assembled file is ${mb} MB — max is 40 MB.` })
        .where(eq(documents.id, id));
      return NextResponse.json(
        { error: `Assembled file is ${mb} MB — ClauseLens supports files up to 40 MB.` },
        { status: 413 }
      );
    }

    // 6. Validate magic bytes
    const validation = validateFile(doc.name, assembled.length, assembled);
    if (!validation.ok) {
      await db
        .update(documents)
        .set({ status: "failed", errorMessage: validation.message })
        .where(eq(documents.id, id));
      return NextResponse.json({ error: validation.message }, { status: 422 });
    }

    // 7. Save assembled file to storage
    await saveFile(id, assembled);

    // 8. Delete parts now that file is saved
    await db.delete(uploadParts).where(eq(uploadParts.documentId, id));

    // 9. Update status to extracting — process route will do the real work
    await db
      .update(documents)
      .set({
        status: "extracting",
        statusDetail: "Starting text extraction…",
        mime: validation.mime,
        sizeBytes: assembled.length,
      })
      .where(eq(documents.id, id));

    return NextResponse.json({ ok: true, id });
  } catch (error: any) {
    console.error(`Complete failed for doc ${id}:`, error);

    try {
      await db
        .update(documents)
        .set({ status: "failed", errorMessage: error?.message || "Assembly failed" })
        .where(eq(documents.id, id));
    } catch {}

    return NextResponse.json(
      { error: "Failed to complete upload", details: error?.message },
      { status: 500 }
    );
  }
}
