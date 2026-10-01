/**
 * lib/coverage.ts
 *
 * Invariant Rule 2: If only part of a document was read, never answer as if all was read.
 *
 * Provides:
 *  - CoverageObject attached to every assistant message and persisted in messages.coverage
 *  - formatPageRanges: turns [1, 2, 3, 5, 6, 120] into "1–3, 5–6, 120"
 *  - guardApproved: hard code-level post-processor that intercepts absence phrasing
 *    ("does not contain", "no clause", "not mentioned", etc.) when coverage is incomplete
 *    and mandates an honest disclosure + full scan recommendation.
 */

export interface CoverageObject {
  mode: "full" | "retrieval" | "scan";
  totalPages: number;
  pagesRead: number[];
  chunksRead: number;
  totalChunks: number;
  complete: boolean;
  pageRanges?: string;
  summaryText?: string;
}

const ABSENCE_PATTERNS: RegExp[] = [
  /\bdoes not contain\b/i,
  /\bcontains no\b/i,
  /\bcontains not\b/i,
  /\bno (?:clause|provision|mention|term|reference|section|restriction|stipulation|agreement|obligation)\b/i,
  /\bnot mentioned\b/i,
  /\bnot found in (?:the|this|any)\b/i,
  /\bthere is no\b/i,
  /\bthere are no\b/i,
  /\bcannot (?:find|locate) any\b/i,
  /\bdoes not (?:mention|specify|state|include|provide for)\b/i,
  /\bis not (?:in|found in|present in) (?:the|this)\b/i,
  /\bnot present in (?:the|this)\b/i,
  /\bno information (?:regarding|about|on)\b/i,
  /\bdocument does not\b/i,
  /\bcontract does not\b/i,
];

/**
 * Checks if text asserts that something does not exist or is absent in the document.
 */
export function hasAbsencePhrasing(text: string): boolean {
  if (!text) return false;
  return ABSENCE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Formats a list of page numbers into human-readable ranges, e.g. "1–3, 5–6, 120".
 */
export function formatPageRanges(pages: number[]): string {
  if (!pages || pages.length === 0) return "none";

  const sorted = Array.from(new Set(pages)).sort((a, b) => a - b);
  const ranges: string[] = [];

  let start = sorted[0];
  let end = start;

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      ranges.push(start === end ? `${start}` : `${start}–${end}`);
      start = sorted[i];
      end = start;
    }
  }

  ranges.push(start === end ? `${start}` : `${start}–${end}`);
  return ranges.join(", ");
}

export interface GuardResult {
  text: string;
  wasGuarded: boolean;
  disclosure?: string;
}

/**
 * Hard Rule Post-Processor:
 * Only when coverage.complete is TRUE may an answer state that something does not exist.
 * If the answer contains absence phrasing and coverage is incomplete, rewrites the response
 * to prepend a mandatory disclosure and suggest running a full scan.
 */
export function guardApproved(
  answer: string,
  coverage: CoverageObject
): GuardResult {
  if (!answer) {
    return { text: answer, wasGuarded: false };
  }

  // If coverage is complete (100% full-read or verified deep scan), absence claims are valid
  if (coverage.complete) {
    return { text: answer, wasGuarded: false };
  }

  // If answer makes NO absence claims, it is approved as is
  if (!hasAbsencePhrasing(answer)) {
    return { text: answer, wasGuarded: false };
  }

  // INCOMPLETE COVERAGE + ABSENCE CLAIM: Mandatory rewrite
  const pageRangeStr =
    coverage.pageRanges || formatPageRanges(coverage.pagesRead);
  const pagesReadCount = coverage.pagesRead.length;
  const totalPages = coverage.totalPages || 1;

  const disclosure = `⚠️ Note: I only read pages ${pageRangeStr} (${pagesReadCount} of ${totalPages} pages in this contract). I cannot confirm this is absent from the rest of the document. Run a full scan to verify across all pages.`;

  // Prepend disclosure to make the limitation unmissable
  const rewritten = `${disclosure}\n\n${answer}`;

  return {
    text: rewritten,
    wasGuarded: true,
    disclosure,
  };
}

/**
 * Generates standard retrieval attribution label for partial reads.
 * e.g. "Based on the 8 most relevant passages (pages 1–4, 12) out of 150 pages."
 */
export function getRetrievalAttribution(coverage: CoverageObject): string {
  if (coverage.complete) {
    return `Read all ${coverage.totalPages} pages (${coverage.totalChunks} passages indexed).`;
  }

  const rangeStr =
    coverage.pageRanges || formatPageRanges(coverage.pagesRead);
  return `Based on the ${coverage.chunksRead} most relevant passages (pages ${rangeStr}) out of ${coverage.totalPages} pages.`;
}
