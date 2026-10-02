/**
 * lib/chat/multiDoc.ts
 *
 * Multi-document chat support:
 *  - Assigns stable D1, D2, ... labels to selected documents.
 *  - Splits token budget proportionally with guaranteed minimum per document.
 *  - Retrieves BM25 top-k chunks per document within their budget.
 *  - Builds labeled [D1: filename] excerpt blocks.
 *  - Produces comparative system prompt: verdict -> comparison table/bullets -> gaps.
 *  - Computes per-document CoverageObject.
 */

import { DocumentChunkData } from "@/lib/chunk/chunk";
import { searchDocumentChunks } from "@/lib/retrieval/bm25";
import { expandLegalQuery } from "@/lib/retrieval/synonyms";
import { estimateTokens } from "@/lib/tokens";
import { CoverageObject, formatPageRanges } from "@/lib/coverage";

export interface DocMeta {
  id: string;
  name: string;
  canonicalText: string;
  chunks: DocumentChunkData[];
  totalPages: number;
  label: string; // assigned stable label e.g. "D1"
}

export interface MultiDocCoverage {
  perDoc: Record<string, CoverageObject>;
  allComplete: boolean;
  summaryLine: string; // e.g. "D1: 10/40 pages · D2: 40/40 pages"
}

export interface MultiDocContext {
  systemPrompt: string;
  userPrompt: string;
  selectedPerDoc: Array<{ label: string; docId: string; chunks: DocumentChunkData[] }>;
  coverage: MultiDocCoverage;
  labelToDocId: Record<string, string>;
  labelToName: Record<string, string>;
  docIdToLabel: Record<string, string>;
  estimatedPromptTokens: number;
}

// ---------------------------------------------------------------------------
const MAX_TOTAL_CONTEXT_TOKENS = 3800;
const MIN_TOKENS_PER_DOC = 400;
export const MAX_MULTI_DOC_COUNT = 5;

// ---------------------------------------------------------------------------
// Label Assignment
// ---------------------------------------------------------------------------

export function assignDocLabels(docs: Array<{ id: string }>): Record<string, string> {
  const map: Record<string, string> = {};
  docs.forEach((d, i) => { map[d.id] = `D${i + 1}`; });
  return map;
}

export function invertLabelMap(docIdToLabel: Record<string, string>): Record<string, string> {
  const inv: Record<string, string> = {};
  for (const [docId, label] of Object.entries(docIdToLabel)) { inv[label] = docId; }
  return inv;
}

// ---------------------------------------------------------------------------
// Token Budget Splitting
// ---------------------------------------------------------------------------

/**
 * Proportional split with guaranteed minimum per document.
 * 1. Give every doc MIN_TOKENS_PER_DOC.
 * 2. Distribute remaining budget proportionally by doc content size.
 * 3. Cap each doc at its actual content size.
 */
export function splitTokenBudget(
  docs: Array<{ id: string; totalTokens: number }>,
  totalBudget = MAX_TOTAL_CONTEXT_TOKENS
): Record<string, number> {
  const n = docs.length;
  if (n === 0) return {};

  const reservedMin = Math.min(MIN_TOKENS_PER_DOC, Math.floor(totalBudget / n));
  const remaining = totalBudget - reservedMin * n;
  const totalContent = docs.reduce((acc, d) => acc + d.totalTokens, 0);
  const budgets: Record<string, number> = {};

  for (const doc of docs) {
    const share = totalContent > 0
      ? Math.floor((doc.totalTokens / totalContent) * remaining)
      : Math.floor(remaining / n);
    budgets[doc.id] = reservedMin + Math.min(share, doc.totalTokens - reservedMin);
  }
  return budgets;
}

// ---------------------------------------------------------------------------
// Per-Document Retrieval
// ---------------------------------------------------------------------------

function retrieveChunksForDoc(
  docId: string,
  question: string,
  chunks: DocumentChunkData[],
  tokenBudget: number
): DocumentChunkData[] {
  if (chunks.length === 0) return [];

  const totalDocTokens = chunks.reduce((acc, c) => acc + estimateTokens(c.text), 0);
  const isSmallDoc = totalDocTokens <= 9000 && chunks.length <= 20;

  if (isSmallDoc) {
    return [...chunks].sort((a, b) => a.idx - b.idx);
  }

  const expandedQuery = expandLegalQuery(question);
  const topResults = searchDocumentChunks(docId, expandedQuery, chunks, Math.min(14, chunks.length), true);

  const selected: DocumentChunkData[] = [];
  let usedTokens = 0;

  for (const { chunk } of topResults) {
    const chunkTokens = estimateTokens(chunk.text) + 20;
    if (usedTokens + chunkTokens > tokenBudget) {
      if (selected.length === 0) selected.push(chunk);
      break;
    }
    selected.push(chunk);
    usedTokens += chunkTokens;
  }

  return selected.sort((a, b) => a.idx - b.idx);
}

