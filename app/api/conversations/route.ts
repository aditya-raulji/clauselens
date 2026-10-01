import { NextRequest, NextResponse } from "next/server";
import { eq, asc, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, messages, documents } from "@/lib/schema";
import { aiClient } from "@/lib/ai/client";
import { verifyAllQuotes, calculateCoverage } from "@/lib/verification/verifier";
import { chunks } from "@/lib/schema";

export const maxDuration = 60;

/**
 * GET /api/conversations — list all conversations
 */
export async function GET(req: NextRequest) {
  try {
    const documentId = req.nextUrl.searchParams.get("documentId");

    const convList = await db
      .select()
      .from(conversations)
      .orderBy(desc(conversations.createdAt));

    const filtered = documentId
      ? convList.filter((c) => (c.documentIds as string[])?.includes(documentId))
      : convList;

    return NextResponse.json({ conversations: filtered });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to list conversations", details: error?.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/conversations — create conversation and run first AI response
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      documentIds,
      question,
      mode = "quick",
      title,
    }: {
      documentIds: string[];
      question: string;
      mode?: "quick" | "deep";
      title?: string;
    } = body;

    if (!documentIds?.length || !question?.trim()) {
      return NextResponse.json(
        { error: "documentIds and question are required" },
        { status: 400 }
      );
    }

    // 1. Create conversation
    const [conv] = await db
      .insert(conversations)
      .values({
        documentIds,
        title: title || question.slice(0, 80),
        mode,
      })
      .returning();

    // 2. Save user message
    await db.insert(messages).values({
      conversationId: conv.id,
      role: "user",
      content: question,
      status: "complete",
    });

    // 3. Retrieve relevant chunks from each document
    let allChunks: Array<{
      idx: number;
      text: string;
      sectionLabel: string | null;
      documentId: string;
    }> = [];

    for (const docId of documentIds) {
      const docChunks = await db
        .select({
          idx: chunks.idx,
          text: chunks.text,
          sectionLabel: chunks.sectionLabel,
          documentId: chunks.documentId,
        })
        .from(chunks)
        .where(eq(chunks.documentId, docId))
        .orderBy(asc(chunks.idx));

      allChunks = allChunks.concat(docChunks);
    }

    const totalChunks = allChunks.length;
    // Token budget: aim to keep under ~5000 chars of context to leave room for response
    const MAX_CONTEXT_CHARS = 5000;
    let contextChars = 0;
    const selectedChunks: typeof allChunks = [];

    // Simple relevance: pick chunks that contain words from the question
    const questionWords = question
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4);

    // Sort by simple keyword overlap score
    const scored = allChunks.map((c) => {
      const textLower = c.text.toLowerCase();
      const score = questionWords.reduce(
        (acc, w) => acc + (textLower.includes(w) ? 1 : 0),
        0
      );
      return { chunk: c, score };
    });

    scored.sort((a, b) => b.score - a.score);

    for (const { chunk } of scored) {
      if (contextChars + chunk.text.length > MAX_CONTEXT_CHARS) break;
      selectedChunks.push(chunk);
      contextChars += chunk.text.length;
    }

    const analyzedChunkIndices = selectedChunks.map((c) => c.idx);
    const coverage = calculateCoverage(analyzedChunkIndices, totalChunks, allChunks.map(c => ({
      idx: c.idx,
      sectionLabel: c.sectionLabel ?? "General",
    })));

    // 4. Fetch canonical text for quote verification
    const docTextMap: Record<string, string> = {};
    const docPagesMap: Record<string, any[]> = {};

    for (const docId of documentIds) {
      const [doc] = await db
        .select({ canonicalText: documents.canonicalText })
        .from(documents)
        .where(eq(documents.id, docId))
        .limit(1);

      docTextMap[docId] = doc?.canonicalText || "";
    }

    // 5. Build prompt — keep compact for free-tier TPM limits
    const coverageNote = coverage.isFullCoverage
      ? ""
      : `\n[COVERAGE NOTE: ${coverage.summaryText}]`;

    const contextBlock = selectedChunks
      .map(
        (c, i) =>
          `[EXCERPT ${i + 1} — ${c.sectionLabel || "General"}]\n${c.text}`
      )
      .join("\n\n---\n\n");

    const systemPrompt = `You are ClauseLens, a precise legal contract analyst. Answer ONLY using the contract excerpts provided. Return relevant direct quotes from the text inside <quote> tags. Never fabricate or paraphrase quotes. If you cannot find the answer in the provided excerpts, say so clearly.${coverageNote}`;

    const userPrompt = `CONTRACT EXCERPTS:\n${contextBlock}\n\n---\nQUESTION: ${question}\n\nAnswer based solely on the excerpts above. Include direct verbatim quotes inside <quote>...</quote> tags.`;

    // 6. Call AI
    const aiResult = await aiClient.chat({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      maxTokens: 1200,
      temperature: 0.05,
    });

    // 7. Extract quotes from AI response
    const quotePattern = /<quote>([\s\S]*?)<\/quote>/gi;
    const rawQuotes: string[] = [];
    let match;
    const responseContent = aiResult.content;
    while ((match = quotePattern.exec(responseContent)) !== null) {
      rawQuotes.push(match[1].trim());
    }

    // 8. Verify quotes against canonical text (Rule 1 — code locates, never trusts AI)
    const primaryDocId = documentIds[0];
    const canonicalText = docTextMap[primaryDocId] || "";
    const verifiedQuotes = verifyAllQuotes(rawQuotes, canonicalText, []);

    // Clean response: remove <quote> tags for display, keep content
    const cleanContent = responseContent.replace(/<\/?quote>/gi, "**");

    // 9. Save assistant message with quotes and coverage metadata
    const [savedMessage] = await db
      .insert(messages)
      .values({
        conversationId: conv.id,
        role: "assistant",
        content: cleanContent,
        status: "complete",
        quotes: verifiedQuotes,
        coverage: coverage,
        trace: [
          {
            type: "context_selection",
            chunksSelected: selectedChunks.length,
            totalChunks,
          },
        ],
      })
      .returning();

    return NextResponse.json({
      conversation: conv,
      message: savedMessage,
      coverage,
      quotes: verifiedQuotes,
    });
  } catch (error: any) {
    console.error("Conversation API error:", error);
    return NextResponse.json(
      { error: "Failed to process question", details: error?.message },
      { status: 500 }
    );
  }
}
