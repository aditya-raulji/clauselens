/**
 * app/api/chat/route.ts
 *
 * Streaming contract chat endpoint (Server-Sent Events).
 *
 * Events:
 *  - meta { messageId, conversationId }
 *  - status { text }
 *  - token { text }
 *  - quotes { items }
 *  - coverage { ... }
 *  - done {}
 *  - error { message, retryable }
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, asc, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, pages, chunks, conversations, messages } from "@/lib/schema";
import { chunkDocument } from "@/lib/chunk/chunk";
import { aiClient } from "@/lib/ai/client";
import { assembleChatPrompt } from "@/lib/chat/prompt";
import {
  QuotesStreamStripper,
  parseQuotesJson,
  verifyExtractedQuotes,
} from "@/lib/chat/streamParser";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    documentId,
    question,
    conversationId: requestedConvId,
  }: {
    documentId?: string;
    question?: string;
    conversationId?: string;
  } = body;

  if (!documentId || !question?.trim()) {
    return NextResponse.json(
      { error: "documentId and question are required" },
      { status: 400 }
    );
  }

  // 1. Fetch document record
  const [doc] = await db
    .select({
      id: documents.id,
      name: documents.name,
      status: documents.status,
      canonicalText: documents.canonicalText,
      pageCount: documents.pageCount,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (doc.status !== "ready" || !doc.canonicalText) {
    return NextResponse.json(
      {
        error:
          doc.status === "extracting"
            ? "Document text is still being extracted. Please wait a moment."
            : "Document extraction has not completed.",
      },
      { status: 400 }
    );
  }

  // 2. Fetch pages for offset-to-page resolution
  const docPages = await db
    .select({
      pageNumber: pages.pageNumber,
      startOffset: pages.startOffset,
      endOffset: pages.endOffset,
    })
    .from(pages)
    .where(eq(pages.documentId, documentId))
    .orderBy(asc(pages.pageNumber));

  // 3. Fetch or generate chunks
  let docChunks = await db
    .select({
      idx: chunks.idx,
      startOffset: chunks.startOffset,
      endOffset: chunks.endOffset,
      pageStart: chunks.pageStart,
      pageEnd: chunks.pageEnd,
      sectionLabel: chunks.sectionLabel,
      text: chunks.text,
    })
    .from(chunks)
    .where(eq(chunks.documentId, documentId))
    .orderBy(asc(chunks.idx));

  if (docChunks.length === 0) {
    // Generate chunks if not yet created
    const generated = await chunkDocument(documentId);
    docChunks = generated.map((c) => ({
      idx: c.idx,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
      pageStart: c.pageStart,
      pageEnd: c.pageEnd,
      sectionLabel: c.sectionLabel,
      text: c.text,
    }));
  }

  // 4. Find or create conversation
  let convId = requestedConvId;
  let conv;

  if (convId) {
    const [existingConv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, convId))
      .limit(1);
    conv = existingConv;
  }

  if (!conv) {
    const title =
      question.trim().slice(0, 60) + (question.trim().length > 60 ? "…" : "");
    const [newConv] = await db
      .insert(conversations)
      .values({
        documentIds: [documentId],
        title,
        mode: "quick",
      })
      .returning();
    conv = newConv;
    convId = newConv.id;
  }

  // 5. Save user message
  await db.insert(messages).values({
    conversationId: conv.id,
    role: "user",
    content: question.trim(),
    status: "complete",
  });

  // 6. Fetch recent conversation history (last 4 messages before this new one)
  const pastMessages = await db
    .select({
      role: messages.role,
      content: messages.content,
    })
    .from(messages)
    .where(eq(messages.conversationId, conv.id))
    .orderBy(desc(messages.createdAt))
    .limit(6);

  const history = pastMessages
    .reverse()
    .filter((m) => m.role === "user" || m.role === "assistant") as Array<{
    role: "user" | "assistant";
    content: string;
  }>;

  // 7. Assemble token-budgeted prompt and BM25 excerpts
  const context = assembleChatPrompt({
    documentId,
    documentName: doc.name,
    question: question.trim(),
    chunks: docChunks.map((c) => ({
      ...c,
      sectionLabel: c.sectionLabel || "General Provisions",
    })),
    history,
  });

  const assistantMessageId = crypto.randomUUID();

  // 8. Setup Server-Sent Events stream
  const encoder = new TextEncoder();
  const stripper = new QuotesStreamStripper();
  let hasSavedMessage = false;

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: any) {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // Stream might be closed by client abort
        }
      }

      // Initial metadata & coverage
      send("meta", {
        messageId: assistantMessageId,
        conversationId: conv.id,
      });

      send("status", { text: "Searching relevant contract clauses…" });
      send("coverage", context.coverage);

      try {
        const chatGen = aiClient.chatStream({
          messages: [
            { role: "system", content: context.systemPrompt },
            { role: "user", content: context.userPrompt },
          ],
          temperature: 0.05,
          maxTokens: 1400,
          signal: req.signal,
          onRateLimited: (evt) => {
            send("status", {
              text: `AI provider is busy, retrying in ${evt.retryInSec}s...`,
            });
          },
        });

        for await (const chunk of chatGen) {
          if (req.signal.aborted) {
            break;
          }

          if (chunk.content) {
            const visibleToken = stripper.push(chunk.content);
            if (visibleToken) {
              send("token", { text: visibleToken });
            }
          }
        }

        // Finalize stream
        const { visibleText, quotesRaw } = stripper.flush();

        if (req.signal.aborted) {
          // Client pressed Stop (AbortController)
          if (!hasSavedMessage) {
            hasSavedMessage = true;
            await db.insert(messages).values({
              id: assistantMessageId,
              conversationId: conv.id,
              role: "assistant",
              content: visibleText || "(Cancelled)",
              status: "stopped",
              quotes: null,
              coverage: context.coverage,
            });
          }
          send("status", { text: "Stopped before sources were listed" });
          send("done", {});
          controller.close();
          return;
        }

        // Parse & verify quotes against canonical document text
        const parsedQuotes = parseQuotesJson(quotesRaw);
        const verifiedQuotes = verifyExtractedQuotes(
          parsedQuotes,
          doc.canonicalText!,
          docPages
        );

        // Save completed assistant message with verified quotes
        if (!hasSavedMessage) {
          hasSavedMessage = true;
          await db.insert(messages).values({
            id: assistantMessageId,
            conversationId: conv.id,
            role: "assistant",
            content: visibleText,
            status: "complete",
            quotes: verifiedQuotes,
            coverage: context.coverage,
          });
        }

        send("quotes", { items: verifiedQuotes });
        send("done", {});
        controller.close();
      } catch (err: any) {
        const isAborted =
          req.signal.aborted ||
          err?.name === "AbortError" ||
          err?.code === "ABORTED";

        const { visibleText } = stripper.flush();

        if (!hasSavedMessage) {
          hasSavedMessage = true;
          try {
            await db.insert(messages).values({
              id: assistantMessageId,
              conversationId: conv.id,
              role: "assistant",
              content: visibleText || (isAborted ? "(Cancelled)" : "(Error occurred)"),
              status: isAborted ? "stopped" : "error",
              quotes: null,
              coverage: context.coverage,
            });
          } catch {}
        }

        if (isAborted) {
          send("status", { text: "Stopped before sources were listed" });
          send("done", {});
        } else {
          console.error("Chat SSE stream error:", err);
          send("error", {
            message: err?.message || "Failed to generate AI response",
            retryable: true,
          });
        }

        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
