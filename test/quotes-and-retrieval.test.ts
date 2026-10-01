import { describe, it, expect } from "vitest";
import { normalizeWithMap } from "@/lib/quotes/normalize";
import { verifyQuote, stripSurroundingQuotes } from "@/lib/quotes/verify";
import { getQuotePages } from "@/lib/quotes/pages";
import {
  chunkCanonicalText,
  extractHeadingMarkers,
} from "@/lib/chunk/chunk";
import {
  tokenize,
  extractSectionNumbers,
  BM25Index,
} from "@/lib/retrieval/bm25";
import { estimateTokens } from "@/lib/tokens";

describe("Quote Verification & Normalization", () => {
  // 1. Exact match
  it("verifies exact match with single occurrence", () => {
    const doc =
      "This Master Services Agreement is entered into by and between Acme Corp and Beta LLC on October 1, 2026.";
    const quote = "entered into by and between Acme Corp and Beta LLC";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
    expect(res.occurrences).toHaveLength(1);
    expect(res.ambiguous).toBeFalsy();
    expect(doc.slice(res.occurrences[0].start, res.occurrences[0].end)).toBe(
      quote
    );
  });

  // 2. Multiline exact match
  it("verifies multiline quote spanning regular lines", () => {
    const doc =
      "Section 4. Payment Terms.\nClient shall remit payment within 30 days\nof receiving the undisputed invoice.";
    const quote =
      "Client shall remit payment within 30 days\nof receiving the undisputed invoice.";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
    expect(res.occurrences).toHaveLength(1);
  });

  // 3. Different whitespace (tabs, newlines)
  it("verifies quote with different internal whitespace runs and newlines", () => {
    const doc =
      "Neither party    shall be liable\n\t\tfor any incidental or consequential   damages.";
    const quote =
      "Neither party shall be liable for any incidental or consequential damages.";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
    expect(res.occurrences).toHaveLength(1);
  });

  // 4. NBSP and multi-space whitespace
  it("normalizes and verifies non-breaking spaces (\u00A0)", () => {
    const doc =
      "The Executive shall receive an annual base salary of $250,000\u00A0payable monthly.";
    const quote =
      "The Executive shall receive an annual base salary of $250,000 payable monthly.";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
  });

  // 5. Hyphenated line breaks ("agree-\nment" -> "agreement")
  it("verifies quote across hyphenated line break (agree-\\nment)", () => {
    const doc =
      "The parties hereby confirm that this agree-\nment shall supersede all prior understandings.";
    const quote = "this agreement shall supersede all prior understandings";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
    expect(res.occurrences).toHaveLength(1);
    const matched = doc.slice(res.occurrences[0].start, res.occurrences[0].end);
    expect(matched).toBe(
      "this agree-\nment shall supersede all prior understandings"
    );
  });

  // 6. Hyphenated line breaks with CRLF (\r\n)
  it("repairs hyphenation across CRLF line breaks (termi-\\r\\nnation)", () => {
    const doc =
      "Upon notice of termi-\r\nnation, Consultant shall immediately return all property.";
    const quote =
      "Upon notice of termination, Consultant shall immediately return all property.";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
  });

  // 7. Hyphenated line breaks with indentation spaces
  it("repairs hyphenation with indentation spaces after the line break", () => {
    const doc =
      "All confiden-\n   tial information disclosed hereunder shall remain protected.";
    const quote =
      "All confidential information disclosed hereunder shall remain protected.";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
  });

  // 8. Curly vs straight double quotes
  it("matches curly double quotes against straight double quotes", () => {
    const doc =
      'The term “Confidential Information” shall encompass all proprietary technical data.';
    const quote =
      'The term "Confidential Information" shall encompass all proprietary technical data.';
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
  });

  // 9. Curly vs straight single quotes / apostrophes
  it("matches curly single quotes and apostrophes against straight quotes", () => {
    const doc =
      "Neither party’s liability shall exceed the total fees paid under this agreement.";
    const quote =
      "Neither party's liability shall exceed the total fees paid under this agreement.";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
  });

  // 10. Surrounding quotes stripping
  it("strips outer quotation marks added by LLM output", () => {
    expect(stripSurroundingQuotes('"Hello World"')).toBe("Hello World");
    expect(stripSurroundingQuotes('“Confidentiality Clause”')).toBe(
      "Confidentiality Clause"
    );
    expect(stripSurroundingQuotes("'''Payment within 10 days'''")).toBe(
      "Payment within 10 days"
    );

    const doc =
      "The Consultant shall act as an independent contractor at all times.";
    const rawAiQuote =
      '“The Consultant shall act as an independent contractor at all times.”';
    const res = verifyQuote(rawAiQuote, doc);
    expect(res.status).toBe("verified");
  });

  // 11. En dash vs hyphen
  it("matches en dash (–) in document against standard hyphen (-) in quote", () => {
    const doc =
      "The non–competition covenant shall remain effective for 12 months.";
    const quote =
      "The non-competition covenant shall remain effective for 12 months.";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
  });

  // 12. Em dash vs hyphen
  it("matches em dash (—) and horizontal bar against hyphen", () => {
    const doc =
      "Payment terms—net 45 days—apply to all approved purchase orders.";
    const quote =
      "Payment terms-net 45 days-apply to all approved purchase orders.";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
  });

  // 13. Ligatures (fi -> ﬁ)
  it("matches fi ligature (ﬁ) against standard 'fi'", () => {
    const doc =
      "The ﬁrst payment is due upon signing of this document by both parties.";
    const quote =
      "The first payment is due upon signing of this document by both parties.";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
  });

  // 14. Ligatures (fl, ffi)
  it("matches fl (ﬂ) and ffi (ﬃ) ligatures", () => {
    const doc =
      "The ﬂow of materials and the eﬃcient processing must be maintained.";
    const quote =
      "The flow of materials and the efficient processing must be maintained.";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
  });

  // 15. Ligatures (œ, æ)
  it("matches œ and æ ligatures expanded to oe and ae", () => {
    const doc =
      "The æsthetic standards and œconomic viability shall be evaluated annually.";
    const quote =
      "The aesthetic standards and oeconomic viability shall be evaluated annually.";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
  });

  // 16. Case difference
  it("matches uppercase text in document against lowercase quote", () => {
    const doc =
      "IN WITNESS WHEREOF THE PARTIES HAVE EXECUTED THIS AGREEMENT ON THE DATE FIRST WRITTEN ABOVE.";
    const quote =
      "in witness whereof the parties have executed this agreement on the date first written above.";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
  });

  // 17. Mixed case differences
  it("matches title case in quote against sentence case in document", () => {
    const doc =
      "Each party agrees to defend, indemnify and hold harmless the other party.";
    const quote =
      "Each Party Agrees To Defend, Indemnify And Hold Harmless The Other Party.";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
  });

  // 18. Multiple occurrences & ambiguous flag
  it("flags ambiguous: true and returns all occurrences when quote appears multiple times", () => {
    const doc =
      "Section 1: The Company shall pay on time.\nSection 2: The Company shall pay on time.\nSection 3: The Company shall pay on time.";
    const quote = "The Company shall pay on time.";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
    expect(res.ambiguous).toBe(true);
    expect(res.occurrences).toHaveLength(3);
  });

  // 19. Multiple occurrences offsets verification
  it("computes distinct, non-overlapping offsets for each occurrence", () => {
    const doc =
      "First paragraph with valid statement. Middle text. Second paragraph with valid statement.";
    const quote = "paragraph with valid statement";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
    expect(res.occurrences).toHaveLength(2);
    expect(res.occurrences[0].end).toBeLessThan(res.occurrences[1].start);
    expect(
      doc.slice(res.occurrences[0].start, res.occurrences[0].end).toLowerCase()
    ).toBe("paragraph with valid statement");
    expect(
      doc.slice(res.occurrences[1].start, res.occurrences[1].end).toLowerCase()
    ).toBe("paragraph with valid statement");
  });

  // 20. Quote spanning a page break
  it("detects quotes spanning across page breaks (crossesPageBreak: true)", () => {
    const pages = [
      { pageNumber: 1, startOffset: 0, endOffset: 100 },
      { pageNumber: 2, startOffset: 101, endOffset: 250 },
    ];
    const occurrence = { start: 80, end: 150 };
    const pageRes = getQuotePages(occurrence, pages);

    expect(pageRes.pageStart).toBe(1);
    expect(pageRes.pageEnd).toBe(2);
    expect(pageRes.crossesPageBreak).toBe(true);
  });

  // 21. Quote inside single page
  it("returns crossesPageBreak: false when quote is fully contained within one page", () => {
    const pages = [
      { pageNumber: 1, startOffset: 0, endOffset: 100 },
      { pageNumber: 2, startOffset: 101, endOffset: 250 },
    ];
    const occurrence = { start: 120, end: 180 };
    const pageRes = getQuotePages(occurrence, pages);

    expect(pageRes.pageStart).toBe(2);
    expect(pageRes.pageEnd).toBe(2);
    expect(pageRes.crossesPageBreak).toBe(false);
  });

  // 22. Fabricated quote
  it("returns unverified for a fabricated quote not in the document", () => {
    const doc =
      "The Vendor agrees to deliver the software licenses by December 31, 2026.";
    const fakeQuote =
      "The Vendor shall refund all payments within twenty-four hours.";
    const res = verifyQuote(fakeQuote, doc);

    expect(res.status).toBe("unverified");
    expect(res.reason).toBe("not found in document (possibly paraphrased)");
    expect(res.occurrences).toHaveLength(0);
  });

  // 23. Paraphrased quote
  it("rejects paraphrased quote without false positive", () => {
    const doc =
      "In no event shall either party be liable to the other for punitive or exemplary damages.";
    const paraphrase =
      "Neither party can be sued for punitive or exemplary damages in any situation.";
    const res = verifyQuote(paraphrase, doc);

    expect(res.status).toBe("unverified");
    expect(res.reason).toBe("not found in document (possibly paraphrased)");
  });

  // 24. Debug closestPassage on unverified quote
  it("provides closestPassage for debugging on paraphrased quote while keeping status unverified", () => {
    const doc =
      "In no event shall either party be liable to the other for punitive or exemplary damages arising out of this contract.";
    const paraphrase =
      "neither party shall be liable for punitive or exemplary damages under state law.";
    const res = verifyQuote(paraphrase, doc);

    expect(res.status).toBe("unverified");
    expect(res.closestPassage).toBeDefined();
    expect(typeof res.closestPassage).toBe("string");
    expect(res.closestPassage).toContain("punitive or exemplary damages");
  });

  // 25. Quote with one changed word (no fuzzy match allowed)
  it("strictly rejects a quote with just one altered word (zero fuzzy matching invariant)", () => {
    const doc =
      "The Service Provider will indemnify Customer against third-party patent infringement claims.";
    const quoteOneWordDifferent =
      "The Service Provider will reimburse Customer against third-party patent infringement claims.";
    const res = verifyQuote(quoteOneWordDifferent, doc);

    expect(res.status).toBe("unverified");
  });

  // 26. Too-short quote (< 4 words or < 20 chars)
  it("rejects quotes shorter than 4 words or 20 chars with 'too short to verify'", () => {
    const doc =
      "The parties agree that this contract shall remain confidential.";
    const tooShortQuote = "shall remain";
    const res = verifyQuote(tooShortQuote, doc);

    expect(res.status).toBe("unverified");
    expect(res.reason).toBe("too short to verify");
  });

  // 27. Too-short generic word
  it("rejects short generic phrase even if it appears once in doc", () => {
    const doc =
      "This document governs the overall relationship and nothing more.";
    const shortPhrase = "overall relationship";
    const res = verifyQuote(shortPhrase, doc);

    expect(res.status).toBe("unverified");
    expect(res.reason).toBe("too short to verify");
  });

  // 28. Defined term exception for short quote (occurs exactly once)
  it("permits defined term shorter than 20 chars if it occurs exactly once", () => {
    const doc =
      "The term 'Proprietary Software' means the proprietary source code of Vendor.";
    const definedTermQuote = "Proprietary Software";
    const res = verifyQuote(definedTermQuote, doc);

    expect(res.status).toBe("verified");
    expect(res.occurrences).toHaveLength(1);
  });

  // 29. Defined term occurring multiple times is rejected if too short
  it("rejects short defined term if it appears multiple times in the document", () => {
    const doc =
      "Vendor hereby licenses the Software. Customer agrees that the Software remains proprietary.";
    const defTerm = "Software";
    const res = verifyQuote(defTerm, doc);

    expect(res.status).toBe("unverified");
    expect(res.reason).toBe("too short to verify");
  });

  // 30. Ellipsis quote in order within bounded window
  it("verifies ellipsis quote when segments appear in order within 1500 chars", () => {
    const doc =
      "Section 7. Indemnity. The Supplier shall defend and hold harmless the Buyer ... from any losses arising from third party claims.";
    const quote =
      "The Supplier shall defend and hold harmless the Buyer ... from any losses arising from third party claims.";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
    expect(res.occurrences).toHaveLength(1);
  });

  // 31. Ellipsis quote with 3 segments
  it("verifies 3-segment ellipsis quote in sequential order", () => {
    const doc =
      "The Company agrees to provide support, including bug fixes, ... 24/7 technical hotline access, ... and quarterly system upgrades.";
    const quote =
      "The Company agrees to provide support, including bug fixes ... 24/7 technical hotline access ... and quarterly system upgrades.";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
  });

  // 32. Ellipsis quote out of order
  it("rejects ellipsis quote when segments appear out of order in the document", () => {
    const doc =
      "First segment appears here in early text. Second segment appears here in later text.";
    const reversedQuote =
      "Second segment appears here in later text ... First segment appears here in early text";
    const res = verifyQuote(reversedQuote, doc);

    expect(res.status).toBe("unverified");
  });

  // 33. Ellipsis quote exceeding 1500 chars bounded window
  it("rejects ellipsis quote if distance between segments exceeds 1500 characters", () => {
    const padding = "x".repeat(1600);
    const doc = `First anchor segment starts here. ${padding} Second anchor segment concludes here.`;
    const quote =
      "First anchor segment starts here ... Second anchor segment concludes here.";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("unverified");
  });

  // 34. Whitespace-removed pass (Pass 2) for split words
  it("verifies via Pass 2 when extraction splits words (e.g. 'con tract')", () => {
    const doc =
      "The parties agree that this con tract shall be governed by Delaware law.";
    const quote =
      "The parties agree that this contract shall be governed by Delaware law.";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
    expect(res.occurrences).toHaveLength(1);
  });

  // 35. Whitespace-removed pass for concatenated words
  it("verifies via Pass 2 when extraction merges words or adds stray spaces", () => {
    const doc =
      "Under no circumstances shall either party seek in junctive relief.";
    const quote =
      "Under no circumstances shall either party seek injunctive relief.";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
  });

  // 36. Arabic text verification
  it("verifies Arabic legal clause with letter-for-letter accuracy", () => {
    const doc =
      "تلتزم الشركة بالحفاظ على سرية المعلومات المقدمة من العميل وعدم إفشائها لأي طرف ثالث دون موافقة خطية مسبقة.";
    const quote =
      "تلتزم الشركة بالحفاظ على سرية المعلومات المقدمة من العميل وعدم إفشائها";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
    expect(res.occurrences).toHaveLength(1);
    expect(doc.slice(res.occurrences[0].start, res.occurrences[0].end)).toBe(
      quote
    );
  });

  // 37. Arabic text normalization integrity
  it("preserves Arabic characters intact without corruption during normalization", () => {
    const arabic = "  اتفاقية الخدمات الرئيسية والسرية  ";
    const normRes = normalizeWithMap(arabic);

    expect(normRes.norm).toBe("اتفاقية الخدمات الرئيسية والسرية");
    expect(normRes.map).toHaveLength(normRes.norm.length);
  });

  // 38. Offsets map back: original.slice(start, end) normalizes to quote (exact match)
  it("guarantees original.slice(start, end) normalizes exactly to the quote (exact match)", () => {
    const doc =
      "The Effective Date of this Master Services Agreement is October 10, 2026.";
    const quote =
      "Effective Date of this Master Services Agreement is October 10, 2026";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
    const { start, end } = res.occurrences[0];
    const sliced = doc.slice(start, end);
    const normSliced = normalizeWithMap(sliced).norm;
    const normQuote = normalizeWithMap(quote).norm;
    expect(normSliced).toBe(normQuote);
  });

  // 39. Offsets map back: with hyphenated line break
  it("guarantees original.slice(start, end) normalizes to quote across hyphenated line breaks", () => {
    const doc =
      "This doc contains the com-\nplete understand-\r\ning of the parties hereto.";
    const quote = "complete understanding of the parties hereto";
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
    const { start, end } = res.occurrences[0];
    const sliced = doc.slice(start, end);
    expect(normalizeWithMap(sliced).norm).toBe(
      normalizeWithMap(quote).norm
    );
  });

  // 40. Offsets map back: curly quotes & dashes
  it("guarantees original.slice(start, end) normalizes to quote with curly quotes and dashes", () => {
    const doc =
      "Section 3: “Non—Disclosure” shall apply to all shared information.";
    const quote =
      'Section 3: "Non-Disclosure" shall apply to all shared information.';
    const res = verifyQuote(quote, doc);

    expect(res.status).toBe("verified");
    const { start, end } = res.occurrences[0];
    const sliced = doc.slice(start, end);
    expect(normalizeWithMap(sliced).norm).toBe(
      normalizeWithMap(quote).norm
    );
  });
});

