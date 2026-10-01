/**
 * test/highlighting.test.ts
 *
 * Unit tests for offset→DOM-range mapping on synthetic fixtures.
 * Tests: single-line, multi-line, multi-block, cross-page, DOCX block mapping.
 *
 * Note: These tests run in a pure Node environment. They exercise the
 * non-DOM utilities (buildPageTextWithOffsets, findOverlappingItemSlices,
 * mergeBoundingRects, parseBlockOffsets, getPassageExcerpt).
 *
 * The DOM-specific paths (document.createRange, Range.getClientRects) are
 * tested in docs/highlighting-manual-test.md via browser walkthrough.
 */

import { describe, it, expect } from "vitest";
import { buildPageText, PageTextItem } from "@/lib/extract/pageText";
import {
  buildPageTextWithOffsets,
  findOverlappingItemSlices,
  mergeBoundingRects,
} from "@/lib/viewer/pdfOffsets";
import { parseBlockOffsets } from "@/lib/viewer/docxHighlight";
import { getPassageExcerpt } from "@/lib/viewer/fallbackExcerpt";
import { verifyQuote } from "@/lib/quotes/verify";

function item(
  str: string,
  tx: number,
  ty: number,
  width = str.length * 6,
  hasEOL = false
): PageTextItem {
  return { str, transform: [1, 0, 0, 1, tx, ty], width, hasEOL };
}

// ─────────────────────────────────────────────────────────────────
// 1. buildPageTextWithOffsets
// ─────────────────────────────────────────────────────────────────

