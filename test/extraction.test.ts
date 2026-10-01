import { describe, it, expect } from "vitest";
import { buildPageText, PageTextItem } from "@/lib/extract/pageText";

// Helper to build a synthetic item
function item(str: string, tx: number, ty: number, width = str.length * 6, hasEOL = false): PageTextItem {
  return {
    str,
    transform: [1, 0, 0, 1, tx, ty],
    width,
    hasEOL,
  };
}

describe("buildPageText", () => {
  it("returns empty string for empty items array", () => {
    expect(buildPageText([])).toBe("");
  });

  it("returns a single item's text", () => {
    expect(buildPageText([item("Hello", 0, 700)])).toBe("Hello");
  });

  it("joins same-line items with a space", () => {
    const result = buildPageText([
      item("Hello", 0, 700, 30),
      item("World", 35, 700, 30),
    ]);
    expect(result).toBe("Hello World");
  });

  it("inserts a newline when Y gap exceeds threshold", () => {
    const result = buildPageText([
      item("Line one", 0, 700),
      item("Line two", 0, 685), // Δy = 15 > 3
    ]);
    expect(result).toBe("Line one\nLine two");
  });

  it("does NOT insert newline for tiny Y differences (same line)", () => {
    const result = buildPageText([
      item("First", 0, 700.5),
      item("Second", 40, 700.2), // Δy = 0.3 < 3
    ]);
    expect(result).toContain("First");
    expect(result).toContain("Second");
    expect(result).not.toContain("\n");
  });

  it("respects hasEOL flag — inserts newline after the item", () => {
    const result = buildPageText([
      { ...item("Para one", 0, 700), hasEOL: true },
      item("Para two", 0, 700), // same Y but preceded by hasEOL
    ]);
    // hasEOL should force a newline after "Para one"
    expect(result).toContain("Para one");
    expect(result).toContain("Para two");
    const lines = result.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it("collapses multiple spaces within a line", () => {
    const result = buildPageText([
      item("A  B", 0, 700), // item with internal extra space
    ]);
    expect(result).toBe("A B");
  });

  it("handles items with no transform (null positions)", () => {
    const items: PageTextItem[] = [
      { str: "No", width: 20 },
      { str: "transform", width: 50 },
    ];
    const result = buildPageText(items);
    // Should join with space since no Y info and result doesn't end with space
    expect(result).toContain("No");
    expect(result).toContain("transform");
  });

  it("skips items with empty str", () => {
    const result = buildPageText([
      item("", 0, 700),
      item("Real", 10, 700),
    ]);
    expect(result).toBe("Real");
  });

  it("trims leading and trailing whitespace from result", () => {
    const result = buildPageText([
      item("  padded  ", 0, 700),
    ]);
    expect(result.startsWith(" ")).toBe(false);
    expect(result.endsWith(" ")).toBe(false);
  });

  it("handles multi-line contract text faithfully", () => {
    const items: PageTextItem[] = [
      item("CONFIDENTIALITY AGREEMENT", 50, 720),
      item("This Agreement", 50, 700), // new line
      item("is entered", 120, 700),   // same line as above
      item("into by", 195, 700),      // same line
      item("the Parties.", 250, 700), // same line
    ];
    const result = buildPageText(items);
    const lines = result.split("\n");
    expect(lines[0]).toContain("CONFIDENTIALITY");
    expect(lines[1]).toContain("This Agreement");
    expect(lines[1]).toContain("is entered");
    expect(lines[1]).toContain("the Parties.");
  });
});

// ─── Scanned PDF detection thresholds ────────────────────────────────────────

describe("scanned PDF detection thresholds", () => {
  /** Simulate what extractPdf does to decide if a doc is scanned */
  function isScanned(pageLengths: number[]): boolean {
    const numPages = pageLengths.length;
    if (numPages === 0) return false;
    const totalChars = pageLengths.reduce((a, b) => a + b, 0);
    const avgCharsPerPage = totalChars / numPages;
    const emptyPageCount = pageLengths.filter((l) => l < 10).length;
    const emptyPageRatio = emptyPageCount / numPages;
    return avgCharsPerPage < 30 || emptyPageRatio > 0.8;
  }

  it("flags a document with very low average chars/page as scanned", () => {
    // 5 pages, all < 10 chars (image PDFs produce empty text content)
    expect(isScanned([5, 3, 0, 8, 0])).toBe(true);
  });

  it("flags a document where > 80% of pages are empty", () => {
    // 10 pages, 9 empty
    expect(isScanned([0, 0, 0, 0, 0, 0, 0, 0, 0, 500])).toBe(true);
  });

  it("does NOT flag a document with normal text density", () => {
    // 10 pages, ~800 chars each
    const pages = Array(10).fill(800);
    expect(isScanned(pages)).toBe(false);
  });

  it("does NOT flag a single short page with reasonable text", () => {
    expect(isScanned([150])).toBe(false);
  });

  it("does NOT flag when exactly at threshold boundary (30 avg chars/page)", () => {
    // 10 pages x 30 chars = 300 total, avg = 30 → NOT flagged (< 30 is the condition)
    expect(isScanned(Array(10).fill(30))).toBe(false);
  });

  it("flags when just below threshold (29 avg chars/page)", () => {
    expect(isScanned(Array(10).fill(29))).toBe(true);
  });

  it("does NOT flag when exactly 80% pages are empty (> 0.8 is the condition)", () => {
    // 10 pages, exactly 8 empty → 80% → NOT flagged (> 80% is the condition)
    // BUT avgCharsPerPage will be low, so it IS flagged by the other condition
    // This test verifies the ratio condition alone at boundary
    // Use 8 empty + 2 with enough chars to keep avg > 30
    const pages = [0, 0, 0, 0, 0, 0, 0, 0, 500, 500];
    // avg = 1000 / 10 = 100 → NOT scanned by avg
    // emptyRatio = 8/10 = 0.8 → NOT flagged (condition is > 0.8)
    expect(isScanned(pages)).toBe(false);
  });
});
