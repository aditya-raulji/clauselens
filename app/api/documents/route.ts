import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents } from "@/lib/schema";

/**
 * GET /api/documents
 * Lightweight document list query (strictly excludes heavy binary bytea)
 */
export async function GET() {
  try {
    const docList = await db
      .select({
        id: documents.id,
        name: documents.name,
        mime: documents.mime,
        sizeBytes: documents.sizeBytes,
        status: documents.status,
        statusDetail: documents.statusDetail,
        errorMessage: documents.errorMessage,
        pageCount: documents.pageCount,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .orderBy(desc(documents.createdAt));

    return NextResponse.json({ documents: docList });
  } catch (error: any) {
    console.error("Failed to list documents:", error);
    return NextResponse.json(
      { error: "Failed to list documents", details: error?.message },
      { status: 500 }
    );
  }
}
