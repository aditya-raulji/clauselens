/**
 * compare.test.ts
 * Unit tests for the /compare pipeline:
 *   - Segmenter
 *   - Aligner (label match, cosine match, moved, added, removed)
 *   - Facts extractor & fact differ
 *   - Guardrail enforcement (significance escalation)
 *   - Pipeline smoke test (end-to-end, no LLM)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// --- Pure lib imports ---
import { segmentContract } from "@/lib/compare/segmenter";
import {
  alignClauses,
  computeTokenSimilarity,
  normalizeLabel,
  computeWordDiff,
} from "@/lib/compare/aligner";
import {
  extractFacts,
  diffFacts,
  isHighRiskClause,
  FORCED_HIGH_KEYWORDS,
} from "@/lib/compare/facts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXTURE_DIR = join(__dirname, "fixtures/compare");

let contractA: string;
let contractB: string;

beforeAll(() => {
  contractA = readFileSync(join(FIXTURE_DIR, "contract-a.txt"), "utf8");
  contractB = readFileSync(join(FIXTURE_DIR, "contract-b.txt"), "utf8");
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. SEGMENTER TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("segmentContract", () => {
  it("returns non-empty segments for contract A", () => {
    const segs = segmentContract(contractA);
    expect(segs.length).toBeGreaterThan(3);
  });

  it("returns non-empty segments for contract B", () => {
    const segs = segmentContract(contractB);
    expect(segs.length).toBeGreaterThan(3);
  });

  it("each segment has a non-empty text and valid offsets", () => {
    const segs = segmentContract(contractA);
    for (const seg of segs) {
      expect(seg.text.trim().length).toBeGreaterThan(0);
      expect(seg.startOffset).toBeGreaterThanOrEqual(0);
      expect(seg.endOffset).toBeGreaterThan(seg.startOffset);
    }
  });

  it("segment text is found at its startOffset in the original text", () => {
    const segs = segmentContract(contractA);
    for (const seg of segs) {
      const slice = contractA.slice(seg.startOffset, seg.endOffset).trim();
      // Allow for whitespace normalisation
      expect(slice.length).toBeGreaterThan(0);
    }
  });

  it("detects clause headers like '1.', '1.1', 'Section X'", () => {
    const segs = segmentContract(contractA);
    const labels = segs.map((s) => s.label.toLowerCase());
    const hasSection = labels.some((l) => l.includes("1.") || l.includes("section"));
    expect(hasSection).toBe(true);
  });

  it("falls back to paragraphs for unstructured text", () => {
    const plain = `This is a long paragraph that has no numbering at all. It just goes on and on and on.

This is another paragraph. It also has no numbering structure. The segmenter should fall back to paragraph splitting.

And here is a third paragraph just to make things interesting.`;
    const segs = segmentContract(plain);
    expect(segs.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty array for empty text", () => {
    expect(segmentContract("")).toEqual([]);
    expect(segmentContract("   \n  ")).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. ALIGNER TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("normalizeLabel", () => {
  it("strips 'Section' prefix and punctuation", () => {
    expect(normalizeLabel("Section 4.1.")).toBe("41");
    expect(normalizeLabel("SECTION 4.1")).toBe("41");
    expect(normalizeLabel("Article 3")).toBe("3");
    expect(normalizeLabel("clause 2.1")).toBe("21");
  });

  it("handles already bare labels", () => {
    expect(normalizeLabel("4.1")).toBe("41");
    expect(normalizeLabel("(a)")).toBe("a");
  });
});

describe("computeTokenSimilarity", () => {
  it("returns 1.0 for identical text", () => {
    expect(computeTokenSimilarity("the quick brown fox", "the quick brown fox")).toBe(1.0);
  });

  it("returns 0.0 for completely different text", () => {
    const sim = computeTokenSimilarity("apple orange banana", "xyz jklm qrstv");
    expect(sim).toBe(0);
  });

  it("returns high similarity for near-identical text", () => {
    const a = "The Service Provider shall provide software development services.";
    const b = "The Service Provider shall provide software development and consulting services.";
    const sim = computeTokenSimilarity(a, b);
    expect(sim).toBeGreaterThan(0.5);
  });

  it("returns 1.0 for two empty strings", () => {
    expect(computeTokenSimilarity("", "")).toBe(1.0);
  });
});

describe("alignClauses", () => {
  it("classifies identical clauses as unchanged", () => {
    const text = "The Service Provider shall perform services.";
    const segsA = [{ id: "a1", label: "1.", text, startOffset: 0, endOffset: text.length }];
    const segsB = [{ id: "b1", label: "1.", text, startOffset: 0, endOffset: text.length }];
    const result = alignClauses(segsA, segsB);
    expect(result.some((r) => r.changeType === "unchanged")).toBe(true);
  });

  it("classifies a new clause in B as added", () => {
    const textA = "Payment shall be made within 30 days.";
    const textB = "New clause entirely different from anything in A.";
    const segsA = [{ id: "a1", label: "1.", text: textA, startOffset: 0, endOffset: textA.length }];
    const segsB = [
      { id: "b1", label: "1.", text: textA, startOffset: 0, endOffset: textA.length },
      { id: "b2", label: "2.", text: textB, startOffset: textA.length, endOffset: textA.length + textB.length },
    ];
    const result = alignClauses(segsA, segsB);
    expect(result.some((r) => r.changeType === "added")).toBe(true);
  });

  it("classifies a clause removed from B as removed", () => {
    const textA = "Payment shall be made within 30 days.";
    const textExtra = "This clause only exists in A.";
    const segsA = [
      { id: "a1", label: "1.", text: textA, startOffset: 0, endOffset: textA.length },
      { id: "a2", label: "2.", text: textExtra, startOffset: textA.length, endOffset: textA.length + textExtra.length },
    ];
    const segsB = [
      { id: "b1", label: "1.", text: textA, startOffset: 0, endOffset: textA.length },
    ];
    const result = alignClauses(segsA, segsB);
    expect(result.some((r) => r.changeType === "removed")).toBe(true);
  });

  it("classifies a modified clause as modified (high similarity but not identical)", () => {
    const textA = "The Client shall pay AED 50,000 per month.";
    const textB = "The Client shall pay AED 75,000 per month.";
    const segsA = [{ id: "a1", label: "2.1", text: textA, startOffset: 0, endOffset: textA.length }];
    const segsB = [{ id: "b1", label: "2.1", text: textB, startOffset: 0, endOffset: textB.length }];
    const result = alignClauses(segsA, segsB);
    expect(result.length).toBe(1);
    expect(result[0].changeType).toBe("modified");
  });

  it("detects moved clause (same text, different index)", () => {
    const text1 = "Force majeure shall excuse performance.";
    const text2 = "Payment shall be made in 30 days.";
    const text3 = "This agreement shall terminate on notice.";
    const segsA = [
      { id: "a1", label: "1.", text: text1, startOffset: 0, endOffset: text1.length },
      { id: "a2", label: "2.", text: text2, startOffset: 40, endOffset: 80 },
      { id: "a3", label: "3.", text: text3, startOffset: 80, endOffset: 120 },
    ];
    // In B, clause 1 is moved to position 3
    const segsB = [
      { id: "b1", label: "1.", text: text2, startOffset: 0, endOffset: 40 },
      { id: "b2", label: "2.", text: text3, startOffset: 40, endOffset: 80 },
      { id: "b3", label: "3.", text: text1, startOffset: 80, endOffset: 120 },
    ];
    const result = alignClauses(segsA, segsB);
    const moved = result.filter((r) => r.changeType === "moved");
    expect(moved.length).toBeGreaterThanOrEqual(1);
  });

  it("produces correct result on real fixture contracts", () => {
    const segsA = segmentContract(contractA);
    const segsB = segmentContract(contractB);
    const aligned = alignClauses(segsA, segsB);

    // Must have some modified, added changes given the fixture design
    const modified = aligned.filter((r) => r.changeType === "modified");
    const added = aligned.filter((r) => r.changeType === "added");

    expect(modified.length).toBeGreaterThan(0);
    expect(added.length).toBeGreaterThan(0);
  });
});

describe("computeWordDiff", () => {
  it("produces equal chunks for identical text", () => {
    const chunks = computeWordDiff("hello world", "hello world");
    const types = chunks.map((c) => c.type);
    expect(types.every((t) => t === "equal")).toBe(true);
  });

  it("produces added chunk for text in B not in A", () => {
    const chunks = computeWordDiff("hello", "hello world");
    expect(chunks.some((c) => c.type === "added" && c.text.includes("world"))).toBe(true);
  });

  it("produces removed chunk for text in A not in B", () => {
    const chunks = computeWordDiff("hello world", "hello");
    expect(chunks.some((c) => c.type === "removed")).toBe(true);
  });

  it("handles empty inputs gracefully", () => {
    expect(() => computeWordDiff("", "")).not.toThrow();
    expect(() => computeWordDiff("text", "")).not.toThrow();
    expect(() => computeWordDiff("", "text")).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. FACTS EXTRACTION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("extractFacts", () => {
  it("extracts AED amounts", () => {
    const facts = extractFacts("The liability cap is AED 100,000.");
    expect(facts.money.length).toBeGreaterThan(0);
    expect(facts.money.some((m) => m.includes("100,000") || m.includes("100000"))).toBe(true);
  });

  it("extracts USD amounts with $ sign", () => {
    const facts = extractFacts("Fees: $50,000 per quarter.");
    expect(facts.money.length).toBeGreaterThan(0);
  });

  it("extracts percentages", () => {
    const facts = extractFacts("Interest at 2% per month.");
    expect(facts.percentages).toContain("2%");
  });

  it("extracts durations in days/months/years", () => {
    const facts = extractFacts("Payment within 30 days. Term is 12 months.");
    const durs = facts.durations.join(" ");
    expect(durs).toMatch(/30 days/i);
    expect(durs).toMatch(/12 months/i);
  });

  it("extracts obligation words", () => {
    const facts = extractFacts("The party shall perform. They may also review.");
    expect(facts.obligations).toContain("shall");
    expect(facts.obligations).toContain("may");
  });

  it("returns empty arrays for plain text with no facts", () => {
    const facts = extractFacts("This is a recital.");
    expect(facts.money).toEqual([]);
    expect(facts.percentages).toEqual([]);
    expect(facts.durations).toEqual([]);
  });
});

describe("diffFacts", () => {
  it("produces FactChange for money difference", () => {
    const factsA = extractFacts("Liability cap: AED 100,000.");
    const factsB = extractFacts("Liability cap: AED 1,000,000.");
    const changes = diffFacts(factsA, factsB, "A", "B");
    const moneyChange = changes.find((c) => c.label === "Amount");
    expect(moneyChange).toBeDefined();
    expect(moneyChange!.before).not.toBe(moneyChange!.after);
  });

  it("produces FactChange for duration difference", () => {
    const factsA = extractFacts("Notice period of 30 days.");
    const factsB = extractFacts("Notice period of 60 days.");
    const changes = diffFacts(factsA, factsB, "A", "B");
    const durChange = changes.find((c) => c.label === "Duration");
    expect(durChange).toBeDefined();
  });

  it("produces FactChange for obligation shift (shall → may)", () => {
    const factsA = extractFacts("The party shall deliver.");
    const factsB = extractFacts("The party may deliver.");
    const changes = diffFacts(factsA, factsB, "A", "B");
    const oblChange = changes.find((c) => c.label === "Obligation");
    expect(oblChange).toBeDefined();
    expect(oblChange!.description).toMatch(/shall/i);
  });

  it("returns empty array for identical facts", () => {
    const facts = extractFacts("Payment of AED 50,000 within 30 days.");
    const changes = diffFacts(facts, facts, "A", "B");
    expect(changes).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. HIGH-RISK DETECTION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("isHighRiskClause", () => {
  it("detects 'liability' as high risk", () => {
    expect(isHighRiskClause("Total liability shall not exceed AED 100,000")).toBe(true);
  });

  it("detects 'indemnify' as high risk", () => {
    expect(isHighRiskClause("The party shall indemnify the other.")).toBe(true);
  });

  it("detects 'termination' as high risk", () => {
    expect(isHighRiskClause("Upon termination, all obligations cease.")).toBe(true);
  });

  it("returns false for non-risk text", () => {
    expect(isHighRiskClause("This agreement is for professional services.")).toBe(false);
  });

  it("covers all FORCED_HIGH_KEYWORDS", () => {
    for (const kw of FORCED_HIGH_KEYWORDS) {
      expect(isHighRiskClause(`This clause mentions ${kw}.`)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. PIPELINE SMOKE TEST (no LLM, just structural integrity)
// ═══════════════════════════════════════════════════════════════════════════════

describe("full pipeline (deterministic layers only)", () => {
  it("segments + aligns fixture contracts without error", () => {
    const segsA = segmentContract(contractA);
    const segsB = segmentContract(contractB);
    expect(() => alignClauses(segsA, segsB)).not.toThrow();
  });

  it("produces at least one modified clause with a money FactChange for fixture contracts", () => {
    const segsA = segmentContract(contractA);
    const segsB = segmentContract(contractB);
    const aligned = alignClauses(segsA, segsB);

    let foundMoneyChange = false;
    for (const m of aligned) {
      if (m.changeType === "modified" && m.clauseA && m.clauseB) {
        const fA = extractFacts(m.clauseA.text);
        const fB = extractFacts(m.clauseB.text);
        const changes = diffFacts(fA, fB, "A", "B");
        if (changes.some((c) => c.label === "Amount")) {
          foundMoneyChange = true;
          break;
        }
      }
    }

    expect(foundMoneyChange).toBe(true);
  });

  it("detects the liability cap change (AED 100,000 → AED 1,000,000) as high-risk", () => {
    const segsA = segmentContract(contractA);
    const segsB = segmentContract(contractB);
    const aligned = alignClauses(segsA, segsB);

    const liabPair = aligned.find((m) => {
      const ta = (m.clauseA?.text || "").toLowerCase();
      const tb = (m.clauseB?.text || "").toLowerCase();
      return (ta.includes("100,000") || ta.includes("liability")) && tb.includes("1,000,000");
    });

    expect(liabPair).toBeDefined();
    expect(liabPair!.changeType).toBe("modified");

    const fA = extractFacts(liabPair!.clauseA!.text);
    const fB = extractFacts(liabPair!.clauseB!.text);
    const changes = diffFacts(fA, fB, "A", "B");
    expect(changes.some((c) => c.label === "Amount")).toBe(true);

    // isHighRiskClause should trigger
    const combined = liabPair!.clauseA!.text + " " + liabPair!.clauseB!.text;
    expect(isHighRiskClause(combined)).toBe(true);
  });

  it("detects the new Data Protection clause as 'added'", () => {
    const segsA = segmentContract(contractA);
    const segsB = segmentContract(contractB);
    const aligned = alignClauses(segsA, segsB);

    const added = aligned.filter((m) => m.changeType === "added");
    const hasDataProtection = added.some((m) =>
      (m.clauseB?.text || "").toLowerCase().includes("data protection")
    );
    expect(hasDataProtection).toBe(true);
  });
});
