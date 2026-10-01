import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(true),
        returning: vi.fn().mockResolvedValue([{ id: "mock-id" }]),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/env", () => ({
  env: {
    AI_API_KEY: "mock_api_key",
    AI_BASE_URL: "https://api.groq.com/openai/v1",
    AI_MODEL: "llama-3.3-70b-versatile",
    AI_FALLBACK_MODELS: "llama-3.1-8b-instant,mixtral-8x7b-32768",
    DATABASE_URL: "postgres://mock:mock@localhost:5432/mock",
    fallbackModels: ["llama-3.1-8b-instant", "mixtral-8x7b-32768"],
  },
}));

import * as fs from "fs";
import * as path from "path";
import {
  formatPageRanges,
  hasAbsencePhrasing,
  guardApproved,
  CoverageObject,
} from "@/lib/coverage";
import { expandLegalQuery } from "@/lib/retrieval/synonyms";
import {
  isExistenceOrAbsenceQuestion,
  estimateScan,
  partitionChunksForScan,
  runDeepScan,
} from "@/lib/chat/deepScan";
import { DocumentChunkData, chunkCanonicalText } from "@/lib/chunk/chunk";
import { verifyQuote } from "@/lib/quotes/verify";
import { getQuotePages } from "@/lib/quotes/pages";
import { extractPdf } from "@/lib/extraction/pdf";
import { generate150PageContractBuffer } from "../scripts/make-large-fixture";

describe("Coverage & Absence Guard", () => {
  const completeCoverage: CoverageObject = {
    mode: "full",
    totalPages: 150,
    pagesRead: Array.from({ length: 150 }, (_, i) => i + 1),
    chunksRead: 400,
    totalChunks: 400,
    complete: true,
    pageRanges: "1–150",
  };

  const partialCoverage: CoverageObject = {
    mode: "retrieval",
    totalPages: 150,
    pagesRead: [1, 2, 3, 4, 12, 13],
    chunksRead: 8,
    totalChunks: 400,
    complete: false,
    pageRanges: "1–4, 12–13",
  };

  it("formatPageRanges formats individual pages and contiguous spans cleanly", () => {
    expect(formatPageRanges([1, 2, 3, 5, 7, 8, 9, 120])).toBe(
      "1–3, 5, 7–9, 120"
    );
    expect(formatPageRanges([42])).toBe("42");
    expect(formatPageRanges([])).toBe("none");
  });

  it("hasAbsencePhrasing correctly identifies various absence statements", () => {
    expect(
      hasAbsencePhrasing("The document does not contain a non-compete clause.")
    ).toBe(true);
    expect(hasAbsencePhrasing("There is no provision regarding penalties.")).toBe(
      true
    );
    expect(hasAbsencePhrasing("No clause was found regarding indemnity.")).toBe(
      true
    );
    expect(
      hasAbsencePhrasing("Payment must be remitted within 30 days.")
    ).toBe(false);
  });

  it("guardApproved allows absence statements when coverage is 100% complete", () => {
    const rawAnswer =
      "The document does not contain any non-compete clause across all sections.";
    const result = guardApproved(rawAnswer, completeCoverage);

    expect(result.wasGuarded).toBe(false);
    expect(result.text).toBe(rawAnswer);
  });

  it("guardApproved intercepts absence statements on incomplete coverage and prepends mandatory disclosure", () => {
    const rawAnswer =
      "The contract does not contain any non-compete or restrictive covenants.";
    const result = guardApproved(rawAnswer, partialCoverage);

    expect(result.wasGuarded).toBe(true);
    expect(result.text).toContain(
      "⚠️ Note: I only read pages 1–4, 12–13 (6 of 150 pages in this contract)"
    );
    expect(result.text).toContain(
      "I cannot confirm this is absent from the rest of the document. Run a full scan to verify across all pages."
    );
    expect(result.text).toContain(rawAnswer);
  });

  it("guardApproved allows non-absence answers on incomplete coverage without modification", () => {
    const rawAnswer =
      "Section 2 specifies that invoices must be paid within thirty days [1].";
    const result = guardApproved(rawAnswer, partialCoverage);

    expect(result.wasGuarded).toBe(false);
    expect(result.text).toBe(rawAnswer);
  });
});

describe("Legal Synonym Query Expansion", () => {
  it("expands 'termination' with synonyms without an extra LLM call", () => {
    const expanded = expandLegalQuery("What are the termination requirements?");
    expect(expanded).toContain("terminate");
    expect(expanded).toContain("notice period");
  });

  it("expands 'non-compete' with 'restrictive covenant' and 'non-competition'", () => {
    const expanded = expandLegalQuery("Does it have a non-compete clause?");
    expect(expanded).toContain("restrictive covenant");
    expect(expanded).toContain("non-competition");
  });

  it("leaves queries without legal triggers untouched", () => {
    const query = "What is the company name?";
    expect(expandLegalQuery(query)).toBe(query);
  });
});

