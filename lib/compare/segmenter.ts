import { ClauseSegment } from "./types";

/**
 * Segmentation patterns for legal contracts:
 * - Articles / Sections: "Article 1", "ARTICLE I", "Section 1.1", "Sec. 2"
 * - Numeric / Nested: "1.", "1.1", "1.1.1", "(1)", "1)"
 * - Alphabetic clauses: "(a)", "(b)", "(i)", "(ii)", "a."
 */
const CLAUSE_HEADER_REGEX =
  /^(?:(?:article|section|sec\.|clause)\s+([0-9ivxlcdm]+(?:\.[0-9]+)*)|(\([0-9ivxlcdm]+\))|([0-9]+(?:\.[0-9]+)+|\b[0-9]+\.)|(\([a-z]\))|([a-z]\.))\b/i;

/**
 * Splits canonical contract text into segmented clauses with character offsets.
 */
export function segmentContract(canonicalText: string): ClauseSegment[] {
  if (!canonicalText || canonicalText.trim().length === 0) {
    return [];
  }

  // Split text by lines while tracking character offsets
  const lines = canonicalText.split("\n");
  const segments: ClauseSegment[] = [];

  let currentLabel = "Preamble";
  let currentLines: string[] = [];
  let currentStart = 0;
  let runningOffset = 0;
  let segmentIndex = 0;

  function flushSegment(endOffset: number) {
    const rawText = currentLines.join("\n").trim();
    if (rawText.length > 0) {
      // Find actual start and end after trim
      const leadingSpaces = currentLines.join("\n").match(/^\s*/)?.[0].length || 0;
      const actualStart = currentStart + leadingSpaces;
      const actualEnd = actualStart + rawText.length;

      segments.push({
        id: `seg_${segmentIndex++}`,
        label: currentLabel,
        text: rawText,
        startOffset: actualStart,
        endOffset: actualEnd,
      });
    }
    currentLines = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lineStartOffset = runningOffset;

    const match = trimmed.match(CLAUSE_HEADER_REGEX);
    // Also consider standalone all-caps headings like "TERMINATION FOR CONVENIENCE"
    const isAllCapsHeading =
      trimmed.length >= 4 &&
      trimmed.length <= 60 &&
      trimmed === trimmed.toUpperCase() &&
      !trimmed.endsWith(".") &&
      /^[A-Z0-9\s,\-_:;]+$/.test(trimmed);

    if (match || isAllCapsHeading) {
      // Found a new clause header
      if (currentLines.length > 0) {
        flushSegment(lineStartOffset);
      }

      currentStart = lineStartOffset;
      if (match) {
        // e.g. "Section 4.1", "1.2", "(a)"
        currentLabel = match[0].trim();
        // If the header line has a title after it, e.g. "Section 4. Termination"
        const remainder = trimmed.slice(match[0].length).trim();
        if (remainder.length > 0 && remainder.length <= 50 && !remainder.includes(".")) {
          currentLabel += ` ${remainder}`;
        }
      } else {
        currentLabel = trimmed;
      }
      currentLines.push(line);
    } else if (trimmed.length === 0) {
      // Blank line: could be paragraph break if long enough
      if (currentLines.length > 0 && currentLines.join("\n").length > 300) {
        // Break paragraph
        flushSegment(lineStartOffset);
        currentLabel = `Paragraph ${segmentIndex + 1}`;
        currentStart = lineStartOffset + line.length + 1;
      } else {
        currentLines.push(line);
      }
    } else {
      if (currentLines.length === 0) {
        currentStart = lineStartOffset;
      }
      currentLines.push(line);
    }

    runningOffset += line.length + 1; // +1 for the newline
  }

  flushSegment(runningOffset);

  // If no structure was detected, fall back to non-empty paragraphs
  if (segments.length <= 1 && canonicalText.length > 500) {
    return segmentByParagraphs(canonicalText);
  }

  return segments;
}

function segmentByParagraphs(canonicalText: string): ClauseSegment[] {
  const paras = canonicalText.split(/\n\s*\n/);
  const segments: ClauseSegment[] = [];
  let offset = 0;

  for (let i = 0; i < paras.length; i++) {
    const raw = paras[i];
    const trimmed = raw.trim();
    if (!trimmed) {
      offset += raw.length + 2;
      continue;
    }

    const start = canonicalText.indexOf(trimmed, offset);
    const end = start + trimmed.length;
    offset = end;

    // Detect if first line can be a label
    const firstLine = trimmed.split("\n")[0].trim();
    let label = `Clause ${i + 1}`;
    if (firstLine.length < 50 && (firstLine.match(CLAUSE_HEADER_REGEX) || firstLine.endsWith(":"))) {
      label = firstLine;
    }

    segments.push({
      id: `seg_${i}`,
      label,
      text: trimmed,
      startOffset: start >= 0 ? start : 0,
      endOffset: end >= 0 ? end : trimmed.length,
    });
  }

  return segments;
}
