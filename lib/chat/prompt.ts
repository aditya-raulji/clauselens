/**
 * lib/chat/prompt.ts
 *
 * System prompt generator and BM25 token-budgeted context assembler for contract chat.
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
import { estimateTokens } from "@/lib/tokens";

export interface ChatCoverage {
  totalChunks: number;
  analyzedChunks: number;
  coveragePercentage: number;
  isFullCoverage: boolean;
  analyzedSections: string[];
  summaryText: string;
}

export interface ChatHistoryMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AssembledChatContext {
  systemPrompt: string;
  userPrompt: string;
  contextChunks: DocumentChunkData[];
  coverage: ChatCoverage;
  estimatedPromptTokens: number;
}

/**
 * Builds the strict contract-grounded system prompt.
 */
export function buildSystemPrompt(coverage: ChatCoverage): string {
  const coverageClause = coverage.isFullCoverage
    ? "All sections of this agreement are included in your context."
    : `COVERAGE NOTE: ${coverage.summaryText}. If the user asks about an uninspected topic, state clearly that the analyzed sections do not cover it.`;

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
 * Assembles token-budgeted contract context using BM25 retrieval and recent conversation history.
 */
export function assembleChatPrompt(options: {
  documentId: string;
  documentName: string;
  question: string;
  chunks: DocumentChunkData[];
  history?: ChatHistoryMessage[];
  maxPromptTokens?: number; // default ~4,500 to stay safely under 5,000 token ceiling
}): AssembledChatContext {
  const {
    documentId,
    documentName,
    question,
    chunks,
    history = [],
    maxPromptTokens = 4500,
  } = options;

  const totalChunks = chunks.length;

  // 1. Token budget distribution:
  // Base instructions take ~400 tokens
  // History takes up to ~800 tokens (last 4 turns)
  // Remainder is reserved for BM25 context excerpts (~3,200 tokens)
  const MAX_HISTORY_TOKENS = 800;
  const MAX_CONTEXT_TOKENS = 3200;

  // 2. Select recent history (last 4 messages, trimmed)
  const recentHistory = history.slice(-4);
  const formattedHistory: string[] = [];
  let historyTokens = 0;

  for (let i = recentHistory.length - 1; i >= 0; i--) {
    const msg = recentHistory[i];
    // Strip old <quotes> tags from history to keep it clean
    const cleanContent = msg.content
      .replace(/<quotes>[\s\S]*?<\/quotes>/gi, "")
      .trim();
    const entry = `${msg.role === "user" ? "User" : "ClauseLens"}: ${cleanContent}`;
    const tokens = estimateTokens(entry);

    if (historyTokens + tokens > MAX_HISTORY_TOKENS) break;
    formattedHistory.unshift(entry);
    historyTokens += tokens;
  }

  // 3. BM25 Retrieval for top chunks
  // Retrieve candidate chunks with section-number boost
  const topResults = searchDocumentChunks(
    documentId,
    question,
    chunks,
    Math.min(12, totalChunks),
    true
  );

  const selectedChunks: DocumentChunkData[] = [];
  let contextTokens = 0;

  for (const { chunk } of topResults) {
    const chunkTokens = estimateTokens(chunk.text) + 20; // +20 for header metadata
    if (contextTokens + chunkTokens > MAX_CONTEXT_TOKENS) {
      // If we don't even have 1 chunk yet, take at least 1
      if (selectedChunks.length === 0) {
        selectedChunks.push(chunk);
        contextTokens += chunkTokens;
      }
      break;
    }
    selectedChunks.push(chunk);
    contextTokens += chunkTokens;
  }

  // Sort selected chunks by original document order (idx) for coherent reading flow
  selectedChunks.sort((a, b) => a.idx - b.idx);

  // 4. Calculate Document Coverage
  const analyzedIndices = selectedChunks.map((c) => c.idx);
  const percentage =
    totalChunks > 0
      ? Math.min(100, Math.round((selectedChunks.length / totalChunks) * 100))
      : 100;
  const isFull = percentage >= 95 || selectedChunks.length === totalChunks;

  const analyzedSections = Array.from(
    new Set(selectedChunks.map((c) => c.sectionLabel).filter(Boolean))
  );

  let summaryText = "";
  if (isFull) {
    summaryText = "100% full document analyzed";
  } else {
    const sectionPreview =
      analyzedSections.slice(0, 3).join(", ") +
      (analyzedSections.length > 3 ? "..." : "");
    summaryText = `Based on analyzed sections (${sectionPreview}, ${percentage}% coverage). Unanalyzed sections were not inspected.`;
  }

  const coverage: ChatCoverage = {
    totalChunks,
    analyzedChunks: selectedChunks.length,
    coveragePercentage: percentage,
    isFullCoverage: isFull,
    analyzedSections,
    summaryText,
  };

  // 5. Build User Prompt with Excerpts
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
