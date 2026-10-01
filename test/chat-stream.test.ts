import { describe, it, expect, vi } from "vitest";
import {
  QuotesStreamStripper,
  parseQuotesJson,
  verifyExtractedQuotes,
} from "@/lib/chat/streamParser";

describe("QuotesStreamStripper", () => {
  it("strips <quotes> block completely from visible stream when received in a single chunk", () => {
    const stripper = new QuotesStreamStripper();
    const token1 = stripper.push("The contract requires 30 days notice [1]. ");
    const token2 = stripper.push(
      '<quotes>[{"n":1,"doc":"D1","quote":"30 days notice"}]</quotes>'
    );

    const { visibleText, quotesRaw } = stripper.flush();

    expect(token1).toBe("The contract requires 30 days notice [1]. ");
    expect(token2).toBe("");
    expect(visibleText).toBe("The contract requires 30 days notice [1]. ");
    expect(quotesRaw).toBe(
      '<quotes>[{"n":1,"doc":"D1","quote":"30 days notice"}]</quotes>'
    );
  });

  it("handles chunk boundaries splitting the <quotes> tag across tokens (< + quo + tes>)", () => {
    const stripper = new QuotesStreamStripper();
    const chunks = [
      "Liability is limited to fees paid [1].\n\n",
      "<",
      "quo",
      "tes>",
      '[{"n":1,"quote":"limited to fees paid"}]</quotes>',
    ];

    let fullVisible = "";
    for (const chunk of chunks) {
      fullVisible += stripper.push(chunk);
    }
    const { visibleText, quotesRaw } = stripper.flush();

    expect(fullVisible).toBe("Liability is limited to fees paid [1].\n\n");
    expect(visibleText).toBe("Liability is limited to fees paid [1].\n\n");
    expect(quotesRaw).toContain('{"n":1,"quote":"limited to fees paid"}');
    expect(visibleText).not.toContain("<quotes>");
  });

  it("handles splitting with individual characters (<, q, u, o, t, e, s, >)", () => {
    const stripper = new QuotesStreamStripper();
    const chunks = [
      "Answer text ",
      "<",
      "q",
      "u",
      "o",
      "t",
      "e",
      "s",
      ">",
      "[]</quotes>",
    ];

    let fullVisible = "";
    for (const chunk of chunks) {
      fullVisible += stripper.push(chunk);
    }
    const { visibleText } = stripper.flush();

    expect(fullVisible).toBe("Answer text ");
    expect(visibleText).toBe("Answer text ");
    expect(visibleText).not.toContain("<");
  });

  it("safely flushes false-alarm tags that are not <quotes> (e.g. <table>, <quote>)", () => {
    const stripper = new QuotesStreamStripper();
    const chunks = ["See ", "<", "table>", " for breakdown."];

    let fullVisible = "";
    for (const chunk of chunks) {
      fullVisible += stripper.push(chunk);
    }
    const { visibleText, quotesRaw } = stripper.flush();

    expect(fullVisible + (visibleText.slice(fullVisible.length))).toBe(
      "See <table> for breakdown."
    );
    expect(quotesRaw).toBe("");
  });

  it("flushes complete text when stream ends without any <quotes> block", () => {
    const stripper = new QuotesStreamStripper();
    stripper.push("The document does not contain this information.");
    const { visibleText, quotesRaw } = stripper.flush();

    expect(visibleText).toBe("The document does not contain this information.");
    expect(quotesRaw).toBe("");
  });
});

