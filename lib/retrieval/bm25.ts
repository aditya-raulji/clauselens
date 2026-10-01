/**
 * lib/retrieval/bm25.ts
 *
 * In-memory BM25 retrieval engine with per-document caching,
 * contract-aware tokenization (preserving numbers & currency), and section-number boosting.
 */

import { DocumentChunkData } from "@/lib/chunk/chunk";

export interface BM25SearchResult {
  chunk: DocumentChunkData;
  score: number;
}

// Light stopwords to filter out grammatical glue while preserving contract semantics
const LIGHT_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "as",
  "is",
  "was",
  "are",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "shall",
  "should",
  "can",
  "could",
  "may",
  "might",
  "must",
  "under",
  "that",
  "which",
  "who",
  "whom",
  "this",
  "these",
  "those",
  "it",
  "its",
  "they",
  "them",
  "their",
]);

// Tokenizer regex: matches numbers/currencies/percentages or alphanumeric words
const TOKEN_REGEX =
  /[$€£¥₹]?\d+(?:[.,]\d+)*(?:%|\([a-z0-9]+\))?|[a-z0-9]+(?:[-_][a-z0-9]+)*/gi;

/**
 * Tokenizes text:
 *  - Lowercase
 *  - Light stopwords removed
 *  - Numbers, section identifiers ("12.3", "(a)"), and currency amounts preserved
 */
export function tokenize(text: string): string[] {
  if (!text) return [];

  const lower = text.toLowerCase();
  const matches = lower.match(TOKEN_REGEX) || [];
  const tokens: string[] = [];

  for (const match of matches) {
    // Keep numbers and currencies even if short
    const isNumberOrCurrency = /[\d$€£¥₹%]/.test(match);
    if (isNumberOrCurrency) {
      tokens.push(match);
      continue;
    }

    if (!LIGHT_STOPWORDS.has(match) && match.length > 1) {
      tokens.push(match);
    }
  }

  return tokens;
}

/**
 * Extracts section or clause numbers from a query string.
 * e.g., "clause 12.3", "section 4.1(a)", "article 2"
 */
export function extractSectionNumbers(query: string): string[] {
  const nums: string[] = [];
  const regex =
    /(?:section|clause|article|§)?\s*(\d+(?:\.\d+)*(?:\([a-z0-9]+\))?)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(query)) !== null) {
    if (match[1]) {
      nums.push(match[1]);
    }
  }

  return nums;
}

export class BM25Index {
  chunks: DocumentChunkData[];
  docTokens: string[][];
  docLengths: number[];
  avgdl: number;
  docFreqs: Map<string, number>;
  idf: Map<string, number>;
  k1: number;
  b: number;

  constructor(chunks: DocumentChunkData[], k1 = 1.2, b = 0.75) {
    this.chunks = chunks;
    this.k1 = k1;
    this.b = b;
    this.docTokens = [];
    this.docLengths = [];
    this.docFreqs = new Map();
    this.idf = new Map();

    let totalTokens = 0;
    const N = chunks.length;

    // 1. Tokenize all chunks
    for (const chunk of chunks) {
      // Include section label in indexed text
      const fullText = `${chunk.sectionLabel} ${chunk.text}`;
      const tokens = tokenize(fullText);
      this.docTokens.push(tokens);
      this.docLengths.push(tokens.length);
      totalTokens += tokens.length;

      const uniqueTokens = new Set(tokens);
      for (const t of uniqueTokens) {
        this.docFreqs.set(t, (this.docFreqs.get(t) || 0) + 1);
      }
    }

    this.avgdl = N > 0 ? totalTokens / N : 1;

    // 2. Compute IDF for all terms
    for (const [term, df] of this.docFreqs.entries()) {
      // Robertson-Spärck Jones IDF with floor to ensure positive value
      const idfValue = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      this.idf.set(term, Math.max(0.1, idfValue));
    }
  }

  /**
   * Scores all chunks against a query and returns top-k matches.
   */
  search(
    query: string,
    topK = 5,
    boostSectionNumbers = true
  ): BM25SearchResult[] {
    if (this.chunks.length === 0) return [];

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) {
      return this.chunks.slice(0, topK).map((chunk) => ({ chunk, score: 0 }));
    }

    const sectionNumbers = boostSectionNumbers ? extractSectionNumbers(query) : [];
    const scores: Array<{ chunk: DocumentChunkData; score: number }> = [];

    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i];
      const tokens = this.docTokens[i];
      const docLen = this.docLengths[i];

      // Calculate term frequencies in this chunk
      const tfMap = new Map<string, number>();
      for (const t of tokens) {
        tfMap.set(t, (tfMap.get(t) || 0) + 1);
      }

      let score = 0;
      for (const qTerm of queryTokens) {
        const tf = tfMap.get(qTerm) || 0;
        if (tf === 0) continue;

        const termIdf = this.idf.get(qTerm) || 0.1;
        const numerator = tf * (this.k1 + 1);
        const denominator =
          tf + this.k1 * (1 - this.b + this.b * (docLen / this.avgdl));

        score += termIdf * (numerator / denominator);
      }

      // Apply section-number boost if query specifically targets a clause number
      if (boostSectionNumbers && sectionNumbers.length > 0) {
        for (const num of sectionNumbers) {
          const inLabel = chunk.sectionLabel.includes(num);
          const inStartText = chunk.text.slice(0, 150).includes(num);

          if (inLabel) {
            score += 8.0; // Significant boost for direct section label match
          } else if (inStartText) {
            score += 4.0; // Moderate boost for clause heading at start of chunk
          }
        }
      }

      scores.push({ chunk, score });
    }

    // Sort descending by score
    scores.sort((a, b) => b.score - a.score);

    return scores.slice(0, topK);
  }
}

// In-memory index cache per document ID
const documentIndexCache = new Map<string, BM25Index>();

/**
 * Retrieves or builds a cached BM25 index for a document.
 */
export function getOrBuildBM25Index(
  documentId: string,
  chunks: DocumentChunkData[]
): BM25Index {
  const cached = documentIndexCache.get(documentId);
  if (cached && cached.chunks.length === chunks.length) {
    return cached;
  }

  const newIndex = new BM25Index(chunks);
  documentIndexCache.set(documentId, newIndex);
  return newIndex;
}

/**
 * Searches a document's chunks with BM25.
 */
export function searchDocumentChunks(
  documentId: string,
  query: string,
  chunks: DocumentChunkData[],
  topK = 5,
  boostSectionNumbers = true
): BM25SearchResult[] {
  const index = getOrBuildBM25Index(documentId, chunks);
  return index.search(query, topK, boostSectionNumbers);
}

/**
 * Clears cached BM25 index for a document (e.g. after re-processing).
 */
export function clearBM25Cache(documentId?: string): void {
  if (documentId) {
    documentIndexCache.delete(documentId);
  } else {
    documentIndexCache.clear();
  }
}
