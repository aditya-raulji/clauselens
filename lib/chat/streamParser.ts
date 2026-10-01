/**
 * lib/chat/streamParser.ts
 *
 * Stream processing and defensive JSON parsing for the <quotes> block.
 *
 * Invariants:
 *  - The raw <quotes> tag and its JSON payload are NEVER exposed in the visible token stream.
 *  - Handles chunk boundaries arbitrarily splitting the <quotes> tag (e.g. "<", "quo", "tes>").
 *  - Defensively parses quote arrays (tolerates markdown fences, missing tags, trailing noise).
 *  - Verifies each quote against canonical document text using lib/quotes/verify.ts.
 */

import { verifyQuote, Occurrence } from "@/lib/quotes/verify";
import { getQuotePages, PageRange } from "@/lib/quotes/pages";

export interface RawQuoteItem {
  n: number;
  doc?: string;
  quote: string;
}

export interface VerifiedQuoteItem {
  n: number;
  doc?: string;
  quote: string;
  status: "verified" | "unverified";
  occurrences: Occurrence[];
  pageStart?: number;
  pageEnd?: number;
  crossesPageBreak?: boolean;
  ambiguous?: boolean;
  reason?: string;
  matchedText?: string;
}

const QUOTES_TAG = "<quotes>";
const MAX_PREFIX_LEN = QUOTES_TAG.length - 1; // 7 chars ("<quotes")

/**
 * Stateful stream stripper that buffers potential prefixes of <quotes>
 * and directs everything after <quotes> into a private quotes buffer.
 */
export class QuotesStreamStripper {
  private pendingBuffer = "";
  private quotesBuffer = "";
  private quotesStarted = false;
  private visibleAccumulated = "";

  /**
   * Consumes an incoming text token from the AI stream and returns
   * the safe, visible text to send to the client.
   */
  push(token: string): string {
    if (!token) return "";

    // If already in quotes block, redirect all text to quotesBuffer
    if (this.quotesStarted) {
      this.quotesBuffer += token;
      return "";
    }

    this.pendingBuffer += token;

    // Check if <quotes> is present in the pending buffer
    const lower = this.pendingBuffer.toLowerCase();
    const tagIdx = lower.indexOf(QUOTES_TAG);

    if (tagIdx !== -1) {
      // Everything before <quotes> is visible text
      const visible = this.pendingBuffer.slice(0, tagIdx);
      this.quotesBuffer = this.pendingBuffer.slice(tagIdx);
      this.pendingBuffer = "";
      this.quotesStarted = true;
      this.visibleAccumulated += visible;
      return visible;
    }

    // Check if the end of pendingBuffer could be the start of <quotes>
    const checkLen = Math.min(MAX_PREFIX_LEN, this.pendingBuffer.length);
    let matchedPrefixLen = 0;

    for (let len = checkLen; len >= 1; len--) {
      const suffix = lower.slice(-len);
      if (QUOTES_TAG.startsWith(suffix)) {
        matchedPrefixLen = len;
        break;
      }
    }

    if (matchedPrefixLen > 0) {
      // Flush safe characters before the potential prefix
      const safeLen = this.pendingBuffer.length - matchedPrefixLen;
      if (safeLen > 0) {
        const safeText = this.pendingBuffer.slice(0, safeLen);
        this.pendingBuffer = this.pendingBuffer.slice(safeLen);
        this.visibleAccumulated += safeText;
        return safeText;
      }
      return "";
    }

    // No prefix match — all pending text is safe
    const safeText = this.pendingBuffer;
    this.pendingBuffer = "";
    this.visibleAccumulated += safeText;
    return safeText;
  }

  /**
   * Finalizes the stream and returns the complete visible text and raw quotes block.
   */
  flush(): { visibleText: string; quotesRaw: string } {
    if (!this.quotesStarted && this.pendingBuffer.length > 0) {
      this.visibleAccumulated += this.pendingBuffer;
      this.pendingBuffer = "";
    }

    return {
      visibleText: this.visibleAccumulated,
      quotesRaw: this.quotesBuffer,
    };
  }

  isQuotesStarted(): boolean {
    return this.quotesStarted;
  }

  getQuotesRaw(): string {
    return this.quotesBuffer;
  }
}

/**
 * Defensively parses the JSON array inside or around <quotes>...</quotes>.
 * Tolerates code fences, trailing text, or missing closing tags.
 */
export function parseQuotesJson(raw: string): RawQuoteItem[] {
  if (!raw || raw.trim().length === 0) {
    return [];
  }

  let text = raw.trim();

  // Strip <quotes> opening and closing tags
  text = text.replace(/<\/?quotes>/gi, "").trim();

  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  text = text.replace(/^```(?:json)?\s*/i, "");
  text = text.replace(/\s*```$/i, "").trim();

  // Locate the first '[' and last ']'
  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");

  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const jsonCandidate = text.slice(firstBracket, lastBracket + 1);
    try {
      const parsed = JSON.parse(jsonCandidate);
      if (Array.isArray(parsed)) {
        return sanitizeQuoteItems(parsed);
      }
    } catch {
      // Fall through to regex extraction
    }
  }

  // Fallback: Regex extraction for individual quote objects
  const items: RawQuoteItem[] = [];
  const objectRegex = /\{[\s\S]*?\}/g;
  let match: RegExpExecArray | null;

  while ((match = objectRegex.exec(text)) !== null) {
    try {
      const obj = JSON.parse(match[0]);
      if (obj && typeof obj.quote === "string") {
        items.push({
          n: typeof obj.n === "number" ? obj.n : items.length + 1,
          doc: obj.doc,
          quote: obj.quote.trim(),
        });
      }
    } catch {
      // Skip malformed object
    }
  }

  return items;
}

/**
 * Validates and normalizes raw parsed quote objects.
 */
function sanitizeQuoteItems(items: any[]): RawQuoteItem[] {
  const result: RawQuoteItem[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item && typeof item.quote === "string" && item.quote.trim().length > 0) {
      result.push({
        n: typeof item.n === "number" ? item.n : i + 1,
        doc: typeof item.doc === "string" ? item.doc : "D1",
        quote: item.quote.trim(),
      });
    }
  }

  return result;
}

/**
 * Verifies all extracted quotes against canonical document text and page ranges.
 * Uses lib/quotes/verify.ts and lib/quotes/pages.ts.
 */
export function verifyExtractedQuotes(
  parsedQuotes: RawQuoteItem[],
  canonicalText: string,
  pages: PageRange[] = []
): VerifiedQuoteItem[] {
  if (parsedQuotes.length === 0) {
    return [];
  }

  return parsedQuotes.map((item) => {
    const vRes = verifyQuote(item.quote, canonicalText);

    if (vRes.status === "verified" && vRes.occurrences.length > 0) {
      const firstOcc = vRes.occurrences[0];
      const pageInfo = getQuotePages(firstOcc, pages);

      return {
        n: item.n,
        doc: item.doc,
        quote: item.quote,
        status: "verified",
        occurrences: vRes.occurrences,
        pageStart: pageInfo.pageStart,
        pageEnd: pageInfo.pageEnd,
        crossesPageBreak: pageInfo.crossesPageBreak,
        ambiguous: vRes.ambiguous,
        matchedText: vRes.matchedText,
      };
    }

    // Unverified quote
    return {
      n: item.n,
      doc: item.doc,
      quote: item.quote,
      status: "unverified",
      occurrences: [],
      reason: vRes.reason || "Not found in document - it may be paraphrased",
    };
  });
}