// ---------------------------------------------------------------------------
// Per-Document Coverage
// ---------------------------------------------------------------------------

function buildDocCoverage(doc: DocMeta, selectedChunks: DocumentChunkData[]): CoverageObject {
  const pagesReadSet = new Set<number>();
  for (const c of selectedChunks) {
    for (let p = c.pageStart; p <= c.pageEnd; p++) pagesReadSet.add(p);
  }
  const pagesRead = Array.from(pagesReadSet).sort((a, b) => a - b);
  const pageRanges = formatPageRanges(pagesRead);
  const totalPages = doc.totalPages || 1;
  const totalChunks = doc.chunks.length;
  const totalDocTokens = doc.chunks.reduce((acc, c) => acc + estimateTokens(c.text), 0);
  const isSmallDoc = totalDocTokens <= 9000 && totalChunks <= 20;
  const isComplete = isSmallDoc || selectedChunks.length === totalChunks || pagesRead.length >= totalPages;

  return {
    mode: isSmallDoc ? "full" : "retrieval",
    totalPages,
    pagesRead,
    chunksRead: selectedChunks.length,
    totalChunks,
    complete: isComplete,
    pageRanges,
    summaryText: isComplete
      ? `Read all ${totalPages} pages (${totalChunks} passages indexed)`
      : `Based on ${selectedChunks.length} passages (pages ${pageRanges}) of ${totalPages} pages`,
  };
}

// ---------------------------------------------------------------------------
// Comparative System Prompt
// ---------------------------------------------------------------------------

function buildMultiDocSystemPrompt(
  labelToName: Record<string, string>,
  coverage: MultiDocCoverage
): string {
  const labels = Object.keys(labelToName);
  const docList = labels.map((l) => `  ${l}: "${labelToName[l]}"`).join("\n");

  const coverageClauses = labels.map((label) => {
    const cov = coverage.perDoc[label];
    if (!cov) return "";
    if (cov.complete) return `${label}: All ${cov.totalPages} pages read (complete).`;
    return `${label}: PARTIAL — pages ${cov.pageRanges} only (${cov.pagesRead.length}/${cov.totalPages}). Do NOT state ${label} is silent on a topic unless you have verified in all ${cov.totalPages} pages.`;
  }).join(" ");

  const colHeader = labels.join(" | ");

  return `You are ClauseLens, a high-precision multi-document contract analysis assistant.
You are comparing ${labels.length} document(s):
${docList}

STRICT COMPARATIVE ANSWER STRUCTURE — follow this order every time:
1. SHORT VERDICT (1–2 sentences): Summarise the key comparison finding.
2. COMPARISON (markdown table with columns ${colHeader}, or contrasting bullets per topic):
   - Show what each document says on each topic.
   - If a document is silent on a topic, write explicitly: "${labels[1] ?? "D2"} does not address this."
3. GAPS: List any topics where one or more documents are completely silent.

RULES:
- Answer ONLY from the provided excerpts. NEVER invent or paraphrase.
- DO NOT list documents separately — synthesize and compare.
- Cite every claim using [1], [2], etc.
- At the very end output one <quotes> JSON block:
  <quotes>[{"n":1,"doc":"D1","quote":"verbatim text, max 40 words"},{"n":2,"doc":"D2","quote":"verbatim text"}]</quotes>
- Every quote object MUST include a "doc" field matching the document label (D1, D2, …).
- Copy quotes LETTER-FOR-LETTER from the excerpt labeled with that document. Never swap documents.
- Keep each quote under 40 words. Use "..." for ellipsis.

COVERAGE:
${coverageClauses}`;
}

// ---------------------------------------------------------------------------
// Main Assembler
// ---------------------------------------------------------------------------

