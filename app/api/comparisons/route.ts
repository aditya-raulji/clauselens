import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { comparisons, documents } from "@/lib/schema";
import { aiClient } from "@/lib/ai/client";

export const maxDuration = 60;

/**
 * POST /api/comparisons — run side-by-side clause comparison
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

    // Fetch both documents (metadata + canonical text)
    const [docA] = await db
      .select({
        id: documents.id,
        name: documents.name,
        canonicalText: documents.canonicalText,
      })
      .from(documents)
      .where(eq(documents.id, docAId))
      .limit(1);

    const [docB] = await db
      .select({
        id: documents.id,
        name: documents.name,
        canonicalText: documents.canonicalText,
      })
      .from(documents)
      .where(eq(documents.id, docBId))
      .limit(1);

    if (!docA || !docB) {
      return NextResponse.json(
        { error: "One or both documents not found" },
        { status: 404 }
      );
    }

    // Truncate to stay within TPM budget (~4000 chars per doc = ~1000 tokens)
    const MAX_CHARS = 3500;
    const textA = (docA.canonicalText || "").substring(0, MAX_CHARS);
    const textB = (docB.canonicalText || "").substring(0, MAX_CHARS);
    const truncatedNote =
      (docA.canonicalText?.length || 0) > MAX_CHARS ||
      (docB.canonicalText?.length || 0) > MAX_CHARS
        ? `\n[NOTE: Documents were truncated to ~${MAX_CHARS} characters each due to token budget limits. Analysis covers the opening sections only.]`
        : "";

    const systemPrompt = `You are a legal contract comparison assistant. Compare the two agreements clause by clause. Be concise. Return a JSON object with this exact structure:
{
  "summary": "short 2-3 sentence comparison summary",
  "similarities": ["bullet 1", "bullet 2"],
  "differences": ["bullet 1", "bullet 2"],
  "notable_clauses_a": ["clause or gap unique to A"],
  "notable_clauses_b": ["clause or gap unique to B"]
}`;

    const userPrompt = `DOCUMENT A — ${docA.name}:\n${textA}\n\n===\n\nDOCUMENT B — ${docB.name}:\n${textB}${truncatedNote}\n\nProvide the JSON comparison result.`;

    const result = await aiClient.chat({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      maxTokens: 1000,
      temperature: 0.05,
    });

    // Parse JSON result from AI response
    let comparisonResult: any = null;
    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        comparisonResult = JSON.parse(jsonMatch[0]);
      }
    } catch {
      comparisonResult = { summary: result.content, raw: true };
    }

    // Save comparison to DB
    const [saved] = await db
      .insert(comparisons)
      .values({
        docA: docAId,
        docB: docBId,
        result: comparisonResult,
      })
      .returning();

    return NextResponse.json({
      comparison: saved,
      result: comparisonResult,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Comparison failed", details: error?.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/comparisons — list saved comparisons
 */
export async function GET() {
  try {
    const list = await db
      .select()
      .from(comparisons)
      .orderBy(comparisons.createdAt);

    return NextResponse.json({ comparisons: list });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to list comparisons", details: error?.message },
      { status: 500 }
    );
  }
}
