/**
 * lib/extract/pageText.ts
 *
 * ONE shared, framework-free function: buildPageText(items)
 *
 * Converts pdf.js TextContentItem[] into a clean page string.
 * The SAME function is imported by:
 *   - lib/extraction/pdf.ts  (Node/server-side extraction)
 *   - the browser PDF viewer (prompt 6) — ensures offsets match exactly.
 *
 * Algorithm:
 *   - Items arrive in the order pdf.js yields them (roughly top→bottom, left→right).
 *   - A Y-gap > yThreshold triggers a newline (new text line on the page).
 *   - hasEOL flag on the item forces a newline after that item.
 *   - Adjacent items on the same line get a space if neither ends/starts with one
 *     AND the horizontal gap between them (transform[4] + width) is > xGapThreshold.
 *   - Excess whitespace is collapsed; result is trimmed.
 */

export interface PageTextItem {
  /** The text string of this item */
  str: string;
  /**
   * PDF transform matrix [a, b, c, d, tx, ty].
   * tx = transform[4] (x position), ty = transform[5] (y position).
   */
  transform?: number[];
  /** Width of the text run in PDF user units */
  width?: number;
  /** pdf.js sets this true when the item ends a line */
  hasEOL?: boolean;
}

const Y_THRESHOLD = 3; // points – below this, same visual line
const X_GAP_THRESHOLD = 1; // points – above this, insert a space

/**
 * Build a page string from raw pdf.js text content items.
 * Pure function — no side-effects, no imports outside this file.
 */
export function buildPageText(items: PageTextItem[]): string {
  if (!items || items.length === 0) return "";

  let result = "";
  let lastY: number | null = null;
  let lastX: number | null = null;
  let lastWidth: number | null = null;

  for (const item of items) {
    // Skip non-text items (e.g. MarkedContent)
    if (!("str" in item) || item.str === undefined) continue;
    const str = item.str;
    if (str === "") continue;

    const ty = item.transform ? item.transform[5] : null;
    const tx = item.transform ? item.transform[4] : null;
    const w = item.width ?? null;

    if (result.length === 0) {
      // First item — just append
      result += str;
    } else if (
      lastY !== null &&
      ty !== null &&
      Math.abs(ty - lastY) > Y_THRESHOLD
    ) {
      // New visual line — insert newline
      result += "\n" + str;
    } else {
      // Same line — decide whether to insert a space
      let needSpace = false;

      if (tx !== null && lastX !== null && lastWidth !== null) {
        // Compute the expected start of this item vs end of last item
        const lastEnd = lastX + lastWidth;
        const gap = tx - lastEnd;
        needSpace = gap > X_GAP_THRESHOLD;
      }

      // Also insert space if neither end of result nor start of str has one
      if (
        !needSpace &&
        !result.endsWith(" ") &&
        !result.endsWith("\n") &&
        !str.startsWith(" ")
      ) {
        needSpace = true;
      }

      result += (needSpace ? " " : "") + str;
    }

    // Handle hasEOL — force newline after this item
    if (item.hasEOL) {
      result += "\n";
      lastY = null; // reset so next item doesn't try to compute gap vs EOL
      lastX = null;
      lastWidth = null;
      continue;
    }

    lastY = ty;
    lastX = tx;
    lastWidth = w;
  }

  // Collapse multiple spaces on same line; preserve newlines
  return result
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .trim();
}
