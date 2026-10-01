/**
 * lib/chat/prompt.ts
 *
 * System prompt generator and BM25 token-budgeted context assembler for contract chat.
 *
 * Strategy (hybrid):
 *  1. Small docs (<= 9,000 tokens): Full-context mode, 100% coverage.
 *  2. Larger docs: Retrieval mode with deterministic legal synonym query expansion,
 *     BM25 top-k chunks within budget.
 *
 * Constraints:
 *  - Free tier limits: Keep total prompt under ~5,000 tokens (TPM limit is ~8,000).
 *  - Strict zero-hallucination rules: Answer ONLY from provided excerpts.
 *  - Cite using [1], [2] markers.
 *  - Output verbatim quotes block:
 *    <quotes>[{"n":1,"doc":"D1","quote":"text copied VERBATIM from the excerpt, max 40 words"}]</quotes>
 */

import { DocumentChunkData } from "@/lib/chunk/chunk";
import { searchDocumentChunks } from "@/lib/retrieval/bm25";
import { expandLegalQuery } from "@/lib/retrieval/synonyms";
import { estimateTokens } from "@/lib/tokens";
import { CoverageObject, formatPageRanges } from "@/lib/coverage";

export interface ChatHistoryMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AssembledChatContext {
  systemPrompt: string;
  userPrompt: string;
  contextChunks: DocumentChunkData[];
  coverage: CoverageObject;
  estimatedPromptTokens: number;
}

/**
 * Builds the strict contract-grounded system prompt.
 */
export function buildSystemPrompt(coverage: CoverageObject): string {
  const coverageClause = coverage.complete
    ? "All sections and pages of this agreement are included in your context."
    : `COVERAGE NOTE: ${coverage.summaryText || "Only partial sections of this document are in context."}. If the user asks about an uninspected topic, state clearly that the analyzed sections do not cover it.`;

  return `You are ClauseLens, a high-precision contract analysis assistant.
Your answers are governed by strict legal accuracy and zero-hallucination rules:

1. SOURCE GROUNDING:
Answer ONLY from the provided contract excerpts.
If the answer is NOT stated in the excerpts, say plainly: "The document does not contain information regarding [topic]." Never invent or assume terms.

2. STYLE & CONCISENESS:
Keep answers concise, direct, and in plain language.
Synthesize the key legal obligations, rights, deadlines, or monetary limits.

3. IN-TEXT CITATIONS:
Cite every claim using numeric citation markers corresponding to your quote list, e.g. [1], [2].

4. VERBATIM QUOTES BLOCK:
At the very end of your response, output a single JSON block wrapped in <quotes>...</quotes> tags containing the exact verbatim excerpts that support your answer:
<quotes>[{"n":1,"doc":"D1","quote":"exact verbatim text copied from the excerpt, max 40 words"}]</quotes>

RULES FOR QUOTES:
- Quotes must be copied LETTER-FOR-LETTER from the excerpt text.
- NEVER paraphrase quotes.
- NEVER stitch phrases together from different paragraphs without using an ellipsis ("...").
- Keep quotes focused and under 40 words.
- If the document does not contain an answer or does not support a claim, return an empty quotes array: <quotes>[]</quotes>

${coverageClause}`;
}

/**
 * Assembles token-budgeted contract context using full-context mode for small docs
 * or BM25 retrieval with legal synonym query expansion for larger docs.
 */