describe("Document Chunking", () => {
  // 41. Gapless document coverage
  it("guarantees chunk offsets cover the document with NO gaps", () => {
    // Generate 5000 character sample legal text
    const textParts = [
      "SECTION 1. DEFINITIONS.\nIn this Agreement, the following terms have meanings set forth below:\n",
      "1.1 'Services' means the cloud software and consulting services provided by Company.\n",
      "1.2 'Customer Data' means all electronic data submitted by Customer to the platform.\n\n",
      "SECTION 2. FEES AND PAYMENT.\nCustomer shall pay all fees specified in Order Forms.\n",
      "Except as otherwise specified, fees are based on services purchased and payment is due net 30.\n\n",
      "SECTION 3. CONFIDENTIALITY.\nEach party agrees to hold the other party's Confidential Information in strict confidence.\n",
      "3.1 Standard of Care. The Receiving Party shall use at least reasonable care.\n\n",
      "SECTION 4. INDEMNIFICATION.\nCompany shall defend Customer against any claim that Services infringe a third party patent.\n\n",
      "SECTION 5. LIMITATION OF LIABILITY.\nNEITHER PARTY SHALL BE LIABLE FOR INDIRECT OR CONSEQUENTIAL DAMAGES.\n",
      "IN NO EVENT SHALL AGGREGATE LIABILITY EXCEED THE TOTAL FEES PAID IN THE PRIOR TWELVE MONTHS.\n\n",
      "SECTION 6. GENERAL PROVISIONS.\nThis Agreement represents the entire understanding between the parties.\n",
    ];
    // Repeat to make it ~4500 chars
    const canonicalText = textParts.join("").repeat(4);

    const chunks = chunkCanonicalText(canonicalText, [], {
      targetChars: 1200,
      hardMaxChars: 1800,
      overlapFraction: 0.15,
    });

    expect(chunks.length).toBeGreaterThan(1);

    // Verify Chunk 0 starts at 0
    expect(chunks[0].startOffset).toBe(0);

    // Verify last chunk ends at canonicalText.length
    expect(chunks[chunks.length - 1].endOffset).toBe(canonicalText.length);

    // Verify NO GAPS between adjacent chunks
    for (let i = 1; i < chunks.length; i++) {
      const prevChunk = chunks[i - 1];
      const currChunk = chunks[i];

      // Current chunk start MUST be less than or equal to previous chunk end (overlap)
      expect(currChunk.startOffset).toBeLessThanOrEqual(prevChunk.endOffset);
      // Strictly forward progress
      expect(currChunk.startOffset).toBeGreaterThan(prevChunk.startOffset);
    }
  });

  // 42. Heading detection (numbered, Articles, ALL CAPS)
  it("detects clause/heading structures correctly", () => {
    const contract =
      "ARTICLE I: DEFINITIONS\n1.1 Confidential Information\n(a) Exclusions from Confidentiality\nINDEMNIFICATION\nSection 12. Governing Law";
    const markers = extractHeadingMarkers(contract);

    const labels = markers.map((m) => m.label);
    expect(labels.some((l) => l.includes("ARTICLE I"))).toBe(true);
    expect(labels.some((l) => l.includes("1.1 Confidential"))).toBe(true);
    expect(labels.some((l) => l.includes("(a) Exclusions"))).toBe(true);
    expect(labels.some((l) => l.includes("INDEMNIFICATION"))).toBe(true);
    expect(labels.some((l) => l.includes("Section 12"))).toBe(true);
  });
});