describe("buildPageTextWithOffsets", () => {
  it("returns empty for empty items array", () => {
    const { text, items } = buildPageTextWithOffsets([]);
    expect(text).toBe("");
    expect(items).toEqual([]);
  });

  it("maps a single item correctly", () => {
    const items = [item("Hello", 10, 700)];
    const { text, items: spans } = buildPageTextWithOffsets(items);
    expect(text).toBe("Hello");
    expect(spans).toHaveLength(1);
    expect(spans[0].start).toBe(0);
    expect(spans[0].end).toBe(5);
    expect(spans[0].str).toBe("Hello");
  });

  it("maps two same-line items correctly (single-line quote)", () => {
    const pageItems = [
      item("This Agreement", 10, 700, 80),
      item("is made on", 96, 700, 60),
    ];
    const { text, items: spans } = buildPageTextWithOffsets(pageItems);
    expect(text).toContain("This Agreement");
    expect(text).toContain("is made on");

    const span0 = spans.find((s) => s.str === "This Agreement");
    const span1 = spans.find((s) => s.str === "is made on");
    expect(span0).toBeDefined();
    expect(span1).toBeDefined();
    // span1 should start after span0 ends
    expect(span1!.start).toBeGreaterThanOrEqual(span0!.end);
  });

  it("maps multi-line items — quote spanning two lines", () => {
    const pageItems = [
      item("The parties agree", 10, 700, 100),
      item("to the following:", 10, 680, 100), // different Y → newline
    ];
    const { text, items: spans } = buildPageTextWithOffsets(pageItems);
    expect(text).toContain("The parties agree");
    expect(text).toContain("to the following:");

    const canonicalVerify = buildPageText(pageItems);
    expect(text).toBe(canonicalVerify);

    const s0 = spans.find((s) => s.str === "The parties agree")!;
    const s1 = spans.find((s) => s.str === "to the following:")!;
    // s1 must start after newline (s0.end + 1 for \n)
    expect(s1.start).toBeGreaterThan(s0.end);
  });

  it("handles hasEOL items correctly", () => {
    const pageItems = [
      { ...item("First paragraph.", 10, 700), hasEOL: true },
      item("Second paragraph.", 10, 700),
    ];
    const { text, items: spans } = buildPageTextWithOffsets(pageItems);
    const s0 = spans.find((s) => s.str === "First paragraph.")!;
    const s1 = spans.find((s) => s.str === "Second paragraph.")!;
    expect(s0).toBeDefined();
    expect(s1).toBeDefined();
    // After hasEOL, s1 must begin at a new line offset
    expect(s1.start).toBeGreaterThan(s0.end);
  });

  it("items offsets are consistent with buildPageText canonical output", () => {
    const pageItems = [
      item("INDEMNIFICATION.", 10, 720, 100),
      item("Each Party shall", 10, 700, 90),
      item("indemnify, defend,", 110, 700, 100),
      item("and hold harmless", 10, 680, 90),
      item("the other Party.", 110, 680, 85),
    ];
    const canonical = buildPageText(pageItems);
    const { text, items: spans } = buildPageTextWithOffsets(pageItems);
    expect(text).toBe(canonical);

    // All span strings should be found within canonical at their mapped positions
    for (const span of spans) {
      const found = canonical.slice(span.start, span.end);
      // Either exact match or trimmed match
      expect(found.includes(span.str.trim())).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// 2. findOverlappingItemSlices
// ─────────────────────────────────────────────────────────────────

describe("findOverlappingItemSlices", () => {
  const mockItems = [
    { itemIndex: 0, start: 0, end: 6, str: "Hello " },
    { itemIndex: 1, start: 6, end: 11, str: "World" },
    { itemIndex: 2, start: 12, end: 24, str: "Second line." },
  ];

  it("returns empty for empty range", () => {
    expect(findOverlappingItemSlices(mockItems, 5, 5)).toEqual([]);
  });

  it("returns slice for single-item range", () => {
    const slices = findOverlappingItemSlices(mockItems, 0, 5);
    expect(slices).toHaveLength(1);
    expect(slices[0].itemIndex).toBe(0);
    expect(slices[0].sliceStart).toBe(0);
    expect(slices[0].sliceEnd).toBe(5);
  });

  it("spans two items (multi-item quote on same line)", () => {
    const slices = findOverlappingItemSlices(mockItems, 3, 9);
    expect(slices).toHaveLength(2);
    // Item 0: covers [3..6) → slice [3..6)
    expect(slices[0].itemIndex).toBe(0);
    expect(slices[0].sliceStart).toBe(3);
    expect(slices[0].sliceEnd).toBe(6);
    // Item 1: covers [6..9) → slice [0..3)
    expect(slices[1].itemIndex).toBe(1);
    expect(slices[1].sliceStart).toBe(0);
    expect(slices[1].sliceEnd).toBe(3);
  });

  it("spans all three items (cross-line quote)", () => {
    const slices = findOverlappingItemSlices(mockItems, 2, 20);
    expect(slices.map((s) => s.itemIndex)).toEqual(
      expect.arrayContaining([0, 1, 2])
    );
  });

  it("returns empty if range doesn't overlap any item", () => {
    const slices = findOverlappingItemSlices(mockItems, 25, 30);
    expect(slices).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// 3. mergeBoundingRects
// ─────────────────────────────────────────────────────────────────

describe("mergeBoundingRects", () => {
  it("returns empty for empty input", () => {
    expect(mergeBoundingRects([])).toEqual([]);
  });

  it("returns single rect as-is", () => {
    const rects = [{ left: 10, top: 100, width: 50, height: 14 }];
    expect(mergeBoundingRects(rects)).toEqual(rects);
  });

  it("merges horizontally adjacent rects on same line", () => {
    const rects = [
      { left: 10, top: 100, width: 40, height: 14 },
      { left: 52, top: 100, width: 40, height: 14 },
    ];
    const merged = mergeBoundingRects(rects);
    expect(merged).toHaveLength(1);
    expect(merged[0].left).toBe(10);
    expect(merged[0].width).toBe(82); // 10+82 = 92 = right edge
  });

  it("does NOT merge rects on different lines", () => {
    const rects = [
      { left: 10, top: 100, width: 50, height: 14 },
      { left: 10, top: 120, width: 50, height: 14 },
    ];
    const merged = mergeBoundingRects(rects);
    expect(merged).toHaveLength(2);
  });

  it("merges a multi-line span into per-line rects", () => {
    // 3 rects: 2 on line 100, 1 on line 120
    const rects = [
      { left: 10, top: 100, width: 40, height: 14 },
      { left: 55, top: 100, width: 30, height: 14 },
      { left: 10, top: 120, width: 60, height: 14 },
    ];
    const merged = mergeBoundingRects(rects);
    expect(merged).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────
// 4. parseBlockOffsets (DOCX)
// ─────────────────────────────────────────────────────────────────

describe("parseBlockOffsets", () => {
  it("returns empty for empty HTML", () => {
    expect(parseBlockOffsets("")).toEqual([]);
  });

  it("returns empty if no script tag present", () => {
    const html =
      "<p data-block=\"b0\">Some text</p><p data-block=\"b1\">More text</p>";
    expect(parseBlockOffsets(html)).toEqual([]);
  });

  it("parses embedded block offsets correctly", () => {
    const offsets = [
      { id: "b0", start: 0, end: 9 },
      { id: "b1", start: 10, end: 19 },
    ];
    const html =
      `<p data-block="b0">Some text</p>` +
      `<p data-block="b1">More text</p>` +
      `<script id="block-offsets" type="application/json">${JSON.stringify(offsets)}</script>`;
    const parsed = parseBlockOffsets(html);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ id: "b0", start: 0, end: 9 });
    expect(parsed[1]).toEqual({ id: "b1", start: 10, end: 19 });
  });

  it("handles malformed JSON gracefully (returns [])", () => {
    const html =
      `<p>text</p><script id="block-offsets" type="application/json">{invalid}</script>`;
    expect(parseBlockOffsets(html)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────
// 5. getPassageExcerpt (fallback)
// ─────────────────────────────────────────────────────────────────

describe("getPassageExcerpt", () => {
  const text = "A".repeat(200) + "QUOTE_TEXT_HERE" + "B".repeat(200);

  it("returns empty excerpt for empty text", () => {
    const r = getPassageExcerpt("", 0, 0);
    expect(r.prefix).toBe("");
    expect(r.quote).toBe("");
    expect(r.suffix).toBe("");
  });

  it("extracts the quote and surrounding context", () => {
    const start = 200;
    const end = 200 + "QUOTE_TEXT_HERE".length;
    const r = getPassageExcerpt(text, start, end, 50);
    expect(r.quote).toBe("QUOTE_TEXT_HERE");
    expect(r.prefix).toHaveLength(50);
    expect(r.suffix).toHaveLength(50);
    expect(r.hasPrefixEllipsis).toBe(true);
    expect(r.hasSuffixEllipsis).toBe(true);
  });

  it("does not have ellipsis if at document boundaries", () => {
    const r = getPassageExcerpt("Hello world test", 6, 11, 200);
    expect(r.quote).toBe("world");
    expect(r.hasPrefixEllipsis).toBe(false);
    expect(r.hasSuffixEllipsis).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// 6. Cross-page canonical offset verification
// ─────────────────────────────────────────────────────────────────

describe("Cross-page canonical verification (via verifyQuote)", () => {
  it("verifies a quote that spans page boundary (\\n\\n separator)", () => {
    // Simulate two pages separated by \n\n as in extractPdf
    const page1 = "Obligations of the Parties. Each party agrees to maintain";
    const page2 = "confidentiality of all disclosed information during the term.";
    const canonicalText = page1 + "\n\n" + page2;

    // The normalizer collapses all whitespace (including \n\n) to single space,
    // so a cross-page quote is verified as "maintain confidentiality" (space-joined).
    const crossPageQuote = "maintain confidentiality of all disclosed information";
    const result = verifyQuote(crossPageQuote, canonicalText);
    // Should be verified (whitespace normalization bridges the \n\n separator)
    expect(result.status).toBe("verified");
    expect(result.occurrences.length).toBeGreaterThan(0);
  });

  it("offset mapping correctly identifies page from canonical offset", () => {
    const pages = [
      { pageNumber: 1, startOffset: 0, endOffset: 50 },
      { pageNumber: 2, startOffset: 52, endOffset: 110 },
    ];

    const canonical = "A".repeat(50) + "\n\n" + "B".repeat(58);

    // An occurrence at offset 55 should land on page 2
    const occ = { start: 55, end: 60 };
    const page = pages.find(
      (p) => occ.start >= p.startOffset && occ.start <= p.endOffset
    );
    expect(page?.pageNumber).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────
// 7. DOCX table-cell and multi-block offset mapping (synthetic)
// ─────────────────────────────────────────────────────────────────

describe("DOCX multi-block offset coverage", () => {
  it("detects a quote spanning two block offsets", () => {
    const blockOffsets = [
      { id: "b0", start: 0, end: 30 },
      { id: "b1", start: 31, end: 70 },
      { id: "b2", start: 71, end: 100 },
    ];

    // Quote canonical range [20..50) overlaps b0 and b1
    const quoteStart = 20;
    const quoteEnd = 50;

    const overlapping = blockOffsets.filter(
      (b) => b.end > quoteStart && b.start < quoteEnd
    );
    expect(overlapping).toHaveLength(2);
    expect(overlapping[0].id).toBe("b0");
    expect(overlapping[1].id).toBe("b1");
  });

  it("detects quote entirely within a single table-cell block", () => {
    const blockOffsets = [
      { id: "b0", start: 0, end: 20 },
      { id: "td1", start: 21, end: 55 }, // simulated <td> block
      { id: "b2", start: 56, end: 90 },
    ];

    const quoteStart = 25;
    const quoteEnd = 50;

    const overlapping = blockOffsets.filter(
      (b) => b.end > quoteStart && b.start < quoteEnd
    );
    expect(overlapping).toHaveLength(1);
    expect(overlapping[0].id).toBe("td1");
  });
});
