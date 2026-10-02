import { ExtractedFacts, FactChange } from "./types";

/**
 * Deterministic fact extraction from clause text.
 * Extracts money, percentages, durations, dates, and obligation words.
 */

const MONEY_REGEX =
  /(?:AED|USD|EUR|GBP|INR|SAR|QAR|BHD|KWD|OMR|\$|€|£|₹)\s*[\d,]+(?:\.\d{1,2})?(?:\s*(?:million|billion|thousand|mn|bn|k))?|[\d,]+(?:\.\d{1,2})?\s*(?:AED|USD|EUR|GBP|INR|SAR|QAR|BHD|KWD|OMR)/gi;

const PERCENTAGE_REGEX = /\d+(?:\.\d+)?%/g;

const DURATION_REGEX =
  /\d+\s*(?:calendar\s*)?(?:days?|months?|years?|weeks?|hours?)/gi;

const DATE_REGEX =
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b|\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b|\b\d{4}[\/\-]\d{2}[\/\-]\d{2}\b/gi;

const OBLIGATION_WORDS = ["shall", "must", "may", "shall not", "must not", "will not", "will"];

function extractAll(text: string, regex: RegExp): string[] {
  const results: string[] = [];
  let match: RegExpExecArray | null;
  const r = new RegExp(regex.source, regex.flags);
  while ((match = r.exec(text)) !== null) {
    results.push(match[0].trim());
  }
  return [...new Set(results)];
}

function extractObligations(text: string): string[] {
  const lower = text.toLowerCase();
  return OBLIGATION_WORDS.filter((w) => lower.includes(w));
}

export function extractFacts(text: string): ExtractedFacts {
  return {
    money: extractAll(text, MONEY_REGEX),
    percentages: extractAll(text, PERCENTAGE_REGEX),
    durations: extractAll(text, DURATION_REGEX),
    dates: extractAll(text, DATE_REGEX),
    obligations: extractObligations(text),
  };
}

/**
 * Diff two sets of facts to produce human-readable FactChange[] entries.
 */
export function diffFacts(
  factsA: ExtractedFacts,
  factsB: ExtractedFacts,
  labelA: string,
  labelB: string
): FactChange[] {
  const changes: FactChange[] = [];

  // Money diffs
  if (factsA.money.length > 0 || factsB.money.length > 0) {
    const moneyA = factsA.money.join(", ");
    const moneyB = factsB.money.join(", ");
    if (moneyA !== moneyB) {
      changes.push({
        label: "Amount",
        before: moneyA || "—",
        after: moneyB || "—",
        description: `Amount: ${moneyA || "none"} → ${moneyB || "none"}`,
      });
    }
  }

  // Duration diffs
  if (factsA.durations.length > 0 || factsB.durations.length > 0) {
    const durA = factsA.durations.join(", ");
    const durB = factsB.durations.join(", ");
    if (durA !== durB) {
      changes.push({
        label: "Duration",
        before: durA || "—",
        after: durB || "—",
        description: `Duration: ${durA || "none"} → ${durB || "none"}`,
      });
    }
  }

  // Percentage diffs
  if (factsA.percentages.length > 0 || factsB.percentages.length > 0) {
    const pctA = factsA.percentages.join(", ");
    const pctB = factsB.percentages.join(", ");
    if (pctA !== pctB) {
      changes.push({
        label: "Percentage",
        before: pctA || "—",
        after: pctB || "—",
        description: `Percentage: ${pctA || "none"} → ${pctB || "none"}`,
      });
    }
  }

  // Date diffs
  if (factsA.dates.length > 0 || factsB.dates.length > 0) {
    const dateA = factsA.dates.join(", ");
    const dateB = factsB.dates.join(", ");
    if (dateA !== dateB) {
      changes.push({
        label: "Date",
        before: dateA || "—",
        after: dateB || "—",
        description: `Date: ${dateA || "none"} → ${dateB || "none"}`,
      });
    }
  }

  // Obligation diffs
  const addedObligations = factsB.obligations.filter((o) => !factsA.obligations.includes(o));
  const removedObligations = factsA.obligations.filter((o) => !factsB.obligations.includes(o));
  if (addedObligations.length > 0 || removedObligations.length > 0) {
    const desc: string[] = [];
    if (removedObligations.length > 0)
      desc.push(`Removed: "${removedObligations.join('", "')}"`);
    if (addedObligations.length > 0)
      desc.push(`Added: "${addedObligations.join('", "')}"`);
    changes.push({
      label: "Obligation",
      before: factsA.obligations.join(", ") || "—",
      after: factsB.obligations.join(", ") || "—",
      description: `Obligation shift — ${desc.join("; ")}`,
    });
  }

  return changes;
}

/**
 * HIGH-RISK keywords for forced significance escalation.
 */
export const FORCED_HIGH_KEYWORDS = [
  "liability",
  "indemnif",
  "indemnit",
  "penalty",
  "penalt",
  "termination",
  "terminat",
  "payment",
  "compensation",
  "liquidated damages",
  "governing law",
  "dispute",
  "arbitration",
];

/**
 * Check if clause text contains high-risk terms.
 */
export function isHighRiskClause(text: string): boolean {
  const lower = text.toLowerCase();
  return FORCED_HIGH_KEYWORDS.some((kw) => lower.includes(kw));
}
