import { describe, it, expect } from "vitest";
import { verifyQuote, calculateCoverage } from "../lib/verification/verifier";

describe("Quote Verification Engine (Rule 1 & Rule 2)", () => {
  const sampleDoc = `CONTRACT FOR SERVICES
SECTION 1. INDEMNIFICATION
The Contractor agrees to defend, indemnify, and hold harmless the Client from and against any and all claims, damages, or liabilities arising out of Contractor's negligence.

SECTION 2. TERMINATION
Either party may terminate this Agreement upon thirty (30) days written notice to the other party.`;

  const samplePages = [
    { pageNumber: 1, startOffset: 0, endOffset: 200 },
    { pageNumber: 2, startOffset: 201, endOffset: 360 },
  ];

  it("verifies exact quote string and computes correct offsets and page number", () => {
    const quote = "The Contractor agrees to defend, indemnify, and hold harmless the Client";
    const result = verifyQuote(quote, sampleDoc, samplePages);

    expect(result.verified).toBe(true);
    expect(result.confidence).toBe(1.0);
    expect(result.startOffset).toBe(sampleDoc.indexOf(quote));
    expect(result.pageNumber).toBe(1);
  });

  it("verifies quote with normalized whitespace or smart quotes", () => {
    const quoteWithExtraSpaces =
      "Either  party may   terminate this Agreement upon thirty (30) days written notice";
    const result = verifyQuote(quoteWithExtraSpaces, sampleDoc, samplePages);

    expect(result.verified).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.pageNumber).toBe(2);
  });

  it("marks hallucinated or non-existent quotes as unverified", () => {
    const fakeQuote = "The Client shall pay a penalty of $50,000 for early termination.";
    const result = verifyQuote(fakeQuote, sampleDoc, samplePages);

    expect(result.verified).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.reason).toContain("could not be located");
  });

  it("enforces Rule 2: transparently reports partial coverage and never claims full coverage", () => {
    const coverage = calculateCoverage(
      [0, 1], // analyzed 2 chunks
      10, // total 10 chunks
      [
        { idx: 0, sectionLabel: "SECTION 1. INDEMNIFICATION" },
        { idx: 1, sectionLabel: "SECTION 2. TERMINATION" },
      ]
    );

    expect(coverage.isFullCoverage).toBe(false);
    expect(coverage.coveragePercentage).toBe(20);
    expect(coverage.summaryText).toContain("Based on 20% document coverage");
    expect(coverage.summaryText).toContain("Unanalyzed sections were not inspected");
  });
});