describe("BM25 Retrieval & Token Estimation", () => {
  // 43. BM25 ranks obvious chunk first
  it("BM25 ranks the obvious chunk first on query", () => {
    const chunks = [
      {
        idx: 0,
        startOffset: 0,
        endOffset: 200,
        pageStart: 1,
        pageEnd: 1,
        sectionLabel: "Section 1: Preamble",
        text: "This agreement is entered into between Acme Corp and Beta LLC on October 1, 2026.",
      },
      {
        idx: 1,
        startOffset: 200,
        endOffset: 500,
        pageStart: 1,
        pageEnd: 1,
        sectionLabel: "Section 2: Payment Terms",
        text: "Invoices are payable within 30 calendar days from the date of receipt. Late fees of 1.5% per month apply.",
      },
      {
        idx: 2,
        startOffset: 500,
        endOffset: 900,
        pageStart: 1,
        pageEnd: 1,
        sectionLabel: "Section 3: Indemnification",
        text: "Each party shall defend, indemnify, and hold harmless the other party against third-party claims, patent infringements, damages, and legal expenses.",
      },
    ];

    const index = new BM25Index(chunks);
    const results = index.search(
      "who indemnifies against third-party patent infringements",
      3
    );

    expect(results).toHaveLength(3);
    expect(results[0].chunk.idx).toBe(2);
    expect(results[0].chunk.sectionLabel).toContain("Indemnification");
  });

  // 44. BM25 section-number boost
  it("applies section-number boost: query 'clause 12.3' ranks 12.3 first", () => {
    const chunks = [
      {
        idx: 0,
        startOffset: 0,
        endOffset: 300,
        pageStart: 1,
        pageEnd: 1,
        sectionLabel: "Section 5: General",
        text: "General liability and obligations under this contract for all parties.",
      },
      {
        idx: 1,
        startOffset: 300,
        endOffset: 600,
        pageStart: 1,
        pageEnd: 1,
        sectionLabel: "Section 12.3: Data Privacy",
        text: "Customer personal information shall be processed in accordance with applicable GDPR regulations.",
      },
      {
        idx: 2,
        startOffset: 600,
        endOffset: 900,
        pageStart: 1,
        pageEnd: 1,
        sectionLabel: "Section 14: Notices",
        text: "All formal legal notices under this agreement shall be delivered by certified mail.",
      },
    ];

    const index = new BM25Index(chunks);
    const results = index.search("clause 12.3", 3, true);

    expect(results[0].chunk.idx).toBe(1);
    expect(results[0].chunk.sectionLabel).toContain("12.3");
  });

  // 45. BM25 tokenizer keeps numbers & currency while filtering stopwords
  it("tokenizer keeps numbers, section identifiers, and currencies while stripping stopwords", () => {
    const text =
      "The penalty under Clause 12.3 shall be $50,000 or 15% of annual fees.";
    const tokens = tokenize(text);

    expect(tokens).toContain("penalty");
    expect(tokens).toContain("clause");
    expect(tokens).toContain("12.3");
    expect(tokens).toContain("$50,000");
    expect(tokens).toContain("15%");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("under");
    expect(tokens).not.toContain("shall");
    expect(tokens).not.toContain("be");
    expect(tokens).not.toContain("of");
  });

  // 46. Token estimation: ceil(chars / 4)
  it("estimateTokens returns ceil(chars / 4)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(100))).toBe(25);
    expect(estimateTokens("a".repeat(101))).toBe(26);
  });
});
