import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { comparisons, documents } from "@/lib/schema";
import { runCompare } from "@/lib/compare/pipeline";
import { ComparisonResult } from "@/lib/compare/types";

export const maxDuration = 120;

/**
 * POST /api/comparisons — run full clause-level comparison pipeline
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { docAId, docBId }: { docAId: string; docBId: string } = body;

    if (!docAId || !docBId) {
      return NextResponse.json(
        { error: "Both docAId and docBId are required" },
        { status: 400 }
      );
    }

    if (docAId === docBId) {
      return NextResponse.json(
        { error: "Select two different documents to compare" },
        { status: 400 }
      );
    }

    // Fetch both documents
    const [docA] = await db
      .select({ id: documents.id, name: documents.name, canonicalText: documents.canonicalText, status: documents.status })
      .from(documents)
      .where(eq(documents.id, docAId))
      .limit(1);

    const [docB] = await db
      .select({ id: documents.id, name: documents.name, canonicalText: documents.canonicalText, status: documents.status })
      .from(documents)
      .where(eq(documents.id, docBId))
      .limit(1);

    if (!docA) return NextResponse.json({ error: `Document A not found` }, { status: 404 });
    if (!docB) return NextResponse.json({ error: `Document B not found` }, { status: 404 });
    if (docA.status !== "ready") return NextResponse.json({ error: `Document A is not ready (status: ${docA.status})` }, { status: 422 });
    if (docB.status !== "ready") return NextResponse.json({ error: `Document B is not ready (status: ${docB.status})` }, { status: 422 });

    if (!docA.canonicalText || !docB.canonicalText) {
      return NextResponse.json({ error: "One or both documents have no extracted text" }, { status: 422 });
    }

    // Run comparison pipeline (no SSE, just await; max 120s)
    const result: ComparisonResult = await runCompare({
      docAId: docA.id,
      docAName: docA.name,
      textA: docA.canonicalText,
      docBId: docB.id,
      docBName: docB.name,
      textB: docB.canonicalText,
    });

    // Persist result to DB
    const [saved] = await db
      .insert(comparisons)
      .values({ docA: docAId, docB: docBId, result })
      .returning();

    return NextResponse.json({ comparison: saved, result });
  } catch (error: any) {
    console.error("[comparisons POST]", error);
    return NextResponse.json(
      { error: "Comparison failed", details: error?.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/comparisons — list saved comparisons (with document names joined)
 */
export async function GET() {
  try {
    const rows = await db
      .select({
        id: comparisons.id,
        docA: comparisons.docA,
        docB: comparisons.docB,
        result: comparisons.result,
        createdAt: comparisons.createdAt,
      })
      .from(comparisons)
      .orderBy(comparisons.createdAt);

    return NextResponse.json({ comparisons: rows });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to list comparisons", details: error?.message },
      { status: 500 }
    );
  }
}