describe("Existence / Absence Classifier", () => {
  it("detects existence questions and extracts topics", () => {
    const r1 = isExistenceOrAbsenceQuestion("Does it contain a non-compete?");
    expect(r1.isExistence).toBe(true);
    expect(r1.topic.toLowerCase()).toContain("non-compete");

    const r2 = isExistenceOrAbsenceQuestion("Is there an indemnity clause?");
    expect(r2.isExistence).toBe(true);
    expect(r2.topic.toLowerCase()).toContain("indemnity");

    const r3 = isExistenceOrAbsenceQuestion("Any force majeure provision?");
    expect(r3.isExistence).toBe(true);
    expect(r3.topic.toLowerCase()).toContain("force majeure");
  });

  it("rejects non-existence questions", () => {
    expect(isExistenceOrAbsenceQuestion("Who signed the contract?").isExistence).toBe(
      false
    );
    expect(
      isExistenceOrAbsenceQuestion("Summarize the payment obligations").isExistence
    ).toBe(false);
  });
});

describe("Deep Scan Batching & Pre-Scan Estimation", () => {
  it("estimateScan calculates batches and estimated minutes based on 8K TPM limits", () => {
    const syntheticChunks: DocumentChunkData[] = Array.from(
      { length: 50 },
      (_, i) => ({
        idx: i,
        startOffset: i * 800,
        endOffset: (i + 1) * 800,
        pageStart: Math.floor(i * 3) + 1,
        pageEnd: Math.floor((i + 1) * 3),
        sectionLabel: `Section ${i + 1}`,
        text: "Sample clause text with legal terms for contract analysis. ".repeat(
          12
        ),
      })
    );

    const est = estimateScan(syntheticChunks, 150);
    expect(est.totalPages).toBe(150);
    expect(est.totalChunks).toBe(50);
    expect(est.batchCount).toBeGreaterThan(1);
    expect(est.estimatedMinutes).toBeGreaterThan(0);
    expect(est.summaryText).toContain("About 150 pages");
  });

  it("partitionChunksForScan partitions chunks into batches <= 3,500 tokens", () => {
    const chunks: DocumentChunkData[] = Array.from({ length: 20 }, (_, i) => ({
      idx: i,
      startOffset: i * 1500,
      endOffset: (i + 1) * 1500,
      pageStart: i * 5 + 1,
      pageEnd: (i + 1) * 5,
      sectionLabel: `Section ${i + 1}`,
      text: "Text representing chunk content. ".repeat(40),
    }));

    const batches = partitionChunksForScan(chunks, 3500);
    expect(batches.length).toBeGreaterThan(1);

    for (const b of batches) {
      expect(b.chunks.length).toBeGreaterThan(0);
      expect(b.pageStart).toBeLessThanOrEqual(b.pageEnd);
    }
  });

  it("runDeepScan handles user abort mid-scan and records explicit partial coverage", async () => {
    const abortController = new AbortController();

    const chunks: DocumentChunkData[] = Array.from({ length: 10 }, (_, i) => ({
      idx: i,
      startOffset: i * 500,
      endOffset: (i + 1) * 500,
      pageStart: i + 1,
      pageEnd: i + 1,
      sectionLabel: `Section ${i + 1}`,
      text: "Normal text clause without target terms.",
    }));

    let progressCount = 0;

    // Trigger abort on first progress event
    const scanPromise = runDeepScan({
      topic: "non-compete",
      documentName: "Test Agreement",
      canonicalText: "Complete text",
      docPages: [],
      chunks,
      signal: abortController.signal,
      onProgress: () => {
        progressCount++;
        abortController.abort();
      },
    });

    const result = await scanPromise;
    expect(result.status).toBe("stopped");
    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.mode).toBe("scan");
    expect(result.answer).toContain("Scan paused/stopped");
  });
});

describe("150-Page Contract Fixture Verification", () => {
  it("generates and verifies 150-page contract with Page 120 termination clause and zero non-compete", async () => {
    // 1. Generate buffer
    const buffer = generate150PageContractBuffer();
    expect(buffer.length).toBeGreaterThan(50000);

    // 2. Extract with pdfjs-dist
    const extracted = await extractPdf(buffer);
    expect(extracted.pageCount).toBe(150);
    expect(extracted.pages).toHaveLength(150);

    const canonicalText = extracted.canonicalText;

    // 3. Verify Page 120 contains Termination for Convenience
    const page120 = extracted.pages.find((p) => p.pageNumber === 120);
    expect(page120).toBeDefined();

    const page120Text = canonicalText.slice(
      page120!.startOffset,
      page120!.endOffset
    );
    expect(page120Text).toContain("Termination for Convenience");
    expect(page120Text).toContain("90 calendar days prior written notice");

    // 4. Verify quote verification finds and verifies Page 120 clause
    const terminationQuote =
      "Either party may terminate this Agreement for convenience by providing at least 90 calendar days prior written notice to the other party.";
    const verifyRes = verifyQuote(terminationQuote, canonicalText);

    expect(verifyRes.status).toBe("verified");
    expect(verifyRes.occurrences.length).toBeGreaterThan(0);

    const pageRes = getQuotePages(verifyRes.occurrences[0], extracted.pages);
    expect(pageRes.pageStart).toBe(120);
    expect(pageRes.pageEnd).toBe(120);

    // 5. Verify non-compete is absent across all 150 pages
    expect(canonicalText.toLowerCase()).not.toContain("non-compete");
    expect(canonicalText.toLowerCase()).not.toContain("noncompete");
    expect(canonicalText.toLowerCase()).not.toContain("restrictive covenant");
  });
});
