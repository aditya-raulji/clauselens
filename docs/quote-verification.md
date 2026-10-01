# ClauseLens Quote Verification Engine

## 1. Overview & System Philosophy

ClauseLens is built on a single, uncompromising principle: **Zero-Hallucination & Verified Citations**.

In conventional legal AI tools, language models are asked to cite line numbers, page numbers, or character offsets. In practice, LLMs frequently hallucinate or miscalculate offsets, invent slight variations of contract phrasing, or fabricate citations entirely.

ClauseLens enforces **Invariant Rule 1**:
> **Never trust AI-reported positions or page numbers; locate quotes ourselves.**
> The AI analysis engine is permitted to return *only* verbatim quote strings. Our application code locates each quote in the canonical document text, computes exact character offsets (`start`, `end`), maps them to document pages, and verifies that the text exists verbatim in the contract. If the code cannot locate the quote, it is marked as `unverified` and no misleading citation link is created.

---

## 2. Verification Architecture & Algorithm

The quote verification engine is implemented as a deterministic, framework-free TypeScript pipeline in [`lib/quotes`](file:///c:/Users/acer/Desktop/clauselens/lib/quotes).

```
                      Raw Quote String (from AI)
                                  │
                                  ▼
                    [ stripSurroundingQuotes() ]
                                  │
                   Contains "..." or "…"?
                   ┌──────────────┴──────────────┐
                  Yes                            No
                   │                             │
                   ▼                             ▼
        [ verifyEllipsisQuote() ]     [ normalizeWithMap() ]
        - Split on ellipsis           - NFKC, lowercase
        - Find each segment           - Quotes: “ ” „ ‘ ’ -> " '
        - Verify sequential order     - Dashes: – — ― − -> -
        - Bound window <= 1500 chars  - Ligatures: ﬁ, ﬂ, æ, œ
                                      - Line-break hyphenation repair
                                      - Collapse & trim whitespace
                                      - Map norm index -> orig index
                                                 │
                                                 ▼
                                        Pass 1: Substring Search
                                        (Norm Quote in Norm Doc)
                                                 │
                                           Found match?
                                           ┌─────┴─────┐
                                          Yes          No
                                           │           │
                                           │           ▼
                                           │  Pass 2: Whitespace-Removed
                                           │  (Letter-for-letter match)
                                           │           │
                                           │     Found match?
                                           │     ┌─────┴─────┐
                                           │    Yes          No
                                           │     │           │
                                           ▼     ▼           ▼
                                   [ Length & Defined   [ Mark Unverified ]
                                      Term Check ]      - reason: "not found"
                                   - <4 words / <20ch   - debug closestPassage
                                     -> "too short"
                                   - Defined term ok
                                     if count === 1
                                           │
                                           ▼
                                    [ Map to Pages ]
                                   - startOffset, endOffset
                                   - pageStart, pageEnd
                                   - crossesPageBreak
                                   - ambiguous: count > 1
```

### Step 1: Normalization with Character Index Mapping (`normalizeWithMap`)
Before comparison, text is normalized into a canonical representation while preserving an integer array `map: number[]` where `map[i]` is the exact index of character `i` in the **original un-normalized text**:
- **Unicode Normalization**: NFKC decomposition and recomposition.
- **Case Folding**: Full lowercase conversion. Preserves non-cased scripts like Arabic, Hebrew, and CJK intact.
- **Quotation Mark Harmonization**: Curly double quotes (`“`, `”`, `„`, `‟`, `″`, `«`, `»`) are straight double quotes (`"`). Curly single quotes (`‘`, `’`, `‚`, `‛`, `′`, `` ` ``) are straight single quotes (`'`).
- **Dash Normalization**: En dash (`–`), em dash (`—`), horizontal bar (`―`), minus sign (`−`), and non-breaking hyphens (`‑`) normalize to standard hyphen (`-`).
- **Zero-Width & Invisible Characters**: Soft hyphens (`\u00AD`), zero-width spaces (`\u200B`), zero-width joiners/non-joiners, and BOM markers (`\uFEFF`) are stripped without disturbing character mapping.
- **Ligature Expansion**: Standard ligatures (`ﬁ` -> `fi`, `ﬂ` -> `fl`, `ﬀ` -> `ff`, `ﬃ` -> `ffi`, `ﬄ` -> `ffl`, `œ` -> `oe`, `æ` -> `ae`) are expanded with both expanded characters pointing to the original ligature offset.
- **Line-Break Hyphenation Repair**: Contract text frequently breaks words across lines (e.g. `"agree-\nment"` or `"termi-\r\nnation"`). If a hyphen occurs between letters followed by a line break and optional indentation, the hyphen and break are repaired into a continuous word (`"agreement"`), preserving original character offsets.
- **Whitespace Collapsing & Trimming**: Multiple consecutive spaces, tabs, newlines, and non-breaking spaces (`\u00A0`) are collapsed to a single space `' '` and trimmed.

### Step 2: Pass 1 — Normalized Substring Search
The normalized quote is searched across the normalized document text.
For every match:
- `startOffset = docMap[matchStart]`
- `lastOrigIdx = docMap[matchEnd - 1]`
- `endOffset = lastOrigIdx + charLen`
This maps directly back to the original text code-units such that:
$$\text{normalize}(\text{originalText.slice}(\text{startOffset}, \text{endOffset})) \equiv \text{quote}$$

### Step 3: Pass 2 — Whitespace-Removed Comparison
If Pass 1 returns zero occurrences (for example, if document extraction split a word like `"con tract"` or compressed spacing):
- All whitespace is removed from both the normalized document and the normalized quote.
- An exact **letter-for-letter** match is required.
- Matches are mapped back through `docNoWsMap` to the original text offsets.
- **Strict Invariant**: No fuzzy or approximate matching is performed. Any character substitution or deletion immediately fails.

### Step 4: Ellipsis Support
When an AI response includes an ellipsis (`"..."` or `"…"`):
- The quote is split into ordered sub-segments.
- Each segment must independently verify in the document.
- The engine enforces that all segments appear in strict sequential order within a bounded window ($\le 1,500$ characters).
- The span from the start of the first segment to the end of the last segment is returned as the occurrence range.
- If segments appear out of order or exceed the 1,500 character window, the quote is marked `unverified`.

### Step 5: Short Quote & Defined Term Guardrails
Quotes shorter than 4 words or 20 normalized characters are rejected with reason `"too short to verify"`.
- **Exception**: Capitalized or Title-Cased defined terms (e.g. `"Confidential Information"`, `"Proprietary Rights"`, `"Effective Date"`) that occur **exactly once** in the entire document are permitted.
- If a short defined term occurs multiple times, it is marked `unverified` due to ambiguity.

### Step 6: Ambiguity Flagging
If a verified quote occurs more than once in the document, all occurrences are returned and the quote is flagged with `ambiguous: true`. The UI displays all matched passages and allows the user to step through each occurrence.

### Step 7: Page & Break Resolution (`lib/quotes/pages.ts`)
Given the verified character offsets and the document's `pages` table:
- Resolves `pageStart` and `pageEnd`.
- Sets `crossesPageBreak: true` if the quote spans across consecutive pages.

---

## 3. Honest List of Failure Modes & Edge Cases

While the quote verification algorithm ensures 100% precision against hallucinations, there are specific document artifacts and extraction anomalies where verification can fail:

| Failure Mode | Root Cause | Impact | Mitigation / System Behavior |
| :--- | :--- | :--- | :--- |
| **1. Tables Flattened by Extraction** | When PDF or DOCX extraction linearizes multi-column tables, cell contents may appear out of sequence or intermingled across columns. | A quote that reads across two table columns horizontally will not match the vertically linearized document text. | The quote is marked `unverified`. In DOCX, block IDs preserve paragraph order; in PDF, bounding box sorting preserves reading order where possible. |
| **2. OCR & Scanning Errors** | In scanned PDFs, OCR engines misread characters (e.g. recognizing `"rn"` as `"m"`, `"cl"` as `"d"`, `"1"` as `"l"`, or `"0"` as `"O"`). | Because ClauseLens strictly forbids fuzzy matching, an OCR typo in the canonical text prevents matching a correctly spelled quote. | The quote is marked `unverified` with reason `"not found in document (possibly paraphrased)"`. The debug closest passage helps identify OCR discrepancies. |
| **3. Text Embedded in Raster Images** | Diagrams, organizational charts, flowcharts, signatures, or stamped exhibits embedded as bitmaps contain text invisible to text extraction. | Quotes from scanned diagrams cannot be extracted and therefore cannot be verified. | Document extraction flags scanned/empty pages with clear warnings. |
| **4. Quotes Stitched from Distant Locations** | An LLM may combine phrases from Section 1.1 (Page 2) and Section 14.5 (Page 22) into a single continuous sentence without inserting an ellipsis (`...`). | The engine looks for contiguous text or bounded ellipsis ($\le 1,500$ chars) and rejects multi-page stitches. | The engine returns `unverified`. System prompts explicitly instruct the AI to use `"..."` when omitting text. |
| **5. Running Headers & Footers Mid-Sentence** | In PDFs, repeating headers, footers, or page numbers often interrupt sentences across page boundaries (e.g. `"shall pay all [CONFIDENTIAL - PAGE 12] valid invoices"`). | Contiguous matching across the page break fails if the header/footer text is extracted inline. | Pass 2 (whitespace removal) handles minor spacing gaps; shared pageText extraction filters isolated running headers. |
| **6. Very Short Boilerplate Ambiguity** | Phrases like `"written notice"`, `"shall promptly"`, or `"applicable law"` may appear 40+ times in an agreement. | Short quotes can match an unintended clause elsewhere in the contract. | Enforced 4-word / 20-character minimum threshold, defined-term exception rule, and `ambiguous: true` tagging. |

---

## 4. Summary of Verification Outcomes

| Status | Conditions | UI Treatment |
| :--- | :--- | :--- |
| **`verified`** | Exact character match (Pass 1 or Pass 2) $\ge 4$ words or unique defined term | Green badge with verified shield icon. Clicking scrolls document viewer to exact character offset and highlights passage. |
| **`verified` (ambiguous)** | Found in 2 or more distinct locations | Green badge with indicator showing occurrence count (e.g. `2 matches`). Clicking toggles between occurrences. |
| **`unverified` (too short)** | $< 4$ words and $< 20$ chars, not a unique defined term | Amber badge: `"too short to verify"`. No document jump link. |
| **`unverified` (not found)** | Paraphrased, hallucinated, stitched without ellipsis, or OCR mismatch | Amber badge: `"not found in document (possibly paraphrased)"`. Optional closest passage retained for system debugging. |
