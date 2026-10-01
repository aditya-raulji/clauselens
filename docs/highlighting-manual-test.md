# Highlighting Manual Test Checklist

This checklist covers the visual highlighting feature on the `/documents/[id]` viewer page. Run through it manually after each significant change to the PDF or DOCX viewer components.

---

## Setup

1. Open ClauseLens locally (`npm run dev`).
2. Upload a multi-page PDF contract and a multi-section DOCX contract.
3. Run a chat analysis on each to generate verified quotes.
4. Click **"Open in document"** on any verified citation in the chat.

---

## Test Cases

### T1 — Single-line quote (PDF)

**Scenario**: A citation that spans one line on a single page.

**Steps**:
1. From the chat sidebar, click a short verified quote (< 10 words).
2. The viewer should auto-scroll to that page.

**Expected**:
- [ ] Orange highlight rectangle appears over the exact text (not the entire line).
- [ ] The `QuoteNavigatorBar` shows `Occurrence 1 of 1`.
- [ ] `Page X of N` indicator in the header updates to the correct page.
- [ ] Pressing `Esc` clears the highlight.

---

### T2 — Multi-line quote (PDF)

**Scenario**: A citation that wraps across two or more lines on the same page.

**Steps**:
1. Find a longer verified quote (30–60 words). Click "Open in document."

**Expected**:
- [ ] Multiple horizontal highlight rectangles appear, one per visual line.
- [ ] Rects on the same visual line are merged into a single rectangle (no hairlines between words).
- [ ] Viewer scrolls so the first rect is centered in the viewport.
- [ ] Re-zooming (ZoomIn / ZoomOut) recalculates and redraws all rects correctly.

---

### T3 — Cross-page quote (PDF)

**Scenario**: A citation that begins on one page and continues on the next.

**Steps**:
1. Locate or craft a query that returns a citation whose `crossesPageBreak` is `true`.
2. Click "Open in document."

**Expected**:
- [ ] Highlights appear on both pages (partial rect at the bottom of Page N, and partial rect at the top of Page N+1).
- [ ] Auto-scroll targets the first rect (bottom of Page N).
- [ ] The `QuoteNavigatorBar` shows the correct start page.

---

### T4 — Duplicate quote (multiple occurrences, PDF)

**Scenario**: A legal phrase that appears multiple times in the document (e.g., "Confidential Information").

**Steps**:
1. Find a verified quote with `ambiguous: true` and `occurrences.length > 1`.
2. Click "Open in document."

**Expected**:
- [ ] `Occurrence 1 of N` badge shows the correct count.
- [ ] First occurrence is highlighted in **stronger orange** (`bg-[#F97316]/35` + `border-2`).
- [ ] All other occurrences show **subtle orange** (`bg-[#F97316]/20` + `border`).
- [ ] Clicking `▶ Next` cycles to the next occurrence and scrolls there.
- [ ] Clicking `◀ Prev` cycles back. Counter always stays in `[1..N]`.
- [ ] After reaching the last, wraps back to the first.

---

### T5 — DOCX table-cell quote

**Scenario**: A citation from inside a table cell in a DOCX document.

**Steps**:
1. Upload a DOCX with a table (e.g., a schedule or exhibit table).
2. Ask a question about the table content to get a verified quote.
3. Click "Open in document."

**Expected**:
- [ ] The `<mark data-cite>` element appears wrapping the correct text *inside the table cell*.
- [ ] Surrounding cells are not highlighted.
- [ ] If the quote spans multiple cells, each cell's relevant text is independently wrapped.
- [ ] Auto-scrolls to the first `<mark>`.

---

### T6 — Visual mapping failure fallback

**Scenario**: Force a situation where the DOM cannot locate the text.

**Steps**:
1. Open the browser console.
2. In a temporary test, pass a fake offset range that doesn't overlap any rendered text items.

**Expected**:
- [ ] A toast notification appears: `"Couldn't locate this visually"`.
- [ ] The `FallbackExcerptDialog` opens automatically, showing ~600 chars of surrounding canonical text.
- [ ] The quoted passage is highlighted with an orange `<mark>` inside the excerpt.
- [ ] The dialog shows the canonical offset range (e.g., `Offsets 4500–4612`).
- [ ] Clicking **"Passage View"** in the `QuoteNavigatorBar` also opens this dialog at any time.

---

### T7 — Zoom + Re-render consistency (PDF)

**Steps**:
1. Load a verified quote so a highlight appears.
2. Click ZoomIn several times (up to 200%).
3. Click ZoomOut back to 100%.

**Expected**:
- [ ] Highlight rectangles re-calculate and match the re-scaled text positions at each zoom level.
- [ ] Canvas and text layer dimensions are correctly updated on each zoom change.
- [ ] No stale highlights from the previous zoom level persist.

---

### T8 — Keyboard Escape clears highlight

**Steps**:
1. Activate any verified quote highlight.
2. Press the `Escape` key.

**Expected**:
- [ ] All highlight rectangles (PDF) or `<mark>` elements (DOCX) disappear immediately.
- [ ] The `QuoteNavigatorBar` collapses/disappears.
- [ ] The `activeTarget` resets; clicking another citation activates a fresh highlight.

---

### T9 — Side panel collapse / expand

**Steps**:
1. Click the `PanelRight` toggle button in the top header.
2. Collapse and then re-expand the panel.

**Expected**:
- [ ] Panel collapses to a narrow 48px strip with a collapsed indicator.
- [ ] Expanding restores the full 320–384px panel width.
- [ ] The orange dot on the toggle indicates whether there are active quotes.
- [ ] All citation cards remain intact and selectable when re-expanded.

---

## Regression Checks

After all test cases pass, confirm:

- [ ] `npm test -- --run` passes (all 130+ tests).
- [ ] `npm run build` succeeds with zero TypeScript errors.
- [ ] No `.env*` files staged in `git status`.
