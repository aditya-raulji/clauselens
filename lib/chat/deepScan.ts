/**
 * lib/chat/deepScan.ts
 *
 * Existence/Absence detector and Deep Scan sequential batching engine.
 *
 * Rules:
 *  - Detects existence/absence questions ("does it contain a non-compete?", "is there an indemnity clause?", "any force majeure?")
 *  - Calculates pre-scan estimate: total pages, total tokens, batches, estimated duration on free tier (8K TPM)
 *  - Sequentially inspects ALL chunks in batches of ~3,500 tokens with throttled AI client
 *  - Streams progress status ("Scanned pages 41-60 of 150") and supports user abort via AbortSignal
 *  - If stopped or failed, records explicit partial coverage (never silently skips or claims complete)
 */

import { DocumentChunkData } from "@/lib/chunk/chunk";
import { CoverageObject, formatPageRanges } from "@/lib/coverage";
import { aiClient } from "@/lib/ai/client";
import { estimateTokens } from "@/lib/tokens";
import { parseQuotesJson, verifyExtractedQuotes, VerifiedQuoteItem } from "@/lib/chat/streamParser";
import { PageRange } from "@/lib/quotes/pages";

export interface ScanEstimate {
  totalPages: number;
  totalChunks: number;
  totalTokens: number;
  batchCount: number;
  estimatedMinutes: number;
  summaryText: string;
}

export interface DeepScanBatch {
  index: number;
  chunks: DocumentChunkData[];
  pageStart: number;
  pageEnd: number;
  tokens: number;
}

export interface DeepScanProgress {
  currentBatch: number;
  totalBatches: number;
  pageStart: number;
  pageEnd: number;
  totalPages: number;
  pagesScannedSoFar: number[];
  statusText: string;
}

export interface DeepScanResult {
  answer: string;
  quotes: VerifiedQuoteItem[];
  coverage: CoverageObject;
  found: boolean;
  status: "complete" | "stopped" | "error";
  error?: string;
}

// Regex patterns to detect existence/absence questions
const EXISTENCE_PATTERNS = [
  /^(?:is there|are there)\s+(?:a|an|any)\b/i,
  /^does\s+(?:it|the document|this contract|this agreement)\s+(?:contain|have|include|mention|specify|state|provide for)\b/i,
  /^do\s+we\s+have\s+(?:a|an|any)\b/i,
  /^can\s+you\s+find\s+(?:any|a|an)\b/i,
  /^any\s+(?:clause|mention|provision|reference|requirement|restriction|covenant|non-compete|indemnity|force majeure)\b/i,
  /\bdoes\s+a\s+.*?\s+(?:exist|apply)\b/i,
  /\b(?:contains?|includes?|mentions?)\s+(?:any|a|an)\s+(?:non-compete|indemnity|arbitration|penalty|exclusivity|force majeure|warranty)\b/i,
];

/**
 * Classifies whether a user question is asking about the existence or absence
 * of a clause, right, or restriction.
 */
export function isExistenceOrAbsenceQuestion(question: string): {
  isExistence: boolean;
  topic: string;
} {
  if (!question || question.trim().length === 0) {
    return { isExistence: false, topic: "" };
  }

  const q = question.trim();
  const matched = EXISTENCE_PATTERNS.some((pattern) => pattern.test(q));

  if (!matched) {
    return { isExistence: false, topic: "" };
  }

  // Extract the topic (e.g. "non-compete", "indemnity clause", "force majeure")
  let topic = q
    .replace(/^(?:does\s+(?:the\s+contract|this\s+agreement|the\s+document|it)\s+(?:contain|have|include|mention|specify)|is\s+there\s+(?:a|an|any)|are\s+there\s+(?:any)|any|can\s+you\s+find\s+(?:any|a|an))\s+/i, "")
    .replace(/[?.,!]+$/g, "")
    .trim();

  // Strip trailing "clause" or "provision" if redundant
  if (topic.length === 0) {
    topic = "the requested clause";
  }

  return { isExistence: true, topic };
}

/**
 * Computes pre-scan estimation of tokens and time on the free tier (8K TPM).
 */
