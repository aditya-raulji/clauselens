import { NextRequest, NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, pages } from "@/lib/schema";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const [doc] = await db
      .select({
        id: documents.id,
        name: documents.name,
        mime: documents.mime,
        sizeBytes: documents.sizeBytes,
        status: documents.status,
        statusDetail: documents.statusDetail,
        errorMessage: documents.errorMessage,
        pageCount: documents.pageCount,
        canonicalText: documents.canonicalText,
        htmlContent: documents.htmlContent,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);

    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const docPages = await db
      .select({
        id: pages.id,
        pageNumber: pages.pageNumber,
        startOffset: pages.startOffset,
        endOffset: pages.endOffset,
      })
      .from(pages)
      .where(eq(pages.documentId, id))
      .orderBy(asc(pages.pageNumber));

    return NextResponse.json({ document: doc, pages: docPages });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to fetch document", details: error?.message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const [deleted] = await db
      .delete(documents)
      .where(eq(documents.id, id))
      .returning({ id: documents.id });

    if (!deleted) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, id: deleted.id });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to delete document", details: error?.message },
      { status: 500 }
    );
  }
}
