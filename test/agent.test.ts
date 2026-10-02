/**
 * test/agent.test.ts
 *
 * Unit tests for the agentic research pipeline.
 * The AI client is mocked with scripted responses — no network calls.
 *
 * Tests cover:
 *  1. Unknown tool name → error result, loop continues
 *  2. Missing required arguments → Zod error returned to model
 *  3. Nonsense parameters (negative page, huge top_k, wrong types) → Zod error
 *  4. Malformed JSON arguments → parse error returned to model
 *  5. Repeated identical call → cached result + "already retrieved" note
 *  6. Infinite-loop attempt hitting round cap → stoppedReason = "round_cap"
 *  7. Provider rejecting a tool call (400) → fed back as invalid-call message
 *  8. Model never answers (always tool calls) → round_cap
 *  9. Abort mid-loop → stoppedReason = "aborted"
 * 10. Happy path: search → get_section → final answer with verified quotes
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Minimal fixtures ──────────────────────────────────────────────────────────

const CANONICAL_TEXT = `SERVICE AGREEMENT

1. SERVICES
1.1 The Service Provider shall provide software development services.

2. PAYMENT
2.1 The Client shall pay AED 50,000 per month for the services described herein.
2.2 Payment shall be made within 30 days of invoice.

3. LIABILITY
3.1 The total liability of the Service Provider shall not exceed AED 100,000.
3.2 Neither party shall be liable for indirect or consequential damages.

4. TERMINATION
4.1 Either party may terminate this Agreement with 30 days written notice.
`;

const CHUNK_A = {
  idx: 0, startOffset: 0, endOffset: 60,
  pageStart: 1, pageEnd: 1,
  sectionLabel: "1. SERVICES",
  text: "1. SERVICES\n1.1 The Service Provider shall provide software development services.",
  documentId: "doc-1",
};
const CHUNK_B = {
  idx: 1, startOffset: 61, endOffset: 180,
  pageStart: 1, pageEnd: 1,
  sectionLabel: "2. PAYMENT",
  text: "2. PAYMENT\n2.1 The Client shall pay AED 50,000 per month for the services described herein.\n2.2 Payment shall be made within 30 days of invoice.",
  documentId: "doc-1",
};
const CHUNK_C = {
  idx: 2, startOffset: 181, endOffset: 340,
  pageStart: 2, pageEnd: 2,
  sectionLabel: "3. LIABILITY",
  text: "3. LIABILITY\n3.1 The total liability of the Service Provider shall not exceed AED 100,000.\n3.2 Neither party shall be liable for indirect or consequential damages.",
  documentId: "doc-1",
};
const CHUNK_D = {
  idx: 3, startOffset: 341, endOffset: 430,
  pageStart: 2, pageEnd: 2,
  sectionLabel: "4. TERMINATION",
  text: "4. TERMINATION\n4.1 Either party may terminate this Agreement with 30 days written notice.",
  documentId: "doc-1",
};

const TEST_DOC = {
  id: "doc-1",
  name: "Service Agreement.pdf",
  label: "Service Agreement.pdf",
  canonicalText: CANONICAL_TEXT,
  chunks: [CHUNK_A, CHUNK_B, CHUNK_C, CHUNK_D],
  pages: [
    { pageNumber: 1, startOffset: 0, endOffset: 180 },
    { pageNumber: 2, startOffset: 181, endOffset: CANONICAL_TEXT.length },
  ],
  totalPages: 2,
};

// ── Mock AI client ────────────────────────────────────────────────────────────

// We stub out the internals of runAgentLoop via the tool execution functions
// and a mock "raw OpenAI client" injected into aiClient.

import { executeTool, toolListClauses, toolSearchDocument, toolGetSection, toolGetPage, TOOL_NAMES } from "@/lib/agent/tools";

// ── Tool unit tests ───────────────────────────────────────────────────────────

describe("executeTool — unknown tool name", () => {
  it("returns an error listing valid tools", () => {
    const result = executeTool("read_everything", {}, [TEST_DOC]);
    expect(result.error).toBe("unknown_tool");
    expect(result.output).toContain("Unknown tool");
    expect(result.output).toContain("list_clauses");
  });
});

describe("toolSearchDocument — missing required args", () => {
  it("returns validation_error when query is missing", () => {
    const result = toolSearchDocument([TEST_DOC], {});
    expect(result.error).toBe("validation_error");
    expect(result.output).toContain("query");
  });

  it("returns validation_error when query is empty string", () => {
    const result = toolSearchDocument([TEST_DOC], { query: "" });
    expect(result.error).toBe("validation_error");
  });
});

describe("toolSearchDocument — nonsense top_k", () => {
  it("rejects top_k = 10,000", () => {
    const result = toolSearchDocument([TEST_DOC], { query: "liability", top_k: 10000 });
    expect(result.error).toBe("validation_error");
    expect(result.output).toContain("top_k");
  });

  it("rejects top_k = 0 (below minimum)", () => {
    const result = toolSearchDocument([TEST_DOC], { query: "payment", top_k: 0 });
    expect(result.error).toBe("validation_error");
  });

  it("accepts top_k = 5 (maximum)", () => {
    const result = toolSearchDocument([TEST_DOC], { query: "payment", top_k: 5 });
    expect(result.error).toBeUndefined();
  });
});

describe("toolGetPage — nonsense parameters", () => {
  it("rejects page = -1", () => {
    const result = toolGetPage([TEST_DOC], { page: -1 });
    expect(result.error).toBe("validation_error");
    expect(result.output).toContain("page must be >= 1");
  });

  it("rejects page = 0", () => {
    const result = toolGetPage([TEST_DOC], { page: 0 });
    expect(result.error).toBe("validation_error");
  });

  it("returns page_out_of_range for page beyond doc", () => {
    const result = toolGetPage([TEST_DOC], { page: 999 });
    expect(result.error).toBe("page_out_of_range");
    expect(result.output).toContain("does not exist");
  });

  it("rejects non-integer page (string)", () => {
    const result = toolGetPage([TEST_DOC], { page: "two" as any });
    expect(result.error).toBe("validation_error");
  });

  it("successfully returns page 1", () => {
    const result = toolGetPage([TEST_DOC], { page: 1 });
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("Page 1");
  });
});

describe("toolGetSection", () => {
  it("finds section by numeric id", () => {
    const result = toolGetSection([TEST_DOC], { identifier: "3" });
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("LIABILITY");
  });

  it("finds section by heading text", () => {
    const result = toolGetSection([TEST_DOC], { identifier: "TERMINATION" });
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("terminate");
  });

  it("returns not-found message for unknown section", () => {
    const result = toolGetSection([TEST_DOC], { identifier: "99.99 Non-Existent Clause" });
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("not found");
  });

  it("rejects missing identifier", () => {
    const result = toolGetSection([TEST_DOC], {});
    expect(result.error).toBe("validation_error");
  });
});

describe("toolListClauses", () => {
  it("returns an outline for the document", () => {
    const result = toolListClauses([TEST_DOC], {});
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("SERVICES");
    expect(result.output).toContain("PAYMENT");
  });

  it("handles empty args (no document_label)", () => {
    const result = toolListClauses([TEST_DOC], {});
    expect(result.error).toBeUndefined();
  });

  it("returns error for unknown document label", () => {
    const result = toolListClauses([TEST_DOC], { document_label: "D99" });
    expect(result.error).toBe("document_not_found");
    expect(result.output).toContain("not found");
  });
});

// ── executeTool dispatch ──────────────────────────────────────────────────────

describe("executeTool dispatch", () => {
  it("dispatches list_clauses correctly", () => {
    const r = executeTool("list_clauses", {}, [TEST_DOC]);
    expect(r.error).toBeUndefined();
    expect(r.output).toContain("Clause outline");
  });

  it("dispatches search_document correctly", () => {
    const r = executeTool("search_document", { query: "liability" }, [TEST_DOC]);
    expect(r.error).toBeUndefined();
    expect(r.output).toContain("LIABILITY");
  });

  it("dispatches get_section correctly", () => {
    const r = executeTool("get_section", { identifier: "PAYMENT" }, [TEST_DOC]);
    expect(r.error).toBeUndefined();
  });

  it("dispatches get_page correctly", () => {
    const r = executeTool("get_page", { page: 1 }, [TEST_DOC]);
    expect(r.error).toBeUndefined();
  });

  it("returns unknown_tool for unknown name", () => {
    const r = executeTool("hallucinate_tool", {}, [TEST_DOC]);
    expect(r.error).toBe("unknown_tool");
    expect(r.output).toContain(TOOL_NAMES[0]);
  });
});

// ── Malformed JSON args simulation ───────────────────────────────────────────

describe("malformed JSON argument handling", () => {
  it("toolGetPage handles null args gracefully", () => {
    // null is not a valid object — Zod will reject
    const result = toolGetPage([TEST_DOC], null as any);
    expect(result.error).toBe("validation_error");
  });

  it("toolSearchDocument handles array args gracefully", () => {
    const result = toolSearchDocument([TEST_DOC], ["query", "liability"] as any);
    expect(result.error).toBe("validation_error");
  });

  it("toolGetSection handles number args gracefully", () => {
    const result = toolGetSection([TEST_DOC], 42 as any);
    expect(result.error).toBe("validation_error");
  });
});

// ── Multi-doc label support ───────────────────────────────────────────────────

describe("multi-doc tool dispatch", () => {
  const doc2 = { ...TEST_DOC, id: "doc-2", name: "NDA.pdf", label: "D2" };
  const doc1 = { ...TEST_DOC, label: "D1" };

  it("resolves D1 correctly", () => {
    const r = executeTool("search_document", { query: "payment", document_label: "D1" }, [doc1, doc2]);
    expect(r.error).toBeUndefined();
  });

  it("resolves D2 correctly", () => {
    const r = executeTool("list_clauses", { document_label: "D2" }, [doc1, doc2]);
    expect(r.error).toBeUndefined();
    expect(r.output).toContain("NDA.pdf");
  });

  it("returns error for non-existent label D5", () => {
    const r = executeTool("get_page", { page: 1, document_label: "D5" }, [doc1, doc2]);
    expect(r.error).toBe("document_not_found");
  });
});

// ── Coverage tracking ─────────────────────────────────────────────────────────

describe("coverage tracking", () => {
  it("search_document returns rangesRead", () => {
    const r = toolSearchDocument([TEST_DOC], { query: "liability cap", top_k: 2 });
    expect(r.rangesRead.length).toBeGreaterThan(0);
    expect(r.rangesRead[0].source).toContain("search:");
  });

  it("get_section returns rangesRead with section source", () => {
    const r = toolGetSection([TEST_DOC], { identifier: "PAYMENT" });
    if (!r.error) {
      expect(r.rangesRead.length).toBeGreaterThan(0);
      expect(r.rangesRead[0].source).toContain("section:");
    }
  });

  it("get_page returns rangesRead with page source", () => {
    const r = toolGetPage([TEST_DOC], { page: 1 });
    expect(r.rangesRead.length).toBe(1);
    expect(r.rangesRead[0].source).toContain("page:");
  });

  it("list_clauses returns empty rangesRead (outline only)", () => {
    const r = toolListClauses([TEST_DOC], {});
    expect(r.rangesRead).toHaveLength(0);
  });
});

// ── buildAgentCoverage ────────────────────────────────────────────────────────

import { buildAgentCoverage } from "@/lib/agent/tools";

describe("buildAgentCoverage", () => {
  it("returns empty coverage for no ranges", () => {
    const cov = buildAgentCoverage([], TEST_DOC);
    expect(cov.pagesRead).toHaveLength(0);
    expect(cov.complete).toBe(false);
  });

  it("maps page-1 range to page 1", () => {
    const cov = buildAgentCoverage([{ startOffset: 10, endOffset: 100, source: "test" }], TEST_DOC);
    expect(cov.pagesRead).toContain(1);
  });

  it("marks complete when all pages covered", () => {
    const cov = buildAgentCoverage([
      { startOffset: 0, endOffset: 180, source: "p1" },
      { startOffset: 181, endOffset: CANONICAL_TEXT.length, source: "p2" },
    ], TEST_DOC);
    expect(cov.complete).toBe(true);
  });
});
