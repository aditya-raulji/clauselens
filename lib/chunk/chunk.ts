/**
 * lib/chunk/chunk.ts
 *
 * Clause-aware, structure-respecting document chunker.
 *
 * Requirements:
 *  - Splits canonical text by clause/heading structure (regexes for "1.", "1.1", "(a)",
 *    "Article", "Section", ALL-CAPS headings).
 *  - Size targets: ~1,200 chars target, hard max 1,800 chars, ~15% overlap.
 *  - Every chunk keeps startOffset/endOffset in canonical text, pageStart/pageEnd,
 *    and a sectionLabel.
 *  - Guarantee: chunk offsets cover the document with NO gaps.
 *  - chunkDocument(documentId) writes chunks to PostgreSQL chunks table and is hooked into
 *    the extraction pipeline.
 */

import { eq } from "drizzle-orm";
import { getQuotePages, PageRange } from "@/lib/quotes/pages";

export interface DocumentChunkData {
  idx: number;
  startOffset: number;
  endOffset: number;
  pageStart: number;
  pageEnd: number;
  sectionLabel: string;
  text: string;
}

interface HeadingMarker {
  offset: number;
  label: string;
}

const SECTION_KEYWORD_REGEX =
  /(?:^|\n)(?:SECTION|Section|ARTICLE|Article|CLAUSE|Clause)\s+([0-9IVXLCDM\.\-]+)[:\.\s-]*(.*?)(?=\n|$)/gi;

const NUMERIC_OUTLINE_REGEX =
  /(?:^|\n)(\d+\.[\d\.]*)\s+([A-Z][^\n]{2,60})(?=\n|$)/g;

const TOP_LEVEL_NUMERIC_REGEX =
  /(?:^|\n)(\d+\.)\s+([A-Z][^\n]{2,60})(?=\n|$)/g;

const SUBCLAUSE_REGEX =
  /(?:^|\n)(\([a-z0-9]+\))\s+([A-Z]?[^\n]{2,60})(?=\n|$)/gi;

const ALL_CAPS_HEADING_REGEX =
  /(?:^|\n)([A-Z\s\-_,.:;]{4,50})(?=\n|$)/g;

/**
 * Scans canonical text for structural headings/clauses and records their character offsets.
 */
export function extractHeadingMarkers(canonicalText: string): HeadingMarker[] {
  const markers: HeadingMarker[] = [];
  const seenOffsets = new Set<number>();

  function addMarker(offset: number, label: string) {
    const cleanLabel = label.trim().replace(/\s+/g, " ");
    if (!seenOffsets.has(offset) && cleanLabel.length > 0) {
      seenOffsets.add(offset);
      markers.push({ offset, label: cleanLabel.slice(0, 80) });
    }
  }

  // 1. Section / Article / Clause keywords
  let match: RegExpExecArray | null;
  while ((match = SECTION_KEYWORD_REGEX.exec(canonicalText)) !== null) {
    const matchedText = match[0].trim();
    addMarker(match.index, matchedText);
  }

  // 2. Numeric outlines (e.g. "1.1 Confidentiality")
  while ((match = NUMERIC_OUTLINE_REGEX.exec(canonicalText)) !== null) {
    const matchedText = match[0].trim();
    addMarker(match.index, matchedText);
  }

  // 3. Top-level numbered clauses (e.g. "1. Definitions")
  while ((match = TOP_LEVEL_NUMERIC_REGEX.exec(canonicalText)) !== null) {
    const matchedText = match[0].trim();
    addMarker(match.index, matchedText);
  }

  // 4. Subclauses (e.g. "(a) Term and Termination")
  while ((match = SUBCLAUSE_REGEX.exec(canonicalText)) !== null) {
    const matchedText = match[0].trim();
    addMarker(match.index, matchedText);
  }

  // 5. ALL-CAPS headings (e.g. "INDEMNIFICATION")
  while ((match = ALL_CAPS_HEADING_REGEX.exec(canonicalText)) !== null) {
    const candidate = match[1].trim();
    // Exclude noise, numbers, or short words
    if (
      candidate.length >= 4 &&
      candidate === candidate.toUpperCase() &&
      /[A-Z]/.test(candidate) &&
      !/^\d+$/.test(candidate)
    ) {
      addMarker(match.index, candidate);
    }
  }

  markers.sort((a, b) => a.offset - b.offset);
  return markers;
}

