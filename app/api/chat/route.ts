/**
 * app/api/chat/route.ts
 *
 * Streaming contract chat endpoint (Server-Sent Events) with:
 *  - Small doc full-context mode (<= 9,000 tokens)
 *  - Larger doc retrieval mode with legal synonym query expansion
 *  - Deep scan mode for existence/absence questions across 150+ page contracts
 *  - Hard invariant rule: guardApproved intercepts absence claims on partial reads
 *  - Stop / abort handling, rate-limit propagation, and DB persistence
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
import { guardApproved, CoverageObject } from "@/lib/coverage";
import {
  isExistenceOrAbsenceQuestion,
  estimateScan,
  runDeepScan,
} from "@/lib/chat/deepScan";

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
    mode = "auto", // "auto" | "scan" | "estimate" | "quick"
  }: {
    documentId?: string;
    question?: string;
    conversationId?: string;
    mode?: "auto" | "scan" | "estimate" | "quick";
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

  // 2. Fetch pages
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

  const mappedChunks = docChunks.map((c) => ({
    ...c,
    sectionLabel: c.sectionLabel || "General Provisions",
  }));

  const totalPages =
    doc.pageCount && doc.pageCount > 0
      ? doc.pageCount
      : docPages.length > 0
      ? docPages[docPages.length - 1].pageNumber
      : Math.max(...mappedChunks.map((c) => c.pageEnd), 1);

  // If client simply requested an estimate for deep scan
  if (mode === "estimate") {
    const estimate = estimateScan(mappedChunks, totalPages);
    return NextResponse.json({ estimate });
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

  const assistantMessageId = crypto.randomUUID();
  const encoder = new TextEncoder();

  // Check if this is an explicit Deep Scan request
  if (mode === "scan") {
    const { topic } = isExistenceOrAbsenceQuestion(question);

    const stream = new ReadableStream({
      async start(controller) {
        function send(event: string, data: any) {
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            );
          } catch {}
        }

        send("meta", { messageId: assistantMessageId, conversationId: conv.id });
        send("status", { text: `Starting full document scan for "${topic}"…` });

        try {
          const scanResult = await runDeepScan({
            topic,
            documentName: doc.name,
            canonicalText: doc.canonicalText!,
            docPages,
            chunks: mappedChunks,
            signal: req.signal,
            onProgress: (p) => {
              send("scan_progress", p);
              send("status", { text: p.statusText });
            },
            onRateLimited: (retryInSec) => {
              send("status", {
                text: `AI provider busy during scan, retrying in ${retryInSec}s...`,
              });
            },
          });

          // Post-process with absence guard
          const guarded = guardApproved(scanResult.answer, scanResult.coverage);

          // Stream final answer token
          send("token", { text: guarded.text });
          send("quotes", { items: scanResult.quotes });
          send("coverage", scanResult.coverage);

          // Save assistant message
          await db.insert(messages).values({
            id: assistantMessageId,
            conversationId: conv.id,
            role: "assistant",
            content: guarded.text,
            status: scanResult.status,
            quotes: scanResult.quotes,
            coverage: scanResult.coverage,
          });

          send("done", {});
          controller.close();
        } catch (err: any) {
          send("error", { message: err?.message || "Deep scan failed", retryable: true });
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

  // 6. Normal Chat Path (Hybrid: Full-context for small docs, Retrieval for large docs)
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

  // Assemble prompt with hybrid strategy (full-context for small docs, BM25 + legal synonyms for larger)
  const context = assembleChatPrompt({
    documentId,
    documentName: doc.name,
    question: question.trim(),
    chunks: mappedChunks,
    canonicalText: doc.canonicalText!,
    totalPages,
    history,
  });

  const stripper = new QuotesStreamStripper();
  let hasSavedMessage = false;

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: any) {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {}
      }

      send("meta", { messageId: assistantMessageId, conversationId: conv.id });

      const statusMsg =
        context.coverage.mode === "full"
          ? "Analyzing full document text (100% in-context)…"
          : "Retrieving relevant clauses with legal query expansion…";
      send("status", { text: statusMsg });
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

        const { visibleText, quotesRaw } = stripper.flush();

        if (req.signal.aborted) {
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

        // HARD INVARIANT RULE: Intercept absence claims on incomplete coverage
        const guarded = guardApproved(visibleText, context.coverage);

        if (guarded.wasGuarded) {
          // If the answer was guarded with mandatory disclosure, send the disclosure update
          send("guarded_disclosure", { disclosure: guarded.disclosure });
        }

        // Save completed assistant message with verified quotes and post-processed content
        if (!hasSavedMessage) {
          hasSavedMessage = true;
          await db.insert(messages).values({
            id: assistantMessageId,
            conversationId: conv.id,
            role: "assistant",
            content: guarded.text,
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
