/**
 * lib/quotes/verify.ts
 *
 * Core Zero-Hallucination Quote Verification.
 *
 * Invariant Rule 1:
 *  - Accepts NO positions or line numbers from the AI.
 *  - Locates the quote in docText itself.
 *  - Strips surrounding quotes.
 *  - Pass 1: normalized substring search for ALL occurrences, mapped back to original offsets.
 *  - Pass 2: whitespace-removed search for split/concatenated words, mapped back to original offsets.
 *  - Ellipsis support: splits quote on "..." or "…", verifies segments appear in order within 1500 chars.
 *  - Length checks: quotes < 4 words or < 20 normalized chars are unverified with "too short to verify"
 *    unless they are a defined term occurring exactly once.
 *  - Quotes found > 1 time get ambiguous: true and verified.
 *  - Zero fuzzy matching: near matches return unverified with "not found in document (possibly paraphrased)".
 */

import { normalizeWithMap, NormalizedResult } from "./normalize";

export interface Occurrence {
  start: number;
  end: number;
}

export interface VerifyQuoteResult {
  status: "verified" | "unverified";
  reason?: string;
  occurrences: Occurrence[];
  ambiguous?: boolean;
  closestPassage?: string;
  matchedText?: string;
}

const ELLIPSIS_SPLIT_REGEX = /\s*(?:\.{3,}|…)\s*/;
const BOUNDED_WINDOW_CHARS = 1500;

/**
 * Strip surrounding quotation marks the model or user may wrap the quote in.
 */
export function stripSurroundingQuotes(raw: string): string {
  let s = raw.trim();
  let changed = true;

  while (changed && s.length >= 2) {
    changed = false;
    const first = s[0];
    const last = s[s.length - 1];

    if (
      (first === '"' && last === '"') ||
      (first === "'" && last === "'") ||
      (first === "“" && last === "”") ||
      (first === "‘" && last === "’") ||
      (first === "«" && last === "»") ||
      (first === "`" && last === "`")
    ) {
      s = s.slice(1, -1).trim();
      changed = true;
    }
  }

  return s;
}

/**
 * Checks whether a short text appears to be a defined legal term
 * (e.g. Title Cased or Capitalized phrase like "Confidential Information" or "Effective Date").
 */
function isPotentialDefinedTerm(rawText: string): boolean {
  const trimmed = rawText.trim();
  if (trimmed.length < 3) return false;

  // Words should start with uppercase, e.g. "Effective Date", "Vendor", "Gross Negligence"
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  const allCapitalized = words.every((w) => /^[A-Z][A-Za-z0-9\-_.]*$/.test(w));
  return allCapitalized;
}

/**
 * Helper to compute character length in original string
 * (handles surrogate pairs).
 */
function getCharLen(str: string, index: number): number {
  if (index < 0 || index >= str.length) return 1;
  const code = str.charCodeAt(index);
  if (code >= 0xd800 && code <= 0xdbff && index + 1 < str.length) {
    return 2;
  }
  return 1;
}

/**
 * Pass 1: Substring search in normalized document text.
 */
function searchPass1(
  quoteNorm: string,
  docNormRes: NormalizedResult,
  docText: string
): Occurrence[] {
  if (!quoteNorm || !docNormRes.norm) return [];

  const occurrences: Occurrence[] = [];
  let pos = 0;

  while ((pos = docNormRes.norm.indexOf(quoteNorm, pos)) !== -1) {
    const start = docNormRes.map[pos];
    const lastNormIdx = pos + quoteNorm.length - 1;
    const lastOrigIdx = docNormRes.map[lastNormIdx];
    const charLen = getCharLen(docText, lastOrigIdx);
    const end = lastOrigIdx + charLen;

    occurrences.push({ start, end });
    pos += 1;
  }

  return occurrences;
}

/**
 * Pass 2: Whitespace-removed search for split/concatenated words.
 * Requires exact letter-for-letter match of all non-whitespace characters.
 */
