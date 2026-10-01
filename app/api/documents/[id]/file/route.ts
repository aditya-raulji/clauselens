import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents } from "@/lib/schema";
import { getFile } from "@/lib/storage";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const [doc] = await db
      .select({
        id: documents.id,
        mime: documents.mime,
        name: documents.name,
      })
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);

    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const fileBuffer = await getFile(id);
    if (!fileBuffer) {
      return NextResponse.json(
        { error: "Document file content not found in storage" },
        { status: 404 }
      );
    }

    const mime = doc.mime || "application/pdf";
    const uint8 = new Uint8Array(fileBuffer);

    return new NextResponse(uint8, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `inline; filename="${encodeURIComponent(doc.name)}"`,
        "Content-Length": uint8.byteLength.toString(),
        "Cache-Control": "public, max-age=3600, immutable",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to stream document file", details: error?.message },
      { status: 500 }
    );
  }
}
