/**
 * test/multi-doc.test.ts
 *
 * Unit tests for multi-document chat:
 *  1. Per-document quote verification (right doc, wrong doc, missing label, same quote in both docs).
 *  2. Token budget splitting (proportional, minimum guarantee).
 *  3. Label mapping (assignDocLabels, invertLabelMap).
 *  4. Fixture contract verification: two contracts with different liability caps.
 */

import { describe, it, expect } from "vitest";
import { verifyMultiDocQuotes } from "../lib/chat/multiDocVerify";
import { splitTokenBudget, assignDocLabels, invertLabelMap, MAX_MULTI_DOC_COUNT } from "../lib/chat/multiDoc";
import { RawQuoteItem } from "../lib/chat/streamParser";

// ─── Fixture Data ─────────────────────────────────────────────────────────────

// Contract A: $2,000,000 liability cap
const CONTRACT_A_TEXT = `SERVICE AGREEMENT — ACME CORP

SECTION 1. SERVICES
Acme Corp agrees to provide software development services to Client as detailed in Schedule A.

SECTION 2. LIABILITY
The total liability of Acme Corp under this Agreement shall not exceed TWO MILLION DOLLARS ($2,000,000) in the aggregate for any claims arising in connection with this Agreement.

SECTION 3. TERMINATION
Either party may terminate this Agreement upon sixty (60) days written notice to the other party.

SECTION 4. CONFIDENTIALITY
Each party agrees to maintain the confidentiality of the other party's proprietary information.`;

// Contract B: $500,000 liability cap, no termination clause
const CONTRACT_B_TEXT = `CONSULTING AGREEMENT — BETA SOLUTIONS

SECTION 1. SCOPE
Beta Solutions shall provide management consulting services pursuant to this Agreement.

SECTION 2. LIMITATION OF LIABILITY
Beta Solutions' aggregate liability for any damages shall not exceed FIVE HUNDRED THOUSAND DOLLARS ($500,000) under any circumstances.

SECTION 3. INTELLECTUAL PROPERTY
All work product created by Beta Solutions shall be the exclusive property of Client upon full payment.

SECTION 4. GOVERNING LAW
This Agreement shall be governed by the laws of the State of Delaware.`;

const DOC_A_PAGES = [
  { pageNumber: 1, startOffset: 0, endOffset: 200 },
  { pageNumber: 2, startOffset: 201, endOffset: CONTRACT_A_TEXT.length },
];

const DOC_B_PAGES = [
  { pageNumber: 1, startOffset: 0, endOffset: 200 },
  { pageNumber: 2, startOffset: 201, endOffset: CONTRACT_B_TEXT.length },
];

const docTextMap = { D1: CONTRACT_A_TEXT, D2: CONTRACT_B_TEXT };
const docPagesMap = { D1: DOC_A_PAGES, D2: DOC_B_PAGES };

// ─── Tests: Per-Document Verification ─────────────────────────────────────────

