/**
 * lib/chat/multiDocVerify.ts
 *
 * Per-document quote verification for multi-document chat.
 *
 * Invariant Rules:
 *  - Each quote is verified ONLY against the canonical text of the document
 *    named in its "doc" field (e.g. "D1", "D2").
 *  - If "doc" is missing or not a valid label: unverified with reason "no valid document label".
 *  - If a quote fails in its claimed document but IS found in another selected document:
 *    unverified with reason "attributed to D1 but found in D2" (never presented as verified for D1).
 *  - Only if verification against the correct document succeeds: status = "verified".
 */

import { verifyQuote } from "@/lib/quotes/verify";
import { getQuotePages, PageRange } from "@/lib/quotes/pages";
import { VerifiedQuoteItem, RawQuoteItem } from "@/lib/chat/streamParser";

export interface DocTextMap {
  /** label (e.g. "D1") -> canonical text */
  [label: string]: string;
}

export interface DocPagesMap {
  /** label (e.g. "D1") -> page ranges */
  [label: string]: PageRange[];
}

/**
 * Verifies an array of raw quote items against per-document canonical texts.
 *
 * @param parsedQuotes - Raw quotes extracted from AI response; each has an optional "doc" label.
 * @param docTextMap   - Map from label to canonical text (only the selected labels).
 * @param docPagesMap  - Map from label to page ranges for that document.
 * @returns Array of VerifiedQuoteItem with per-doc accurate status.
 */
export function verifyMultiDocQuotes(
  parsedQuotes: RawQuoteItem[],
  docTextMap: DocTextMap,
  docPagesMap: DocPagesMap
): VerifiedQuoteItem[] {
  if (parsedQuotes.length === 0) return [];

  const validLabels = new Set(Object.keys(docTextMap));

  return parsedQuotes.map((item) => {
    const claimedLabel = item.doc?.trim().toUpperCase();

    // Rule: missing or invalid doc label
    if (!claimedLabel || !validLabels.has(claimedLabel)) {
      return {
        n: item.n,
        doc: item.doc,
        quote: item.quote,
        status: "unverified" as const,
        occurrences: [],
        reason: "no valid document label",
      };
    }

    // Verify against the claimed document
    const claimedText = docTextMap[claimedLabel];
    const claimedPages = docPagesMap[claimedLabel] ?? [];
    const vRes = verifyQuote(item.quote, claimedText);

    if (vRes.status === "verified" && vRes.occurrences.length > 0) {
      const firstOcc = vRes.occurrences[0];
      const pageInfo = getQuotePages(firstOcc, claimedPages);

      return {
        n: item.n,
        doc: claimedLabel,
        quote: item.quote,
        status: "verified" as const,
        occurrences: vRes.occurrences,
        pageStart: pageInfo.pageStart,
        pageEnd: pageInfo.pageEnd,
        crossesPageBreak: pageInfo.crossesPageBreak,
        ambiguous: vRes.ambiguous,
        matchedText: vRes.matchedText,
      };
    }

    // Failed in claimed doc — check if it exists in any OTHER selected document
    let foundInOtherLabel: string | undefined;
    for (const [otherLabel, otherText] of Object.entries(docTextMap)) {
      if (otherLabel === claimedLabel) continue;
      const crossRes = verifyQuote(item.quote, otherText);
      if (crossRes.status === "verified" && crossRes.occurrences.length > 0) {
        foundInOtherLabel = otherLabel;
        break;
      }
    }

    const reason = foundInOtherLabel
      ? `attributed to ${claimedLabel} but found in ${foundInOtherLabel}`
      : vRes.reason || "not found in document (possibly paraphrased)";

    return {
      n: item.n,
      doc: claimedLabel,
      quote: item.quote,
      status: "unverified" as const,
      occurrences: [],
      reason,
    };
  });
}