/**
 * Finds the nearest active section heading at or before the given offset.
 */
function findActiveHeading(
  markers: HeadingMarker[],
  offset: number
): string {
  if (markers.length === 0) return "General Provisions";

  let active = markers[0].label;
  for (const m of markers) {
    if (m.offset <= offset) {
      active = m.label;
    } else {
      break;
    }
  }
  return active;
}

/**
 * Splits canonical text into structure-respecting, overlapping chunks
 * with guaranteed gapless coverage.
 */
export function chunkCanonicalText(
  canonicalText: string,
  pagesList: PageRange[] = [],
  options: {
    targetChars?: number;
    hardMaxChars?: number;
    overlapFraction?: number;
  } = {}
): DocumentChunkData[] {
  if (!canonicalText || canonicalText.trim().length === 0) {
    return [];
  }

  const targetChars = options.targetChars ?? 1200;
  const hardMaxChars = options.hardMaxChars ?? 1800;
  const overlapFraction = options.overlapFraction ?? 0.15;
  const overlapChars = Math.round(targetChars * overlapFraction); // ~180 chars

  const totalLen = canonicalText.length;
  const headingMarkers = extractHeadingMarkers(canonicalText);

  // If text fits in a single chunk
  if (totalLen <= hardMaxChars) {
    const pageInfo = getQuotePages(
      { start: 0, end: totalLen },
      pagesList
    );
    const label = findActiveHeading(headingMarkers, 0);

    return [
      {
        idx: 0,
        startOffset: 0,
        endOffset: totalLen,
        pageStart: pageInfo.pageStart,
        pageEnd: pageInfo.pageEnd,
        sectionLabel: label,
        text: canonicalText,
      },
    ];
  }

  const chunkList: DocumentChunkData[] = [];
  let currentStart = 0;
  let chunkIdx = 0;

  while (currentStart < totalLen) {
    const remaining = totalLen - currentStart;

    // If remaining fits in hardMaxChars, take all remaining text
    if (remaining <= hardMaxChars) {
      const pageInfo = getQuotePages(
        { start: currentStart, end: totalLen },
        pagesList
      );
      const label = findActiveHeading(headingMarkers, currentStart);

      chunkList.push({
        idx: chunkIdx++,
        startOffset: currentStart,
        endOffset: totalLen,
        pageStart: pageInfo.pageStart,
        pageEnd: pageInfo.pageEnd,
        sectionLabel: label,
        text: canonicalText.slice(currentStart, totalLen),
      });
      break;
    }

    // Determine optimal breakpoint between minBound and hardMaxEnd
    const minBound = Math.min(
      totalLen,
      currentStart + Math.max(600, targetChars - 300)
    );
    const hardMaxEnd = Math.min(totalLen, currentStart + hardMaxChars);
    let chosenBreakpoint = -1;

    // 1. Look for a heading marker in the window [minBound, hardMaxEnd]
    for (const m of headingMarkers) {
      if (m.offset >= minBound && m.offset <= hardMaxEnd) {
        chosenBreakpoint = m.offset;
        break;
      }
    }

    // 2. Look for paragraph break "\n\n"
    if (chosenBreakpoint === -1) {
      const slice = canonicalText.slice(minBound, hardMaxEnd);
      const lastDoubleNewline = slice.lastIndexOf("\n\n");
      if (lastDoubleNewline !== -1) {
        chosenBreakpoint = minBound + lastDoubleNewline + 2;
      }
    }

    // 3. Look for sentence break ". " or ".\n"
    if (chosenBreakpoint === -1) {
      const slice = canonicalText.slice(minBound, hardMaxEnd);
      const periodMatches = [slice.lastIndexOf(". "), slice.lastIndexOf(".\n")];
      const bestPeriod = Math.max(...periodMatches);
      if (bestPeriod !== -1) {
        chosenBreakpoint = minBound + bestPeriod + 2;
      }
    }

    // 4. Look for single newline "\n"
    if (chosenBreakpoint === -1) {
      const slice = canonicalText.slice(minBound, hardMaxEnd);
      const lastNewline = slice.lastIndexOf("\n");
      if (lastNewline !== -1) {
        chosenBreakpoint = minBound + lastNewline + 1;
      }
    }

    // 5. Look for space " "
    if (chosenBreakpoint === -1) {
      const slice = canonicalText.slice(minBound, hardMaxEnd);
      const lastSpace = slice.lastIndexOf(" ");
      if (lastSpace !== -1) {
        chosenBreakpoint = minBound + lastSpace + 1;
      }
    }

    // 6. Fallback to targetChars or hardMaxEnd
    if (chosenBreakpoint === -1) {
      chosenBreakpoint = Math.min(totalLen, currentStart + targetChars);
    }

    const currentEnd = Math.min(totalLen, chosenBreakpoint);
    const pageInfo = getQuotePages(
      { start: currentStart, end: currentEnd },
      pagesList
    );
    const label = findActiveHeading(headingMarkers, currentStart);

    chunkList.push({
      idx: chunkIdx++,
      startOffset: currentStart,
      endOffset: currentEnd,
      pageStart: pageInfo.pageStart,
      pageEnd: pageInfo.pageEnd,
      sectionLabel: label,
      text: canonicalText.slice(currentStart, currentEnd),
    });

    if (currentEnd >= totalLen) {
      break;
    }

    // Next chunk starts with ~15% overlap
    // To ensure gapless coverage and guaranteed forward progress:
    // nextStart must be strictly < currentEnd and strictly > currentStart.
    const desiredNextStart = currentEnd - overlapChars;
    const nextStart = Math.min(
      currentEnd - 1,
      Math.max(currentStart + 100, desiredNextStart)
    );

    currentStart = nextStart;
  }

  return chunkList;
}