export function assembleChatPrompt(options: {
  documentId: string;
  documentName: string;
  question: string;
  chunks: DocumentChunkData[];
  canonicalText?: string;
  totalPages?: number;
  history?: ChatHistoryMessage[];
  maxPromptTokens?: number;
}): AssembledChatContext {
  const {
    documentId,
    documentName,
    question,
    chunks,
    canonicalText = "",
    totalPages: inputTotalPages,
    history = [],
    maxPromptTokens = 4500,
  } = options;

  const totalChunks = chunks.length;
  const totalPages =
    inputTotalPages && inputTotalPages > 0
      ? inputTotalPages
      : chunks.length > 0
      ? Math.max(...chunks.map((c) => c.pageEnd))
      : 1;

  // Calculate canonical text tokens
  const totalDocTokens = canonicalText
    ? estimateTokens(canonicalText)
    : chunks.reduce((acc, c) => acc + estimateTokens(c.text), 0);

  // Strategy 1: Small docs (<= 9,000 tokens) -> Full Context Mode
  const isSmallDoc = totalDocTokens <= 9000 && totalChunks <= 20;

  // 1. History selection (last 4 turns, up to ~800 tokens)
  const MAX_HISTORY_TOKENS = 800;
  const recentHistory = history.slice(-4);
  const formattedHistory: string[] = [];
  let historyTokens = 0;

  for (let i = recentHistory.length - 1; i >= 0; i--) {
    const msg = recentHistory[i];
    const cleanContent = msg.content
      .replace(/<quotes>[\s\S]*?<\/quotes>/gi, "")
      .trim();
    const entry = `${msg.role === "user" ? "User" : "ClauseLens"}: ${cleanContent}`;
    const tokens = estimateTokens(entry);

    if (historyTokens + tokens > MAX_HISTORY_TOKENS) break;
    formattedHistory.unshift(entry);
    historyTokens += tokens;
  }

  // 2. Select chunks: Full mode or Retrieval mode
  let selectedChunks: DocumentChunkData[] = [];
  let mode: "full" | "retrieval" = "retrieval";

  if (isSmallDoc) {
    // Strategy 1: Full-context mode
    mode = "full";
    selectedChunks = [...chunks].sort((a, b) => a.idx - b.idx);
  } else {
    // Strategy 2: Retrieval mode with legal synonym query expansion
    mode = "retrieval";
    const MAX_CONTEXT_TOKENS = 3200;

    // Cheap query expansion via deterministic legal synonym map
    const expandedQuery = expandLegalQuery(question);

    const topResults = searchDocumentChunks(
      documentId,
      expandedQuery,
      chunks,
      Math.min(14, totalChunks),
      true
    );

    let contextTokens = 0;
    for (const { chunk } of topResults) {
      const chunkTokens = estimateTokens(chunk.text) + 20;
      if (contextTokens + chunkTokens > MAX_CONTEXT_TOKENS) {
        if (selectedChunks.length === 0) {
          selectedChunks.push(chunk);
          contextTokens += chunkTokens;
        }
        break;
      }
      selectedChunks.push(chunk);
      contextTokens += chunkTokens;
    }

    selectedChunks.sort((a, b) => a.idx - b.idx);
  }

  // 3. Compute CoverageObject
  const pagesReadSet = new Set<number>();
  for (const c of selectedChunks) {
    for (let p = c.pageStart; p <= c.pageEnd; p++) {
      pagesReadSet.add(p);
    }
  }
  const pagesRead = Array.from(pagesReadSet).sort((a, b) => a - b);
  const pageRanges = formatPageRanges(pagesRead);

  const isComplete =
    mode === "full" ||
    selectedChunks.length === totalChunks ||
    pagesRead.length >= totalPages;

  let summaryText = "";
  if (isComplete) {
    summaryText = `Read all ${totalPages} pages (${totalChunks} passages indexed)`;
  } else {
    summaryText = `Based on the ${selectedChunks.length} most relevant passages (pages ${pageRanges}) out of ${totalPages} pages`;
  }

  const coverage: CoverageObject = {
    mode,
    totalPages,
    pagesRead,
    chunksRead: selectedChunks.length,
    totalChunks,
    complete: isComplete,
    pageRanges,
    summaryText,
  };

  // 4. Assemble Prompts
  const systemPrompt = buildSystemPrompt(coverage);

  const excerptBlocks = selectedChunks
    .map((c, i) => {
      const pageTag =
        c.pageStart === c.pageEnd
          ? `Page ${c.pageStart}`
          : `Pages ${c.pageStart}–${c.pageEnd}`;
      return `[EXCERPT ${i + 1} | ${documentName} | ${c.sectionLabel} | ${pageTag}]\n${c.text}`;
    })
    .join("\n\n---\n\n");

  const historyBlock =
    formattedHistory.length > 0
      ? `RECENT CONVERSATION:\n${formattedHistory.join("\n")}\n\n---\n`
      : "";

  const userPrompt = `${historyBlock}CONTRACT EXCERPTS:\n${excerptBlocks}\n\n---\nUSER QUESTION:\n${question}\n\nAnswer concisely based ONLY on the excerpts above. Cite statements using [1], [2], and conclude with the verbatim <quotes>[...]</quotes> JSON block.`;

  const totalEstimated =
    estimateTokens(systemPrompt) + estimateTokens(userPrompt);

  return {
    systemPrompt,
    userPrompt,
    contextChunks: selectedChunks,
    coverage,
    estimatedPromptTokens: totalEstimated,
  };
}