describe("Defensive JSON Parser (parseQuotesJson)", () => {
  it("parses valid JSON array inside <quotes> tags", () => {
    const raw =
      '<quotes>[{"n":1,"doc":"D1","quote":"payment within 30 days"}]</quotes>';
    const items = parseQuotesJson(raw);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      n: 1,
      doc: "D1",
      quote: "payment within 30 days",
    });
  });

  it("tolerates markdown code fences inside or around <quotes>", () => {
    const raw = `<quotes>
\`\`\`json
[
  { "n": 1, "doc": "D1", "quote": "All IP belongs to Vendor." },
  { "n": 2, "doc": "D1", "quote": "Governed by New York law." }
]
\`\`\`
</quotes>`;
    const items = parseQuotesJson(raw);

    expect(items).toHaveLength(2);
    expect(items[0].n).toBe(1);
    expect(items[0].quote).toBe("All IP belongs to Vendor.");
    expect(items[1].n).toBe(2);
    expect(items[1].quote).toBe("Governed by New York law.");
  });

  it("tolerates trailing commentary or missing closing tag", () => {
    const raw =
      '<quotes>[{"n": 1, "quote": "Confidentiality lasts 3 years."}] Note: checked from section 5';
    const items = parseQuotesJson(raw);

    expect(items).toHaveLength(1);
    expect(items[0].quote).toBe("Confidentiality lasts 3 years.");
  });

  it("recovers via regex fallback if outer array syntax is malformed", () => {
    const raw = `
<quotes>
{"n": 1, "quote": "First clause quote"}
{"n": 2, "quote": "Second clause quote"}
</quotes>`;
    const items = parseQuotesJson(raw);

    expect(items).toHaveLength(2);
    expect(items[0].quote).toBe("First clause quote");
    expect(items[1].quote).toBe("Second clause quote");
  });

  it("returns empty array for empty, whitespace, or invalid content", () => {
    expect(parseQuotesJson("")).toEqual([]);
    expect(parseQuotesJson("   ")).toEqual([]);
    expect(parseQuotesJson("<quotes>[]</quotes>")).toEqual([]);
    expect(parseQuotesJson("not json at all")).toEqual([]);
  });
});

describe("verifyExtractedQuotes", () => {
  it("verifies matching quote and populates page metadata", () => {
    const docText =
      "Section 10. Governing Law.\nThis Agreement shall be governed by Delaware law.";
    const pages = [{ pageNumber: 3, startOffset: 0, endOffset: 200 }];

    const rawQuotes = [
      {
        n: 1,
        quote: "This Agreement shall be governed by Delaware law",
      },
    ];

    const verified = verifyExtractedQuotes(rawQuotes, docText, pages);

    expect(verified).toHaveLength(1);
    expect(verified[0].status).toBe("verified");
    expect(verified[0].pageStart).toBe(3);
    expect(verified[0].pageEnd).toBe(3);
    expect(verified[0].occurrences).toHaveLength(1);
  });

  it("marks quote as unverified when not present in document text", () => {
    const docText = "The contract expires on December 31, 2026.";
    const rawQuotes = [
      {
        n: 1,
        quote: "The contract can be terminated without cause at any time",
      },
    ];

    const verified = verifyExtractedQuotes(rawQuotes, docText, []);

    expect(verified).toHaveLength(1);
    expect(verified[0].status).toBe("unverified");
    expect(verified[0].occurrences).toHaveLength(0);
    expect(verified[0].reason).toBeDefined();
  });
});

describe("Save-on-Abort Path", () => {
  it("correctly records stopped status and visible text when stream is aborted mid-generation", async () => {
    const mockDbInsert = vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([{ id: "msg-123" }]),
    });

    const stripper = new QuotesStreamStripper();
    const abortController = new AbortController();

    // Stream first few tokens
    stripper.push("First sentence of response. ");
    stripper.push("Second sentence starting to explain liability...");

    // Simulate user pressing Stop
    abortController.abort();

    // Simulated abort handler from /api/chat
    const isAborted = abortController.signal.aborted;
    const { visibleText } = stripper.flush();

    let savedPayload: any = null;
    if (isAborted) {
      savedPayload = {
        id: "msg-123",
        role: "assistant",
        content: visibleText,
        status: "stopped",
        quotes: null,
      };
      await mockDbInsert().values(savedPayload);
    }

    expect(isAborted).toBe(true);
    expect(savedPayload.status).toBe("stopped");
    expect(savedPayload.quotes).toBeNull();
    expect(savedPayload.content).toBe(
      "First sentence of response. Second sentence starting to explain liability..."
    );
    expect(mockDbInsert).toHaveBeenCalled();
  });
});
