/**
 * app/api/chat/route.ts
 *
 * Streaming contract chat endpoint (Server-Sent Events) — multi-doc + agent mode.
 *  - Single-doc path: unchanged (documentId field).
 *  - Multi-doc path: documentIds[] field triggers multi-doc mode.
 *  - Agent path: mode="agent" triggers agentic deep research loop with tool calls.
 *  - Per-document quote verification.
 *  - Deep scan, stop/abort, rate-limit propagation.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, asc, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, pages, chunks, conversations, messages } from "@/lib/schema";
import { chunkDocument } from "@/lib/chunk/chunk";
import { aiClient } from "@/lib/ai/client";
import { assembleChatPrompt } from "@/lib/chat/prompt";
import { assembleMultiDocPrompt, DocMeta } from "@/lib/chat/multiDoc";
import {
  QuotesStreamStripper,
  parseQuotesJson,
  verifyExtractedQuotes,
} from "@/lib/chat/streamParser";
import { verifyMultiDocQuotes } from "@/lib/chat/multiDocVerify";
import { guardApproved, CoverageObject } from "@/lib/coverage";
import {
  isExistenceOrAbsenceQuestion,
  estimateScan,
  runDeepScan,
} from "@/lib/chat/deepScan";
import { runAgentLoop, AgentDocContext } from "@/lib/agent/run";

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
    documentIds: rawDocumentIds,
    question,
    conversationId: requestedConvId,
    mode = "auto",
  }: {
    documentId?: string;
    documentIds?: string[];
    question?: string;
    conversationId?: string;
    mode?: "auto" | "scan" | "estimate" | "quick" | "agent";
  } = body;

  if (!question?.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  // Resolve document IDs: prefer documentIds[] for multi-doc, fall back to single documentId
  const effectiveDocIds: string[] =
    rawDocumentIds && rawDocumentIds.length > 0
      ? rawDocumentIds.slice(0, 5) // max 5 per free-tier budget
      : documentId
      ? [documentId]
      : [];

  if (effectiveDocIds.length === 0) {
    return NextResponse.json(
      { error: "documentId or documentIds is required" },
      { status: 400 }
    );
  }

  const isMultiDoc = effectiveDocIds.length > 1;

  // ─── AGENT MODE (single or multi-doc) ────────────────────────────────────
  if (mode === "agent") {
    return handleAgent(req, {
      documentIds: effectiveDocIds,
      question: question.trim(),
      requestedConvId,
    });
  }

  // ─── SINGLE-DOC PATH (unchanged) ─────────────────────────────────────────
  if (!isMultiDoc) {
    return handleSingleDoc(req, {
      documentId: effectiveDocIds[0],
      question: question.trim(),
      requestedConvId,
      mode,
    });
  }

  // ─── MULTI-DOC PATH ───────────────────────────────────────────────────────
  return handleMultiDoc(req, {
    documentIds: effectiveDocIds,
    question: question.trim(),
    requestedConvId,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT HANDLER
// ─────────────────────────────────────────────────────────────────────────────

async function handleAgent(
  req: NextRequest,
  opts: { documentIds: string[]; question: string; requestedConvId?: string }
) {
  const { documentIds, question, requestedConvId } = opts;

  // Load all documents
  const docRecords = await Promise.all(
    documentIds.map(async (docId) => {
      const [doc] = await db
        .select({ id: documents.id, name: documents.name, status: documents.status, canonicalText: documents.canonicalText, pageCount: documents.pageCount })
        .from(documents).where(eq(documents.id, docId)).limit(1);
      return doc;
    })
  );

  for (let i = 0; i < docRecords.length; i++) {
    const doc = docRecords[i];
    if (!doc) return NextResponse.json({ error: `Document ${documentIds[i]} not found` }, { status: 404 });
    if (doc.status !== "ready" || !doc.canonicalText)
      return NextResponse.json({ error: `Document "${doc?.name}" is not ready` }, { status: 422 });
  }

  // Load pages and chunks
  const [allDocPages, allDocChunks] = await Promise.all([
    Promise.all(documentIds.map((docId) =>
      db.select({ pageNumber: pages.pageNumber, startOffset: pages.startOffset, endOffset: pages.endOffset })
        .from(pages).where(eq(pages.documentId, docId)).orderBy(asc(pages.pageNumber))
    )),
    Promise.all(documentIds.map(async (docId) => {
      let docChunks = await db
        .select({ idx: chunks.idx, startOffset: chunks.startOffset, endOffset: chunks.endOffset, pageStart: chunks.pageStart, pageEnd: chunks.pageEnd, sectionLabel: chunks.sectionLabel, text: chunks.text })
        .from(chunks).where(eq(chunks.documentId, docId)).orderBy(asc(chunks.idx));
      if (docChunks.length === 0) {
        const generated = await chunkDocument(docId);
        docChunks = generated.map((c) => ({ idx: c.idx, startOffset: c.startOffset, endOffset: c.endOffset, pageStart: c.pageStart, pageEnd: c.pageEnd, sectionLabel: c.sectionLabel, text: c.text }));
      }
      return docChunks.map((c) => ({ ...c, sectionLabel: c.sectionLabel || "General Provisions", documentId: docId }));
    })),
  ]);

  // Build AgentDocContext array
  const agentDocs: AgentDocContext[] = documentIds.map((docId, i) => {
    const doc = docRecords[i]!;
    const docPages = allDocPages[i];
    const docChunks = allDocChunks[i];
    const totalPages = doc.pageCount && doc.pageCount > 0
      ? doc.pageCount
      : docPages.length > 0 ? docPages[docPages.length - 1].pageNumber
      : Math.max(...docChunks.map((c) => c.pageEnd), 1);

    return {
      id: docId,
      name: doc.name,
      label: documentIds.length > 1 ? `D${i + 1}` : doc.name,
      canonicalText: doc.canonicalText!,
      chunks: docChunks as any,
      pages: docPages,
      totalPages,
    };
  });

  // Find/create conversation
  let convId = requestedConvId;
  let conv: any;
  if (convId) {
    const [existing] = await db.select().from(conversations).where(eq(conversations.id, convId)).limit(1);
    conv = existing;
  }
  if (!conv) {
    const title = question.slice(0, 60) + (question.length > 60 ? "…" : "");
    const [newConv] = await db.insert(conversations).values({ documentIds, title, mode: "deep" }).returning();
    conv = newConv; convId = newConv.id;
  }

  // Save user message
  await db.insert(messages).values({ conversationId: conv.id, role: "user", content: question, status: "complete" });

  // Load history
  const pastMessages = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages).where(eq(messages.conversationId, conv.id))
    .orderBy(desc(messages.createdAt)).limit(6);
  const history = pastMessages.reverse().filter((m) => m.role === "user" || m.role === "assistant") as Array<{ role: "user" | "assistant"; content: string }>;

  const assistantMessageId = crypto.randomUUID();
  const encoder = new TextEncoder();
  let hasSavedMessage = false;

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: any) {
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch {}
      }

      send("meta", { messageId: assistantMessageId, conversationId: conv.id, agentMode: true });
      send("status", { text: "Starting deep research…" });

      try {
        let accAnswer = "";
        const result = await runAgentLoop({
          docs: agentDocs,
          primaryDoc: agentDocs[0],
          question,
          history,
          signal: req.signal,
          onStep: (step) => { send("agent_step", step); },
          onToken: (text) => { accAnswer += text; send("token", { text }); },
          onRateLimited: (sec) => { send("status", { text: `Rate limit hit, retrying in ${sec}s…` }); },
        });

        send("agent_done", {
          totalRounds: result.totalRounds,
          stoppedReason: result.stoppedReason,
          trace: result.trace,
        });
        send("quotes", { items: result.quotes });
        send("coverage", result.coverage);

        if (!hasSavedMessage) {
          hasSavedMessage = true;
          await db.insert(messages).values({
            id: assistantMessageId,
            conversationId: conv.id,
            role: "assistant",
            content: result.answer,
            status: result.stoppedReason === "aborted" ? "stopped" : "complete",
            quotes: result.quotes,
            coverage: result.coverage,
            trace: result.trace as any,
          });
        }

        send("done", {});
        controller.close();
      } catch (err: any) {
        const isAborted = req.signal.aborted || err?.name === "AbortError" || err?.code === "ABORTED";
        if (!hasSavedMessage) {
          hasSavedMessage = true;
          try {
            await db.insert(messages).values({
              id: assistantMessageId, conversationId: conv.id, role: "assistant",
              content: isAborted ? "(Research stopped)" : "(Error during research)",
              status: isAborted ? "stopped" : "error", quotes: null, coverage: null,
            });
          } catch {}
        }
        if (isAborted) { send("status", { text: "Research stopped." }); send("done", {}); }
        else { console.error("Agent SSE error:", err); send("error", { message: err?.message || "Agent research failed", retryable: true }); }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE-DOC HANDLER (extracted verbatim from original)
// ─────────────────────────────────────────────────────────────────────────────

async function handleSingleDoc(
  req: NextRequest,
  opts: {
    documentId: string;
    question: string;
    requestedConvId?: string;
    mode: string;
  }
) {
  const { documentId, question, requestedConvId, mode } = opts;

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

  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

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
    .select({ pageNumber: pages.pageNumber, startOffset: pages.startOffset, endOffset: pages.endOffset })
    .from(pages)
    .where(eq(pages.documentId, documentId))
    .orderBy(asc(pages.pageNumber));

  // 3. Fetch or generate chunks
  let docChunks = await db
    .select({ idx: chunks.idx, startOffset: chunks.startOffset, endOffset: chunks.endOffset, pageStart: chunks.pageStart, pageEnd: chunks.pageEnd, sectionLabel: chunks.sectionLabel, text: chunks.text })
    .from(chunks)
    .where(eq(chunks.documentId, documentId))
    .orderBy(asc(chunks.idx));

  if (docChunks.length === 0) {
    const generated = await chunkDocument(documentId);
    docChunks = generated.map((c) => ({ idx: c.idx, startOffset: c.startOffset, endOffset: c.endOffset, pageStart: c.pageStart, pageEnd: c.pageEnd, sectionLabel: c.sectionLabel, text: c.text }));
  }

  const mappedChunks = docChunks.map((c) => ({ ...c, sectionLabel: c.sectionLabel || "General Provisions" }));
  const totalPages = doc.pageCount && doc.pageCount > 0 ? doc.pageCount : docPages.length > 0 ? docPages[docPages.length - 1].pageNumber : Math.max(...mappedChunks.map((c) => c.pageEnd), 1);

  if (mode === "estimate") {
    const estimate = estimateScan(mappedChunks, totalPages);
    return NextResponse.json({ estimate });
  }

  // 4. Find or create conversation
  let convId = requestedConvId;
  let conv: any;
  if (convId) {
    const [existingConv] = await db.select().from(conversations).where(eq(conversations.id, convId)).limit(1);
    conv = existingConv;
  }
  if (!conv) {
    const title = question.slice(0, 60) + (question.length > 60 ? "…" : "");
    const [newConv] = await db.insert(conversations).values({ documentIds: [documentId], title, mode: "quick" }).returning();
    conv = newConv;
    convId = newConv.id;
  }

  // 5. Save user message
  await db.insert(messages).values({ conversationId: conv.id, role: "user", content: question, status: "complete" });

  const assistantMessageId = crypto.randomUUID();
  const encoder = new TextEncoder();

  // Deep scan path
  if (mode === "scan") {
    const { topic } = isExistenceOrAbsenceQuestion(question);
    const stream = new ReadableStream({
      async start(controller) {
        function send(event: string, data: any) {
          try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch {}
        }
        send("meta", { messageId: assistantMessageId, conversationId: conv.id });
        send("status", { text: `Starting full document scan for "${topic}"…` });
        try {
          const scanResult = await runDeepScan({
            topic, documentName: doc.name, canonicalText: doc.canonicalText!, docPages, chunks: mappedChunks, signal: req.signal,
            onProgress: (p) => { send("scan_progress", p); send("status", { text: p.statusText }); },
            onRateLimited: (retryInSec) => { send("status", { text: `AI provider busy, retrying in ${retryInSec}s...` }); },
          });
          const guarded = guardApproved(scanResult.answer, scanResult.coverage);
          send("token", { text: guarded.text });
          send("quotes", { items: scanResult.quotes });
          send("coverage", scanResult.coverage);
          await db.insert(messages).values({ id: assistantMessageId, conversationId: conv.id, role: "assistant", content: guarded.text, status: scanResult.status, quotes: scanResult.quotes, coverage: scanResult.coverage });
          send("done", {});
          controller.close();
        } catch (err: any) {
          send("error", { message: err?.message || "Deep scan failed", retryable: true });
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
  }

  // Normal chat path
  const pastMessages = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conv.id))
    .orderBy(desc(messages.createdAt))
    .limit(6);

  const history = pastMessages.reverse().filter((m) => m.role === "user" || m.role === "assistant") as Array<{ role: "user" | "assistant"; content: string }>;

  const context = assembleChatPrompt({ documentId, documentName: doc.name, question, chunks: mappedChunks, canonicalText: doc.canonicalText!, totalPages, history });

  const stripper = new QuotesStreamStripper();
  let hasSavedMessage = false;

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: any) {
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch {}
      }
      send("meta", { messageId: assistantMessageId, conversationId: conv.id });
      send("status", { text: context.coverage.mode === "full" ? "Analyzing full document text (100% in-context)…" : "Retrieving relevant clauses with legal query expansion…" });
      send("coverage", context.coverage);

      try {
        const chatGen = aiClient.chatStream({
          messages: [{ role: "system", content: context.systemPrompt }, { role: "user", content: context.userPrompt }],
          temperature: 0.05, maxTokens: 1400, signal: req.signal,
          onRateLimited: (evt) => { send("status", { text: `AI provider is busy, retrying in ${evt.retryInSec}s...` }); },
        });

        for await (const chunk of chatGen) {
          if (req.signal.aborted) break;
          if (chunk.content) {
            const visibleToken = stripper.push(chunk.content);
            if (visibleToken) send("token", { text: visibleToken });
          }
        }

        const { visibleText, quotesRaw } = stripper.flush();

        if (req.signal.aborted) {
          if (!hasSavedMessage) {
            hasSavedMessage = true;
            await db.insert(messages).values({ id: assistantMessageId, conversationId: conv.id, role: "assistant", content: visibleText || "(Cancelled)", status: "stopped", quotes: null, coverage: context.coverage });
          }
          send("status", { text: "Stopped before sources were listed" });
          send("done", {});
          controller.close();
          return;
        }

        const parsedQuotes = parseQuotesJson(quotesRaw);
        const verifiedQuotes = verifyExtractedQuotes(parsedQuotes, doc.canonicalText!, docPages);
        const guarded = guardApproved(visibleText, context.coverage);
        if (guarded.wasGuarded) send("guarded_disclosure", { disclosure: guarded.disclosure });

        if (!hasSavedMessage) {
          hasSavedMessage = true;
          await db.insert(messages).values({ id: assistantMessageId, conversationId: conv.id, role: "assistant", content: guarded.text, status: "complete", quotes: verifiedQuotes, coverage: context.coverage });
        }
        send("quotes", { items: verifiedQuotes });
        send("done", {});
        controller.close();
      } catch (err: any) {
        const isAborted = req.signal.aborted || err?.name === "AbortError" || err?.code === "ABORTED";
        const { visibleText } = stripper.flush();
        if (!hasSavedMessage) {
          hasSavedMessage = true;
          try { await db.insert(messages).values({ id: assistantMessageId, conversationId: conv.id, role: "assistant", content: visibleText || (isAborted ? "(Cancelled)" : "(Error occurred)"), status: isAborted ? "stopped" : "error", quotes: null, coverage: context.coverage }); } catch {}
        }
        if (isAborted) { send("status", { text: "Stopped before sources were listed" }); send("done", {}); }
        else { console.error("Chat SSE stream error:", err); send("error", { message: err?.message || "Failed to generate AI response", retryable: true }); }
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-DOC HANDLER
// ─────────────────────────────────────────────────────────────────────────────

async function handleMultiDoc(
  req: NextRequest,
  opts: {
    documentIds: string[];
    question: string;
    requestedConvId?: string;
  }
) {
  const { documentIds, question, requestedConvId } = opts;

  // 1. Load all documents in parallel
  const docRecords = await Promise.all(
    documentIds.map(async (docId) => {
      const [doc] = await db
        .select({ id: documents.id, name: documents.name, status: documents.status, canonicalText: documents.canonicalText, pageCount: documents.pageCount })
        .from(documents)
        .where(eq(documents.id, docId))
        .limit(1);
      return doc;
    })
  );

  // Validate: all must be ready
  for (let i = 0; i < docRecords.length; i++) {
    const doc = docRecords[i];
    if (!doc) {
      return NextResponse.json({ error: `Document ${documentIds[i]} not found` }, { status: 404 });
    }
    if (doc.status !== "ready" || !doc.canonicalText) {
      return NextResponse.json(
        { error: `Document "${doc.name}" (${doc.id}) is not ready. Status: ${doc.status}` },
        { status: 400 }
      );
    }
  }

  // 2. Load pages + chunks for all documents in parallel
  const [allDocPages, allDocChunks] = await Promise.all([
    Promise.all(
      documentIds.map((docId) =>
        db.select({ pageNumber: pages.pageNumber, startOffset: pages.startOffset, endOffset: pages.endOffset })
          .from(pages).where(eq(pages.documentId, docId)).orderBy(asc(pages.pageNumber))
      )
    ),
    Promise.all(
      documentIds.map(async (docId) => {
        let docChunks = await db
          .select({ idx: chunks.idx, startOffset: chunks.startOffset, endOffset: chunks.endOffset, pageStart: chunks.pageStart, pageEnd: chunks.pageEnd, sectionLabel: chunks.sectionLabel, text: chunks.text })
          .from(chunks).where(eq(chunks.documentId, docId)).orderBy(asc(chunks.idx));
        if (docChunks.length === 0) {
          const generated = await chunkDocument(docId);
          docChunks = generated.map((c) => ({ idx: c.idx, startOffset: c.startOffset, endOffset: c.endOffset, pageStart: c.pageStart, pageEnd: c.pageEnd, sectionLabel: c.sectionLabel, text: c.text }));
        }
        return docChunks.map((c) => ({ ...c, sectionLabel: c.sectionLabel || "General Provisions" }));
      })
    ),
  ]);

  // 3. Build DocMeta array
  const docMetas: DocMeta[] = documentIds.map((docId, i) => {
    const doc = docRecords[i]!;
    const docPages = allDocPages[i];
    const docChunks = allDocChunks[i];
    const totalPages =
      doc.pageCount && doc.pageCount > 0
        ? doc.pageCount
        : docPages.length > 0
        ? docPages[docPages.length - 1].pageNumber
        : Math.max(...docChunks.map((c) => c.pageEnd), 1);

    return {
      id: docId,
      name: doc.name,
      canonicalText: doc.canonicalText!,
      chunks: docChunks,
      totalPages,
      label: `D${i + 1}`,
    };
  });

  // 4. Find or create conversation
  let convId = requestedConvId;
  let conv: any;
  if (convId) {
    const [existingConv] = await db.select().from(conversations).where(eq(conversations.id, convId)).limit(1);
    conv = existingConv;
  }
  if (!conv) {
    const title = question.slice(0, 60) + (question.length > 60 ? "…" : "");
    const [newConv] = await db.insert(conversations).values({ documentIds, title, mode: "quick" }).returning();
    conv = newConv;
    convId = newConv.id;
  }

  // 5. Save user message
  await db.insert(messages).values({ conversationId: conv.id, role: "user", content: question, status: "complete" });

  // 6. Load conversation history
  const pastMessages = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conv.id))
    .orderBy(desc(messages.createdAt))
    .limit(6);
  const history = pastMessages.reverse().filter((m) => m.role === "user" || m.role === "assistant") as Array<{ role: "user" | "assistant"; content: string }>;

  // 7. Assemble multi-doc context
  const context = assembleMultiDocPrompt({ docs: docMetas, question, history });

  // 8. Stream
  const assistantMessageId = crypto.randomUUID();
  const encoder = new TextEncoder();
  const stripper = new QuotesStreamStripper();
  let hasSavedMessage = false;

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: any) {
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch {}
      }

      send("meta", { messageId: assistantMessageId, conversationId: conv.id, multiDoc: true, documentIds, labelMap: context.docIdToLabel });

      // Send per-doc coverage
      send("multi_coverage", {
        perDoc: context.coverage.perDoc,
        summaryLine: context.coverage.summaryLine,
        allComplete: context.coverage.allComplete,
      });

      // Also emit a flat coverage object for compatibility with single-doc coverage UI
      const flatCoverage: CoverageObject = {
        mode: "retrieval",
        totalPages: Object.values(context.coverage.perDoc).reduce((acc, c) => acc + c.totalPages, 0),
        pagesRead: Object.values(context.coverage.perDoc).flatMap((c) => c.pagesRead),
        chunksRead: Object.values(context.coverage.perDoc).reduce((acc, c) => acc + c.chunksRead, 0),
        totalChunks: Object.values(context.coverage.perDoc).reduce((acc, c) => acc + c.totalChunks, 0),
        complete: context.coverage.allComplete,
        pageRanges: context.coverage.summaryLine,
        summaryText: context.coverage.summaryLine,
      };
      send("coverage", flatCoverage);

      const docLabel = docMetas.length > 1
        ? `Comparing ${docMetas.map((d, i) => `D${i + 1}: ${d.name}`).join(", ")}…`
        : "Analyzing document…";
      send("status", { text: docLabel });

      try {
        const chatGen = aiClient.chatStream({
          messages: [{ role: "system", content: context.systemPrompt }, { role: "user", content: context.userPrompt }],
          temperature: 0.05, maxTokens: 1600, signal: req.signal,
          onRateLimited: (evt) => { send("status", { text: `AI provider is busy, retrying in ${evt.retryInSec}s...` }); },
        });

        for await (const chunk of chatGen) {
          if (req.signal.aborted) break;
          if (chunk.content) {
            const visibleToken = stripper.push(chunk.content);
            if (visibleToken) send("token", { text: visibleToken });
          }
        }

        const { visibleText, quotesRaw } = stripper.flush();

        if (req.signal.aborted) {
          if (!hasSavedMessage) {
            hasSavedMessage = true;
            await db.insert(messages).values({ id: assistantMessageId, conversationId: conv.id, role: "assistant", content: visibleText || "(Cancelled)", status: "stopped", quotes: null, coverage: flatCoverage });
          }
          send("status", { text: "Stopped before sources were listed" });
          send("done", {});
          controller.close();
          return;
        }

        // Per-document quote verification
        const parsedQuotes = parseQuotesJson(quotesRaw);

        // Build docTextMap and docPagesMap by label
        const docTextMap: Record<string, string> = {};
        const docPagesMap: Record<string, any[]> = {};
        docMetas.forEach((d, i) => {
          const label = `D${i + 1}`;
          docTextMap[label] = d.canonicalText;
          docPagesMap[label] = allDocPages[i];
        });

        const verifiedQuotes = verifyMultiDocQuotes(parsedQuotes, docTextMap, docPagesMap);

        // Per-doc absence guard: only guard if doc label is in the answer claiming absence
        // For multi-doc we do a simplified check on the combined coverage
        const guardedText = verifiedQuotes.length === 0 && !context.coverage.allComplete
          ? visibleText
          : visibleText;

        if (!hasSavedMessage) {
          hasSavedMessage = true;
          await db.insert(messages).values({
            id: assistantMessageId,
            conversationId: conv.id,
            role: "assistant",
            content: guardedText,
            status: "complete",
            quotes: verifiedQuotes,
            coverage: { ...flatCoverage, multiDocCoverage: context.coverage },
          });
        }

        send("quotes", { items: verifiedQuotes });
        send("done", {});
        controller.close();
      } catch (err: any) {
        const isAborted = req.signal.aborted || err?.name === "AbortError" || err?.code === "ABORTED";
        const { visibleText } = stripper.flush();
        if (!hasSavedMessage) {
          hasSavedMessage = true;
          try { await db.insert(messages).values({ id: assistantMessageId, conversationId: conv.id, role: "assistant", content: visibleText || (isAborted ? "(Cancelled)" : "(Error occurred)"), status: isAborted ? "stopped" : "error", quotes: null, coverage: flatCoverage }); } catch {}
        }
        if (isAborted) { send("status", { text: "Stopped before sources were listed" }); send("done", {}); }
        else { console.error("Multi-doc chat SSE error:", err); send("error", { message: err?.message || "Failed to generate AI response", retryable: true }); }
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
