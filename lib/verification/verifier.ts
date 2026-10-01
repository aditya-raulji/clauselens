export interface VerifiedQuote {
  quote: string;
  verified: boolean;
  startOffset?: number;
  endOffset?: number;
  pageNumber?: number;
  matchedText?: string;
  confidence: number; // 0 to 1
  reason?: string;
}

export interface DocumentCoverage {
  totalChunks: number;
  analyzedChunks: number;
  coveragePercentage: number;
  isFullCoverage: boolean;
  analyzedSections: string[];
  summaryText: string;
}

interface PageOffsetMap {
  pageNumber: number;
  startOffset: number;
  endOffset: number;
}

/**
 * Normalizes text for lenient matching (normalizes quotes, dashes, whitespace)
 */
function normalizeForMatching(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'") // curly single quotes
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"') // curly double quotes
    .replace(/[\u2013\u2014]/g, "-") // em/en dashes
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Given a startOffset, find which page number it belongs to
 */
function findPageForOffset(pages: PageOffsetMap[], offset: number): number {
  if (pages.length === 0) return 1;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (offset >= page.startOffset && offset <= page.endOffset) {
      return page.pageNumber;
    }
  }

  // Fallback to nearest page
  if (offset < pages[0].startOffset) return pages[0].pageNumber;
  return pages[pages.length - 1].pageNumber;
}

/**
 * Invariant Rule 1: Locate quote in canonical text strictly in our code
 */
export function verifyQuote(
  rawQuote: string,
  canonicalText: string,
  pages: PageOffsetMap[]
): VerifiedQuote {
  const quote = rawQuote.trim();

  if (!quote || quote.length < 5) {
    return {
      quote,
      verified: false,
      confidence: 0,
      reason: "Quote too short or empty to verify reliably",
    };
  }

  // 1. Strict exact match
  const exactIndex = canonicalText.indexOf(quote);
  if (exactIndex !== -1) {
    const startOffset = exactIndex;
    const endOffset = exactIndex + quote.length;
    const pageNumber = findPageForOffset(pages, startOffset);

    return {
      quote,
      verified: true,
      startOffset,
      endOffset,
      pageNumber,
      matchedText: quote,
      confidence: 1.0,
    };
  }

  // 2. Normalized whitespace & punctuation match
  const normalizedDoc = normalizeForMatching(canonicalText);
  const normalizedQuote = normalizeForMatching(quote);

  const normIndex = normalizedDoc.indexOf(normalizedQuote);
  if (normIndex !== -1) {
    // Map normalized index back to approximate canonical index
    // Search in a window around relative character position
    const ratio = normIndex / normalizedDoc.length;
    const estimatedCanonStart = Math.floor(ratio * canonicalText.length);
    const windowStart = Math.max(0, estimatedCanonStart - 500);
    const windowEnd = Math.min(canonicalText.length, estimatedCanonStart + quote.length + 500);
    const windowText = canonicalText.substring(windowStart, windowEnd);

    // Look for first 20 chars of quote
    const anchor = quote.substring(0, Math.min(25, quote.length)).trim();
    const anchorIdx = windowText.indexOf(anchor);

    let startOffset = estimatedCanonStart;
    let endOffset = estimatedCanonStart + quote.length;

    if (anchorIdx !== -1) {
      startOffset = windowStart + anchorIdx;
      endOffset = startOffset + quote.length;
    }

    const pageNumber = findPageForOffset(pages, startOffset);

    return {
      quote,
      verified: true,
      startOffset,
      endOffset,
      pageNumber,
      matchedText: canonicalText.substring(startOffset, endOffset),
      confidence: 0.95,
    };
  }

  // 3. Substring anchor match (first 40 characters + last 20 characters)
  if (quote.length > 60) {
    const head = quote.substring(0, 35);
    const headIdx = canonicalText.indexOf(head);

    if (headIdx !== -1) {
      const startOffset = headIdx;
      const endOffset = headIdx + quote.length;
      const pageNumber = findPageForOffset(pages, startOffset);

      return {
        quote,
        verified: true,
        startOffset,
        endOffset,
        pageNumber,
        matchedText: canonicalText.substring(startOffset, endOffset),
        confidence: 0.85,
      };
    }
  }

  // Failed verification
  return {
    quote,
    verified: false,
    confidence: 0,
    reason: "Quote could not be located in canonical document text",
  };
}

/**
 * Verify an array of quotes extracted from an AI response
 */
export function verifyAllQuotes(
  quotes: string[],
  canonicalText: string,
  pages: PageOffsetMap[]
): VerifiedQuote[] {
  return quotes.map((q) => verifyQuote(q, canonicalText, pages));
}

/**
 * Invariant Rule 2: Calculate document coverage
 */
export function calculateCoverage(
  analyzedChunkIndices: number[],
  totalChunksCount: number,
  chunkLabels: { idx: number; sectionLabel: string }[] = []
): DocumentCoverage {
  const uniqueAnalyzed = Array.from(new Set(analyzedChunkIndices));
  const analyzedCount = uniqueAnalyzed.length;
  const percentage =
    totalChunksCount > 0
      ? Math.min(100, Math.round((analyzedCount / totalChunksCount) * 100))
      : 100;

  const analyzedSections = Array.from(
    new Set(
      chunkLabels
        .filter((c) => uniqueAnalyzed.includes(c.idx))
        .map((c) => c.sectionLabel)
    )
  );

  const isFullCoverage = percentage >= 98;

  let summaryText = "";
  if (isFullCoverage) {
    summaryText = "100% full document analyzed";
  } else {
    const sectionsText =
      analyzedSections.length > 0
        ? ` (${analyzedSections.slice(0, 3).join(", ")}${
            analyzedSections.length > 3 ? "..." : ""
          })`
        : "";
    summaryText = `Based on ${percentage}% document coverage${sectionsText}. Unanalyzed sections were not inspected.`;
  }

  return {
    totalChunks: totalChunksCount,
    analyzedChunks: analyzedCount,
    coveragePercentage: percentage,
    isFullCoverage,
    analyzedSections,
    summaryText,
  };
}
