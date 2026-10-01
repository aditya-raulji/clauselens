import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, uploadParts } from "@/lib/schema";

/**
 * POST /api/documents/[id]/parts?index=n
 * Store one 3 MB part for the given document.
 * Body: raw binary (application/octet-stream) or FormData with "part" file field.
 *
 * On success: { ok: true, partIndex: n }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const indexStr = searchParams.get("index");

  if (!id || indexStr === null) {
    return NextResponse.json(
      { error: "Missing document id or part index" },
      { status: 400 }
    );
  }

  const partIndex = parseInt(indexStr, 10);
  if (isNaN(partIndex) || partIndex < 0) {
    return NextResponse.json({ error: "Invalid part index" }, { status: 400 });
  }

  try {
    // Verify document exists and is in uploading state
    const [doc] = await db
      .select({ id: documents.id, status: documents.status })
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

    // Read body as raw binary
    const arrayBuffer = await req.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      return NextResponse.json({ error: "Empty part body" }, { status: 400 });
    }

    // Upsert part (idempotent — retrying the same part index is safe)
    const existing = await db
      .select({ id: uploadParts.id })
      .from(uploadParts)
      .where(
        and(
          eq(uploadParts.documentId, id),
          eq(uploadParts.partIndex, partIndex)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      // Replace existing part (retry scenario)
      await db
        .delete(uploadParts)
        .where(
          and(
            eq(uploadParts.documentId, id),
            eq(uploadParts.partIndex, partIndex)
          )
        );
    }

    await db.insert(uploadParts).values({
      documentId: id,
      partIndex,
      bytes: buffer,
    });

    return NextResponse.json({ ok: true, partIndex });
  } catch (error: any) {
    console.error(`Failed to store part ${partIndex} for doc ${id}:`, error);
    return NextResponse.json(
      { error: "Failed to store part", details: error?.message },
      { status: 500 }
    );
  }
}