export function estimateScan(
  chunks: DocumentChunkData[],
  totalPages: number
): ScanEstimate {
  let totalTokens = 0;
  for (const c of chunks) {
    totalTokens += estimateTokens(c.text);
  }

  // Target batch size ~3,500 tokens
  const BATCH_TARGET_TOKENS = 3500;
  const batchCount = Math.max(1, Math.ceil(totalTokens / BATCH_TARGET_TOKENS));

  // On 8,000 TPM free tier, a 3,500 token batch takes roughly ~25-30 seconds
  const estimatedMinutes = Math.max(1, Math.ceil((batchCount * 28) / 60));
  const pagesDesc = totalPages > 0 ? `About ${totalPages} pages` : "Full document";
  const summaryText = `${pagesDesc}, roughly ${estimatedMinutes === 1 ? "1 minute" : `${estimatedMinutes}–${estimatedMinutes + 1} minutes`} on the free AI tier`;

  return {
    totalPages,
    totalChunks: chunks.length,
    totalTokens,
    batchCount,
    estimatedMinutes,
    summaryText,
  };
}

/**
 * Partitions document chunks into sequential batches of <= 3,500 tokens.
 */
export function partitionChunksForScan(
  chunks: DocumentChunkData[],
  maxBatchTokens = 3500
): DeepScanBatch[] {
  if (chunks.length === 0) return [];

  const sortedChunks = [...chunks].sort((a, b) => a.idx - b.idx);
  const batches: DeepScanBatch[] = [];

  let currentBatchChunks: DocumentChunkData[] = [];
  let currentTokens = 0;
  let batchIndex = 0;

  for (const chunk of sortedChunks) {
    const chunkTok = estimateTokens(chunk.text) + 20;

    if (currentBatchChunks.length > 0 && currentTokens + chunkTok > maxBatchTokens) {
      const pStart = currentBatchChunks[0].pageStart;
      const pEnd = currentBatchChunks[currentBatchChunks.length - 1].pageEnd;

      batches.push({
        index: batchIndex++,
        chunks: currentBatchChunks,
        pageStart: pStart,
        pageEnd: pEnd,
        tokens: currentTokens,
      });

      currentBatchChunks = [chunk];
      currentTokens = chunkTok;
    } else {
      currentBatchChunks.push(chunk);
      currentTokens += chunkTok;
    }
  }

  if (currentBatchChunks.length > 0) {
    const pStart = currentBatchChunks[0].pageStart;
    const pEnd = currentBatchChunks[currentBatchChunks.length - 1].pageEnd;

    batches.push({
      index: batchIndex++,
      chunks: currentBatchChunks,
      pageStart: pStart,
      pageEnd: pEnd,
      tokens: currentTokens,
    });
  }

  return batches;
}

/**
 * Executes a sequential Deep Scan across all document chunks.
 */
