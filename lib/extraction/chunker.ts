import { DocumentChunk, ExtractedPage } from "./types";

/**
 * Determine pageStart and pageEnd for an offset span [startOffset, endOffset]
 */
function findPageRange(
  pages: ExtractedPage[],
  startOffset: number,
  endOffset: number
): { pageStart: number; pageEnd: number } {
  if (pages.length === 0) {
    return { pageStart: 1, pageEnd: 1 };
  }

  let pageStart = pages[0].pageNumber;
  let pageEnd = pages[pages.length - 1].pageNumber;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    // Check if startOffset falls into or before this page
    if (startOffset >= page.startOffset && startOffset <= page.endOffset) {
      pageStart = page.pageNumber;
      break;
    }
    if (startOffset < page.startOffset) {
      pageStart = page.pageNumber;
      break;
    }
  }

  for (let i = pages.length - 1; i >= 0; i--) {
    const page = pages[i];
    // Check if endOffset falls into or after this page
    if (endOffset >= page.startOffset && endOffset <= page.endOffset) {
      pageEnd = page.pageNumber;
      break;
    }
    if (endOffset > page.endOffset) {
      pageEnd = page.pageNumber;
      break;
    }
  }

  return { pageStart, pageEnd: Math.max(pageStart, pageEnd) };
}

/**
 * Detect section label from text
 */
function detectSectionHeader(text: string): string | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const firstLine = lines[0];

  // Pattern: Section 1.2 / Article IV / Clause 5
  const sectionPattern =
    /^(?:SECTION|Section|ARTICLE|Article|CLAUSE|Clause)\s+([0-9IVXLCDM\.\-]+)[:\.\s-]*(.*)$/i;
  const match = firstLine.match(sectionPattern);
  if (match) {
    const title = match[2]?.trim();
    return title ? `${match[0].slice(0, 30)}` : match[0];
  }

  // Pattern: 1.1 Heading or 2. Confidentiality
  const numPattern = /^(\d+\.[\d\.]*)\s+([A-Z][A-Za-z0-9\s,\-]{2,40})$/;
  const numMatch = firstLine.match(numPattern);
  if (numMatch) {
    return numMatch[0];
  }

  // Pattern: ALL CAPS HEADING (e.g. INDEMNIFICATION, TERMINATION)
  if (
    firstLine.length >= 4 &&
    firstLine.length <= 40 &&
    firstLine === firstLine.toUpperCase() &&
    /^[A-Z\s\-_,.]+$/.test(firstLine)
  ) {
    return firstLine;
  }

  return null;
}

/**
 * Chunk canonical contract text into semantic sections with offset and page references
 */
export function chunkDocument(
  canonicalText: string,
  pages: ExtractedPage[],
  targetChunkChars = 2400,
  overlapChars = 200
): DocumentChunk[] {
  if (!canonicalText || canonicalText.trim().length === 0) {
    return [];
  }

  const chunks: DocumentChunk[] = [];
  const totalLength = canonicalText.length;

  let currentStart = 0;
  let chunkIndex = 0;
  let currentSectionLabel = "General / Preamble";

  while (currentStart < totalLength) {
    let idealEnd = Math.min(totalLength, currentStart + targetChunkChars);

    // If we're not at the very end of text, attempt to break on paragraph or sentence
    if (idealEnd < totalLength) {
      const searchWindow = canonicalText.substring(
        Math.max(currentStart, idealEnd - 400),
        Math.min(totalLength, idealEnd + 200)
      );

      // Look for double newline (paragraph break) first
      const doubleNewlineIdx = searchWindow.lastIndexOf("\n\n");
      if (doubleNewlineIdx !== -1) {
        idealEnd = Math.max(currentStart, idealEnd - 400) + doubleNewlineIdx + 2;
      } else {
        // Look for period followed by space or newline
        const sentenceMatch = searchWindow.match(/\.\s+/g);
        if (sentenceMatch) {
          const lastSentenceIdx = searchWindow.lastIndexOf(". ");
          if (lastSentenceIdx !== -1) {
            idealEnd = Math.max(currentStart, idealEnd - 400) + lastSentenceIdx + 2;
          }
        }
      }
    }

    const chunkText = canonicalText.substring(currentStart, idealEnd).trim();
    if (chunkText.length > 0) {
      // Check if this chunk introduces a new section header
      const detectedHeader = detectSectionHeader(chunkText);
      if (detectedHeader) {
        currentSectionLabel = detectedHeader;
      }

      const { pageStart, pageEnd } = findPageRange(pages, currentStart, idealEnd);

      chunks.push({
        idx: chunkIndex++,
        startOffset: currentStart,
        endOffset: idealEnd,
        pageStart,
        pageEnd,
        sectionLabel: currentSectionLabel,
        text: chunkText,
      });
    }

    if (idealEnd >= totalLength) {
      break;
    }

    // Advance start with overlap
    currentStart = Math.max(currentStart + 1, idealEnd - overlapChars);
  }

  return chunks;
}