export function assembleMultiDocPrompt(options: {
  docs: DocMeta[];
  question: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  maxTotalTokens?: number;
}): MultiDocContext {
  const { docs, question, history = [], maxTotalTokens = MAX_TOTAL_CONTEXT_TOKENS } = options;

  // 1. Assign labels
  const docIdToLabel: Record<string, string> = {};
  const labelToDocId: Record<string, string> = {};
  const labelToName: Record<string, string> = {};
  docs.forEach((d, i) => {
    const label = `D${i + 1}`;
    docIdToLabel[d.id] = label;
    labelToDocId[label] = d.id;
    labelToName[label] = d.name;
  });

  // 2. Split token budget
  const docsWithTokens = docs.map((d) => ({
    id: d.id,
    totalTokens: d.canonicalText
      ? estimateTokens(d.canonicalText)
      : d.chunks.reduce((acc, c) => acc + estimateTokens(c.text), 0),
  }));
  const budgets = splitTokenBudget(docsWithTokens, maxTotalTokens);

  // 3. Retrieve + coverage per document
  const selectedPerDoc: MultiDocContext["selectedPerDoc"] = [];
  const perDocCoverage: Record<string, CoverageObject> = {};

  for (const doc of docs) {
    const label = docIdToLabel[doc.id];
    const budget = budgets[doc.id] ?? MIN_TOKENS_PER_DOC;
    const selected = retrieveChunksForDoc(doc.id, question, doc.chunks, budget);
    selectedPerDoc.push({ label, docId: doc.id, chunks: selected });
    perDocCoverage[label] = buildDocCoverage(doc, selected);
  }

  // 4. Build multi-doc coverage object
  const allComplete = Object.values(perDocCoverage).every((c) => c.complete);
  const summaryParts = Object.entries(perDocCoverage).map(([label, cov]) =>
    cov.complete
      ? `${label}: ${cov.totalPages}/${cov.totalPages} pages`
      : `${label}: ${cov.pagesRead.length}/${cov.totalPages} pages`
  );
  const coverage: MultiDocCoverage = {
    perDoc: perDocCoverage,
    allComplete,
    summaryLine: summaryParts.join(" · "),
  };

  // 5. History (last 4 turns, up to 800 tokens)
  const MAX_HISTORY_TOKENS = 800;
  const formattedHistory: string[] = [];
  let historyTokens = 0;
  for (let i = history.slice(-4).length - 1; i >= 0; i--) {
    const msg = history.slice(-4)[i];
    const clean = msg.content.replace(/<quotes>[\s\S]*?<\/quotes>/gi, "").trim();
    const entry = `${msg.role === "user" ? "User" : "ClauseLens"}: ${clean}`;
    const tokens = estimateTokens(entry);
    if (historyTokens + tokens > MAX_HISTORY_TOKENS) break;
    formattedHistory.unshift(entry);
    historyTokens += tokens;
  }

  const historyBlock = formattedHistory.length > 0
    ? `RECENT CONVERSATION:\n${formattedHistory.join("\n")}\n\n---\n`
    : "";

  // 6. Build labeled excerpt blocks
  const excerptBlocks = selectedPerDoc.map(({ label, chunks: selChunks }) => {
    const docName = labelToName[label];
    if (selChunks.length === 0) {
      return `[${label}: ${docName}]\n(No relevant passages found for this document.)`;
    }
    return selChunks
      .map((c) => {
        const pageTag = c.pageStart === c.pageEnd
          ? `Page ${c.pageStart}`
          : `Pages ${c.pageStart}-${c.pageEnd}`;
        return `[${label}: ${docName} | ${c.sectionLabel} | ${pageTag}]\n${c.text}`;
      })
      .join("\n\n---\n\n");
  });

  const systemPrompt = buildMultiDocSystemPrompt(labelToName, coverage);
  const userPrompt = `${historyBlock}CONTRACT EXCERPTS (${Object.keys(labelToName).join(", ")}):\n\n${excerptBlocks.join("\n\n══════════════════════════\n\n")}\n\n---\nUSER QUESTION:\n${question}\n\nProvide a COMPARATIVE answer: SHORT VERDICT -> COMPARISON TABLE/BULLETS -> GAPS. Cite [1],[2]. End with <quotes>[...] including "doc" labels.`;

  return {
    systemPrompt,
    userPrompt,
    selectedPerDoc,
    coverage,
    labelToDocId,
    labelToName,
    docIdToLabel,
    estimatedPromptTokens: estimateTokens(systemPrompt) + estimateTokens(userPrompt),
  };
}