describe("Per-Document Quote Verification", () => {
  it("verifies a quote correctly against its claimed document (right doc)", () => {
    const quotes: RawQuoteItem[] = [{
      n: 1,
      doc: "D1",
      quote: "total liability of Acme Corp under this Agreement shall not exceed TWO MILLION DOLLARS",
    }];
    const results = verifyMultiDocQuotes(quotes, docTextMap, docPagesMap);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("verified");
    expect(results[0].doc).toBe("D1");
  });

  it("marks quote unverified when attributed to wrong doc (D2 but text is in D1)", () => {
    const quotes: RawQuoteItem[] = [{
      n: 1,
      doc: "D2",
      quote: "total liability of Acme Corp under this Agreement shall not exceed TWO MILLION DOLLARS",
    }];
    const results = verifyMultiDocQuotes(quotes, docTextMap, docPagesMap);
    expect(results[0].status).toBe("unverified");
    // Reason should hint that it was found in D1 instead
    expect(results[0].reason).toMatch(/attributed to D2 but found in D1/i);
  });

  it("marks quote unverified with 'no valid document label' when doc field is missing", () => {
    const quotes: RawQuoteItem[] = [{
      n: 1,
      doc: undefined,
      quote: "total liability of Acme Corp",
    }];
    const results = verifyMultiDocQuotes(quotes, docTextMap, docPagesMap);
    expect(results[0].status).toBe("unverified");
    expect(results[0].reason).toMatch(/no valid document label/i);
  });

  it("marks quote unverified with 'no valid document label' when doc label is invalid", () => {
    const quotes: RawQuoteItem[] = [{
      n: 1,
      doc: "D99",
      quote: "total liability of Acme Corp",
    }];
    const results = verifyMultiDocQuotes(quotes, docTextMap, docPagesMap);
    expect(results[0].status).toBe("unverified");
    expect(results[0].reason).toMatch(/no valid document label/i);
  });

  it("handles a quote that exists in BOTH documents: verified for correct attribution", () => {
    // The word "Agreement" appears in both — use a phrase unique to D2
    const quoteInD2: RawQuoteItem[] = [{
      n: 1,
      doc: "D2",
      quote: "Beta Solutions shall provide management consulting services pursuant to this Agreement",
    }];
    const resultD2 = verifyMultiDocQuotes(quoteInD2, docTextMap, docPagesMap);
    expect(resultD2[0].status).toBe("verified");
    expect(resultD2[0].doc).toBe("D2");

    // Same quote wrongly attributed to D1 should be unverified
    const quoteWrongDoc: RawQuoteItem[] = [{
      n: 1,
      doc: "D1",
      quote: "Beta Solutions shall provide management consulting services pursuant to this Agreement",
    }];
    const resultWrong = verifyMultiDocQuotes(quoteWrongDoc, docTextMap, docPagesMap);
    expect(resultWrong[0].status).toBe("unverified");
    expect(resultWrong[0].reason).toMatch(/attributed to D1 but found in D2/i);
  });

  it("handles empty quotes array gracefully", () => {
    const results = verifyMultiDocQuotes([], docTextMap, docPagesMap);
    expect(results).toEqual([]);
  });

  it("verifies D2 liability cap quote against D2 only", () => {
    const quotes: RawQuoteItem[] = [{
      n: 2,
      doc: "D2",
      quote: "aggregate liability for any damages shall not exceed FIVE HUNDRED THOUSAND DOLLARS",
    }];
    const results = verifyMultiDocQuotes(quotes, docTextMap, docPagesMap);
    expect(results[0].status).toBe("verified");
    expect(results[0].doc).toBe("D2");
    // Must NOT find in D1
    const resultWrong = verifyMultiDocQuotes([{ ...quotes[0], doc: "D1" }], docTextMap, docPagesMap);
    expect(resultWrong[0].status).toBe("unverified");
  });
});

// ─── Tests: Token Budget Splitting ───────────────────────────────────────────

describe("Token Budget Splitting", () => {
  it("gives each doc at least the minimum tokens", () => {
    const docs = [
      { id: "d1", totalTokens: 500 },
      { id: "d2", totalTokens: 5000 },
    ];
    const budgets = splitTokenBudget(docs, 3800);
    expect(budgets["d1"]).toBeGreaterThan(0);
    expect(budgets["d2"]).toBeGreaterThan(0);
    // d2 is 10x bigger so should get more
    expect(budgets["d2"]).toBeGreaterThan(budgets["d1"]);
  });

  it("total allocated budget does not exceed the total budget", () => {
    const docs = [
      { id: "a", totalTokens: 1000 },
      { id: "b", totalTokens: 2000 },
      { id: "c", totalTokens: 500 },
    ];
    const TOTAL = 3800;
    const budgets = splitTokenBudget(docs, TOTAL);
    const totalAllocated = Object.values(budgets).reduce((s, v) => s + v, 0);
    expect(totalAllocated).toBeLessThanOrEqual(TOTAL);
  });

  it("handles a single document: gets entire budget minus minimum reservation overhead", () => {
    const docs = [{ id: "only", totalTokens: 10000 }];
    const TOTAL = 3800;
    const budgets = splitTokenBudget(docs, TOTAL);
    expect(budgets["only"]).toBeGreaterThan(0);
    expect(budgets["only"]).toBeLessThanOrEqual(TOTAL);
  });

  it("handles up to MAX_MULTI_DOC_COUNT (5) documents", () => {
    const docs = Array.from({ length: MAX_MULTI_DOC_COUNT }, (_, i) => ({ id: `d${i}`, totalTokens: 1000 }));
    const budgets = splitTokenBudget(docs, 3800);
    expect(Object.keys(budgets)).toHaveLength(MAX_MULTI_DOC_COUNT);
    for (const id of docs.map((d) => d.id)) {
      expect(budgets[id]).toBeGreaterThan(0);
    }
  });
});