function searchPass2(
  quoteNorm: string,
  docNormRes: NormalizedResult,
  docText: string
): Occurrence[] {
  const quoteNoWs = quoteNorm.replace(/\s+/g, "");
  if (!quoteNoWs) return [];

  // Build whitespace-removed doc with index map
  const docNoWsChars: string[] = [];
  const docNoWsMap: number[] = [];

  for (let i = 0; i < docNormRes.norm.length; i++) {
    const c = docNormRes.norm[i];
    if (c !== " ") {
      docNoWsChars.push(c);
      docNoWsMap.push(docNormRes.map[i]);
    }
  }

  const docNoWs = docNoWsChars.join("");
  const occurrences: Occurrence[] = [];
  let pos = 0;

  while ((pos = docNoWs.indexOf(quoteNoWs, pos)) !== -1) {
    const start = docNoWsMap[pos];
    const lastNoWsIdx = pos + quoteNoWs.length - 1;
    const lastOrigIdx = docNoWsMap[lastNoWsIdx];
    const charLen = getCharLen(docText, lastOrigIdx);
    const end = lastOrigIdx + charLen;

    occurrences.push({ start, end });
    pos += 1;
  }

  return occurrences;
}

/**
 * Searches for ordered ellipsis segments within a bounded window.
 */
function verifyEllipsisQuote(
  rawSegments: string[],
  docNormRes: NormalizedResult,
  docText: string
): { verified: boolean; occurrences: Occurrence[]; reason?: string } {
  // Normalize each segment
  const segResults = rawSegments.map((seg) => {
    const stripped = stripSurroundingQuotes(seg);
    const normRes = normalizeWithMap(stripped);
    return {
      raw: stripped,
      norm: normRes.norm,
    };
  });

  // Verify every segment exists
  const segOccurrences: Occurrence[][] = [];
  for (const s of segResults) {
    if (!s.norm) continue;
    let occs = searchPass1(s.norm, docNormRes, docText);
    if (occs.length === 0) {
      occs = searchPass2(s.norm, docNormRes, docText);
    }
    if (occs.length === 0) {
      return {
        verified: false,
        occurrences: [],
        reason: "not found in document (possibly paraphrased)",
      };
    }
    segOccurrences.push(occs);
  }

  if (segOccurrences.length < 2) {
    return {
      verified: false,
      occurrences: [],
      reason: "not found in document (possibly paraphrased)",
    };
  }

  // Find occurrences where all segments appear in strict sequential order within bounded window
  const validChains: Occurrence[] = [];

  function findChain(
    segIdx: number,
    prevEnd: number,
    chainStart: number
  ): void {
    if (segIdx === segOccurrences.length) {
      validChains.push({ start: chainStart, end: prevEnd });
      return;
    }

    for (const occ of segOccurrences[segIdx]) {
      // Must appear after previous segment
      if (occ.start >= prevEnd) {
        // Must stay within bounded window from chain start
        if (occ.end - chainStart <= BOUNDED_WINDOW_CHARS) {
          findChain(segIdx + 1, occ.end, chainStart);
        }
      }
    }
  }

  for (const firstOcc of segOccurrences[0]) {
    findChain(1, firstOcc.end, firstOcc.start);
  }

  if (validChains.length === 0) {
    return {
      verified: false,
      occurrences: [],
      reason: "not found in document (possibly paraphrased)",
    };
  }

  return {
    verified: true,
    occurrences: validChains,
  };
}

/**
 * Finds a closest approximate passage for debugging ONLY.
 * Never returned as verified.
 */
