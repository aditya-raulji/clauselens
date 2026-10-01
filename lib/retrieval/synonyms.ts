/**
 * lib/retrieval/synonyms.ts
 *
 * Deterministic legal synonym map and cheap query expansion.
 * Requires ZERO extra LLM calls and operates in O(words) time.
 */

export const LEGAL_SYNONYMS: Record<string, string[]> = {
  termination: [
    "terminate",
    "expiry",
    "expiration",
    "cancel",
    "cancellation",
    "notice period",
    "for convenience",
    "for cause",
    "early termination",
  ],
  terminate: ["termination", "expiry", "cancel", "notice period", "expiration"],
  indemnity: [
    "indemnify",
    "indemnification",
    "hold harmless",
    "defense",
    "defend",
    "damages",
    "losses",
    "liabilities",
  ],
  indemnify: [
    "indemnity",
    "indemnification",
    "hold harmless",
    "defend",
    "third party claims",
  ],
  "non-compete": [
    "noncompete",
    "restrictive covenant",
    "restraint of trade",
    "non-competition",
    "competition",
    "solicitation",
    "non-solicit",
  ],
  noncompete: [
    "non-compete",
    "restrictive covenant",
    "restraint of trade",
    "non-competition",
    "solicitation",
  ],
  confidentiality: [
    "non-disclosure",
    "nda",
    "proprietary information",
    "trade secret",
    "confidential information",
  ],
  confidential: [
    "confidentiality",
    "non-disclosure",
    "nda",
    "proprietary",
    "trade secret",
  ],
  "force majeure": [
    "act of god",
    "unforeseeable",
    "beyond reasonable control",
    "delay",
    "frustration",
    "epidemic",
    "disaster",
  ],
  "governing law": [
    "jurisdiction",
    "applicable law",
    "venue",
    "choice of law",
    "courts of",
    "governed by",
  ],
  assignment: [
    "assign",
    "transfer",
    "subcontract",
    "delegation",
    "change of control",
    "successor",
  ],
  liability: [
    "limitation of liability",
    "consequential damages",
    "indirect damages",
    "cap",
    "aggregate liability",
    "sole remedy",
    "disclaimer",
  ],
  payment: [
    "fees",
    "invoice",
    "invoicing",
    "remit",
    "remittance",
    "net 30",
    "due date",
    "billing",
    "charges",
    "interest",
  ],
  warranty: [
    "warranties",
    "representation",
    "representations",
    "as is",
    "disclaimer",
    "merchantability",
    "fitness",
  ],
  arbitration: [
    "dispute resolution",
    "arbitrator",
    "mediation",
    "adr",
    "binding arbitration",
    "jams",
    "aaa",
  ],
  severability: [
    "severable",
    "invalidity",
    "unenforceability",
    "partial invalidity",
  ],
  amendment: [
    "modify",
    "modification",
    "addendum",
    "waiver",
    "written consent",
  ],
  audit: [
    "inspection",
    "books and records",
    "examine",
    "audit rights",
    "accounting records",
  ],
  insurance: [
    "coverage",
    "policy",
    "commercial general liability",
    "workers compensation",
    "additional insured",
  ],
  ip: [
    "intellectual property",
    "patent",
    "copyright",
    "trademark",
    "work made for hire",
    "proprietary rights",
  ],
  "intellectual property": [
    "patent",
    "copyright",
    "trademark",
    "work made for hire",
    "proprietary rights",
    "ip",
  ],
};

/**
 * Expands a legal query by appending deterministic synonyms
 * for any matched legal concepts in the user's question.
 */
export function expandLegalQuery(query: string): string {
  if (!query) return "";

  const lowerQuery = query.toLowerCase();
  const addedTerms = new Set<string>();

  for (const [key, synonyms] of Object.entries(LEGAL_SYNONYMS)) {
    // Check if query contains word or hyphenated phrase
    const keyRegex = new RegExp(`\\b${key.replace("-", "[- ]")}\\b`, "i");
    if (keyRegex.test(lowerQuery)) {
      for (const syn of synonyms) {
        if (!lowerQuery.includes(syn.toLowerCase())) {
          addedTerms.add(syn);
        }
      }
    }
  }

  if (addedTerms.size === 0) {
    return query;
  }

  // Append up to 6 most relevant synonyms to avoid query dilution
  const termsList = Array.from(addedTerms).slice(0, 6);
  return `${query} ${termsList.join(" ")}`;
}