export async function runDeepScan(options: {
  topic: string;
  documentName: string;
  canonicalText: string;
  docPages: PageRange[];
  chunks: DocumentChunkData[];
  signal?: AbortSignal;
  onProgress?: (progress: DeepScanProgress) => void;
  onRateLimited?: (retryInSec: number) => void;
}): Promise<DeepScanResult> {
  const {
    topic,
    documentName,
    canonicalText,
    docPages,
    chunks,
    signal,
    onProgress,
    onRateLimited,
  } = options;

  const totalPages =
    docPages.length > 0
      ? docPages[docPages.length - 1].pageNumber
      : chunks.length > 0
      ? Math.max(...chunks.map((c) => c.pageEnd))
      : 1;

  const batches = partitionChunksForScan(chunks, 3500);
  const totalBatches = batches.length;

  const scannedPagesSet = new Set<number>();
  let scannedChunksCount = 0;

  interface Finding {
    batchIdx: number;
    pageRange: string;
    rawQuotes: Array<{ n: number; doc?: string; quote: string }>;
    notes: string;
  }

  const findings: Finding[] = [];
  let isStopped = false;
  let scanError: string | undefined;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    if (signal?.aborted) {
      isStopped = true;
      break;
    }

    // Record pages in this batch
    for (let p = batch.pageStart; p <= batch.pageEnd; p++) {
      scannedPagesSet.add(p);
    }
    scannedChunksCount += batch.chunks.length;

    const statusText = `Scanned pages ${batch.pageStart}–${batch.pageEnd} of ${totalPages} (batch ${i + 1}/${totalBatches})…`;

    if (onProgress) {
      onProgress({
        currentBatch: i + 1,
        totalBatches,
        pageStart: batch.pageStart,
        pageEnd: batch.pageEnd,
        totalPages,
        pagesScannedSoFar: Array.from(scannedPagesSet).sort((a, b) => a - b),
        statusText,
      });
    }

    // Build batch prompt
    const batchText = batch.chunks
      .map(
        (c) =>
          `[CLAUSE ${c.sectionLabel} | Page ${c.pageStart}–${c.pageEnd}]\n${c.text}`
      )
      .join("\n\n---\n\n");

    const systemPrompt = `You are a forensic legal contract auditor. You are scanning sequential batches of a contract for the presence of: "${topic}".
Answer strictly:
- If this excerpt contains "${topic}" or related obligations, output exact verbatim quotes copied letter-for-letter in:
  <quotes>[{"n": 1, "doc": "D1", "quote": "exact text from excerpt"}]</quotes>
  followed by a 1-sentence statement of what was found.
- If the excerpt contains NO mention of "${topic}", output exactly: NONE`;

    const userPrompt = `DOCUMENT EXCERPT (Pages ${batch.pageStart}–${batch.pageEnd} of ${documentName}):\n${batchText}\n\nQuestion: Does this excerpt contain "${topic}" or related terms? Answer with verbatim quotes or NONE.`;

    try {
      const response = await aiClient.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.0,
        maxTokens: 500,
        signal,
        onRateLimited: (evt) => {
          if (onRateLimited) onRateLimited(evt.retryInSec);
        },
      });

      const content = response.content.trim();

      if (content && !content.startsWith("NONE") && content !== "NONE.") {
        const parsed = parseQuotesJson(content);
        findings.push({
          batchIdx: i,
          pageRange: `pages ${batch.pageStart}–${batch.pageEnd}`,
          rawQuotes: parsed,
          notes: content.replace(/<quotes>[\s\S]*?<\/quotes>/gi, "").trim(),
        });
      }
    } catch (err: any) {
      if (signal?.aborted || err?.name === "AbortError" || err?.code === "ABORTED") {
        isStopped = true;
        break;
      }

      console.error(`Deep scan batch ${i + 1} failed:`, err);
      scanError = err.message || "Deep scan batch encountered an error";
      break;
    }
  }

  const scannedPagesArray = Array.from(scannedPagesSet).sort((a, b) => a - b);
  const isComplete = !isStopped && !scanError && scannedChunksCount === chunks.length;

  const coverage: CoverageObject = {
    mode: "scan",
    totalPages,
    pagesRead: scannedPagesArray,
    chunksRead: scannedChunksCount,
    totalChunks: chunks.length,
    complete: isComplete,
    pageRanges: formatPageRanges(scannedPagesArray),
    summaryText: isComplete
      ? `100% full scan completed (${totalPages} pages inspected)`
      : `Partial scan: stopped at pages ${formatPageRanges(scannedPagesArray)} (${scannedPagesArray.length} of ${totalPages} pages)`,
  };

  // Collect all raw quotes from findings
  const allRawQuotes: Array<{ n: number; doc?: string; quote: string }> = [];
  findings.forEach((f) => {
    f.rawQuotes.forEach((q) => {
      allRawQuotes.push({
        n: allRawQuotes.length + 1,
        doc: q.doc || "D1",
        quote: q.quote,
      });
    });
  });

  const verifiedQuotes = verifyExtractedQuotes(
    allRawQuotes,
    canonicalText,
    docPages
  );

  // Synthesize final answer based on scan findings
  let finalAnswer = "";

  if (isComplete) {
    if (findings.length === 0) {
      finalAnswer = `The document does not contain any clause, provision, or mention regarding "${topic}" across all ${totalPages} pages examined.`;
    } else {
      const summaryList = findings
        .map(
          (f, idx) =>
            `- On ${f.pageRange}: ${f.notes || `Found clause addressing ${topic}`} [${idx + 1}]`
        )
        .join("\n");
      finalAnswer = `Yes, the document contains provisions regarding "${topic}" across ${findings.length} section(s):\n\n${summaryList}`;
    }
  } else {
    // Partial scan due to stop or error
    const pageRangeStr = formatPageRanges(scannedPagesArray);
    if (findings.length > 0) {
      const summaryList = findings
        .map(
          (f, idx) =>
            `- On ${f.pageRange}: ${f.notes || `Found clause addressing ${topic}`} [${idx + 1}]`
        )
        .join("\n");
      finalAnswer = `Scan paused/stopped. Found ${findings.length} relevant passage(s) within the scanned section (pages ${pageRangeStr}):\n\n${summaryList}\n\nNote: Remaining pages were not scanned.`;
    } else {
      finalAnswer = `Scan paused/stopped. No provisions regarding "${topic}" were found in the scanned pages (${pageRangeStr} of ${totalPages} pages). I cannot confirm whether it exists in uninspected pages.`;
    }
  }

  return {
    answer: finalAnswer,
    quotes: verifiedQuotes,
    coverage,
    found: findings.length > 0,
    status: isStopped ? "stopped" : scanError ? "error" : "complete",
    error: scanError,
  };
}