function findClosestPassageForDebugging(
  quote: string,
  docText: string
): string | undefined {
  if (!quote || !docText) return undefined;

  const quoteWords = quote
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  if (quoteWords.length === 0) return undefined;

  // Split doc into candidate passages (~200 chars overlapping)
  const step = 100;
  const size = 250;
  let bestScore = 0;
  let bestPassage = "";

  for (let i = 0; i < docText.length; i += step) {
    const candidate = docText.slice(i, i + size);
    const candidateLower = candidate.toLowerCase();

    let score = 0;
    for (const word of quoteWords) {
      if (candidateLower.includes(word)) {
        score++;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestPassage = candidate.trim().replace(/\s+/g, " ");
    }
  }

  return bestScore >= Math.min(2, quoteWords.length)
    ? bestPassage.slice(0, 150)
    : undefined;
}

/**
 * Verifies a quote against the canonical document text.
 */
export function verifyQuote(
  rawQuote: string,
  docText: string
): VerifyQuoteResult {
  if (!rawQuote || !docText) {
    return {
      status: "unverified",
      reason: "Quote or document text is empty",
      occurrences: [],
    };
  }

  // 1. Strip surrounding quotation marks
  const cleanedQuote = stripSurroundingQuotes(rawQuote);
  if (!cleanedQuote) {
    return {
      status: "unverified",
      reason: "Quote is empty after stripping quotation marks",
      occurrences: [],
    };
  }

  // Normalize document once
  const docNormRes = normalizeWithMap(docText);

  // 2. Check for ellipsis quote ("..." or "…")
  if (ELLIPSIS_SPLIT_REGEX.test(cleanedQuote)) {
    const segments = cleanedQuote
      .split(ELLIPSIS_SPLIT_REGEX)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (segments.length > 1) {
      const ellipsisRes = verifyEllipsisQuote(segments, docNormRes, docText);
      if (!ellipsisRes.verified) {
        return {
          status: "unverified",
          reason: ellipsisRes.reason || "not found in document (possibly paraphrased)",
          occurrences: [],
          closestPassage: findClosestPassageForDebugging(cleanedQuote, docText),
        };
      }

      return {
        status: "verified",
        occurrences: ellipsisRes.occurrences,
        ambiguous: ellipsisRes.occurrences.length > 1,
        matchedText: docText.slice(
          ellipsisRes.occurrences[0].start,
          ellipsisRes.occurrences[0].end
        ),
      };
    }
  }

  // 3. Normalize quote
  const quoteNormRes = normalizeWithMap(cleanedQuote);
  const normQuote = quoteNormRes.norm;

  if (!normQuote) {
    return {
      status: "unverified",
      reason: "Quote has no non-whitespace characters",
      occurrences: [],
    };
  }

  // 4. Pass 1: normalized substring search
  let occurrences = searchPass1(normQuote, docNormRes, docText);

  // 5. Pass 2: whitespace-removed search (if pass 1 found nothing)
  if (occurrences.length === 0) {
    occurrences = searchPass2(normQuote, docNormRes, docText);
  }

  // 6. If no occurrences found
  if (occurrences.length === 0) {
    return {
      status: "unverified",
      reason: "not found in document (possibly paraphrased)",
      occurrences: [],
      closestPassage: findClosestPassageForDebugging(cleanedQuote, docText),
    };
  }

  // 7. Length check: shorter than 4 words or 20 normalized chars
  const words = normQuote.split(" ").filter(Boolean);
  const isShort = words.length < 4 || normQuote.length < 20;

  if (isShort) {
    const isDefTerm = isPotentialDefinedTerm(cleanedQuote);
    // Defined terms are permitted ONLY if they occur exactly once
    if (!isDefTerm || occurrences.length !== 1) {
      return {
        status: "unverified",
        reason: "too short to verify",
        occurrences,
      };
    }
  }

  // 8. Verified result
  const isAmbiguous = occurrences.length > 1;
  const firstOcc = occurrences[0];
  const matchedText = docText.slice(firstOcc.start, firstOcc.end);

  return {
    status: "verified",
    occurrences,
    ambiguous: isAmbiguous,
    matchedText,
  };
}