// ─── Tests: Label Mapping ─────────────────────────────────────────────────────

describe("Label Mapping", () => {
  it("assigns stable D1, D2 labels in insertion order", () => {
    const docs = [{ id: "aaa" }, { id: "bbb" }, { id: "ccc" }];
    const map = assignDocLabels(docs);
    expect(map["aaa"]).toBe("D1");
    expect(map["bbb"]).toBe("D2");
    expect(map["ccc"]).toBe("D3");
  });

  it("invertLabelMap creates reverse mapping label->docId", () => {
    const docs = [{ id: "x" }, { id: "y" }];
    const forward = assignDocLabels(docs);
    const inverse = invertLabelMap(forward);
    expect(inverse["D1"]).toBe("x");
    expect(inverse["D2"]).toBe("y");
  });

  it("handles duplicate document names with different IDs", () => {
    const docs = [{ id: "id1" }, { id: "id2" }];
    const map = assignDocLabels(docs);
    // Both get unique labels
    expect(Object.values(map)).toContain("D1");
    expect(Object.values(map)).toContain("D2");
    expect(map["id1"]).not.toBe(map["id2"]);
  });
});

// ─── Fixture: Two contracts with different liability caps ─────────────────────

describe("Fixture: Two Contracts — Liability Cap Comparison", () => {
  it("D1 quote (2M cap) verifies in D1, fails in D2", () => {
    const q: RawQuoteItem = { n: 1, doc: "D1", quote: "shall not exceed TWO MILLION DOLLARS ($2,000,000) in the aggregate" };
    const [r] = verifyMultiDocQuotes([q], docTextMap, docPagesMap);
    expect(r.status).toBe("verified");
    expect(r.doc).toBe("D1");

    const qWrong: RawQuoteItem = { ...q, doc: "D2" };
    const [rWrong] = verifyMultiDocQuotes([qWrong], docTextMap, docPagesMap);
    expect(rWrong.status).toBe("unverified");
    expect(rWrong.reason).toMatch(/D2/);
  });

  it("D2 quote (500K cap) verifies in D2, fails in D1", () => {
    const q: RawQuoteItem = { n: 2, doc: "D2", quote: "shall not exceed FIVE HUNDRED THOUSAND DOLLARS ($500,000) under any circumstances" };
    const [r] = verifyMultiDocQuotes([q], docTextMap, docPagesMap);
    expect(r.status).toBe("verified");
    expect(r.doc).toBe("D2");

    const qWrong: RawQuoteItem = { ...q, doc: "D1" };
    const [rWrong] = verifyMultiDocQuotes([qWrong], docTextMap, docPagesMap);
    expect(rWrong.status).toBe("unverified");
  });

  it("mix of D1 and D2 quotes: correct cross-attribution detection", () => {
    const quotes: RawQuoteItem[] = [
      { n: 1, doc: "D1", quote: "shall not exceed TWO MILLION DOLLARS ($2,000,000) in the aggregate" },
      { n: 2, doc: "D2", quote: "aggregate liability for any damages shall not exceed FIVE HUNDRED THOUSAND DOLLARS ($500,000)" },
      { n: 3, doc: "D1", quote: "aggregate liability for any damages shall not exceed FIVE HUNDRED THOUSAND DOLLARS ($500,000)" }, // WRONG attribution
    ];
    const results = verifyMultiDocQuotes(quotes, docTextMap, docPagesMap);
    expect(results[0].status).toBe("verified");  // D1 quote in D1: correct
    expect(results[1].status).toBe("verified");  // D2 quote in D2: correct
    expect(results[2].status).toBe("unverified"); // D2 quote attributed to D1: wrong
    expect(results[2].reason).toMatch(/attributed to D1 but found in D2/i);
  });
});
