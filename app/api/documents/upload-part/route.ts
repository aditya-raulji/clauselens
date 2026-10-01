import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { uploadParts } from "@/lib/schema";

/**
 * POST /api/documents/upload-part
 * Stores a chunk part for large contracts (>4MB) to bypass serverless body limits
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const documentId = formData.get("documentId") as string;
    const partIndexStr = formData.get("partIndex") as string;
    const file = formData.get("part") as File | null;

    if (!documentId || partIndexStr === null || !file) {
      return NextResponse.json(
        { error: "Missing required fields: documentId, partIndex, part" },
        { status: 400 }
      );
    }

    const partIndex = parseInt(partIndexStr, 10);
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await db.insert(uploadParts).values({
      documentId,
      partIndex,
      bytes: buffer,
    });

    return NextResponse.json({ success: true, documentId, partIndex });
  } catch (error: any) {
    console.error("Upload part failed:", error);
    return NextResponse.json(
      { error: "Failed to upload part", details: error?.message },
      { status: 500 }
    );
  }
}
