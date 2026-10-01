import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents } from "@/lib/schema";

/**
 * GET /api/documents
 * Lightweight document list (excludes heavy binary/text columns).
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

/**
 * POST /api/documents
 * Create a document row with status "uploading".
 * Body: { name: string, sizeBytes: number, mime: string }
 * Returns { id } for the client to use in subsequent /parts and /complete calls.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, sizeBytes, mime } = body as {
      name: string;
      sizeBytes: number;
      mime: string;
    };

    if (!name || !sizeBytes || !mime) {
      return NextResponse.json(
        { error: "Missing required fields: name, sizeBytes, mime" },
        { status: 400 }
      );
    }

    const [doc] = await db
      .insert(documents)
      .values({
        name,
        mime,
        sizeBytes,
        status: "uploading",
        statusDetail: "Uploading file parts…",
      })
      .returning({ id: documents.id, name: documents.name });

    return NextResponse.json({ id: doc.id, name: doc.name });
  } catch (error: any) {
    console.error("Failed to create document row:", error);
    return NextResponse.json(
      { error: "Failed to create document", details: error?.message },
      { status: 500 }
    );
  }
}