/**
 * DB Hook: Reads canonical text & pages for documentId, splits into chunks,
 * persists to chunks table, and returns the chunk list.
 */
export async function chunkDocument(
  documentId: string
): Promise<DocumentChunkData[]> {
  const { db } = await import("@/lib/db");
  const { documents, pages, chunks } = await import("@/lib/schema");

  // 1. Fetch document canonical text
  const [doc] = await db
    .select({
      id: documents.id,
      canonicalText: documents.canonicalText,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc || !doc.canonicalText) {
    return [];
  }

  // 2. Fetch pages for offset-to-page mapping
  const docPages = await db
    .select({
      pageNumber: pages.pageNumber,
      startOffset: pages.startOffset,
      endOffset: pages.endOffset,
    })
    .from(pages)
    .where(eq(pages.documentId, documentId));

  // 3. Compute chunks
  const chunkList = chunkCanonicalText(doc.canonicalText, docPages);
  if (chunkList.length === 0) {
    return [];
  }

  // 4. Delete existing chunks for idempotent re-runs
  await db.delete(chunks).where(eq(chunks.documentId, documentId));

  // 5. Insert new chunks in batches
  const chunkRows = chunkList.map((c) => ({
    documentId,
    idx: c.idx,
    startOffset: c.startOffset,
    endOffset: c.endOffset,
    pageStart: c.pageStart,
    pageEnd: c.pageEnd,
    sectionLabel: c.sectionLabel,
    text: c.text,
  }));

  const BATCH_SIZE = 150;
  for (let i = 0; i < chunkRows.length; i += BATCH_SIZE) {
    await db.insert(chunks).values(chunkRows.slice(i, i + BATCH_SIZE));
  }

  return chunkList;
}
