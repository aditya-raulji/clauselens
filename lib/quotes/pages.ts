/**
 * lib/quotes/pages.ts
 *
 * Maps occurrence offsets to document pages and detects page-break crossings.
 */

export interface PageRange {
  pageNumber: number;
  startOffset: number;
  endOffset: number;
}

export interface QuotePageResult {
  pageStart: number;
  pageEnd: number;
  crossesPageBreak: boolean;
}

/**
 * Given an occurrence offset span and the pages table ranges,
 * determines the start page, end page, and whether it spans across a page break.
 */
export function getQuotePages(
  occurrence: { start: number; end: number },
  pages: PageRange[]
): QuotePageResult {
  if (!pages || pages.length === 0) {
    return {
      pageStart: 1,
      pageEnd: 1,
      crossesPageBreak: false,
    };
  }

  const sortedPages = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);

  // Find pageStart
  let pageStart = sortedPages[0].pageNumber;
  for (let i = 0; i < sortedPages.length; i++) {
    const page = sortedPages[i];
    if (occurrence.start >= page.startOffset && occurrence.start <= page.endOffset) {
      pageStart = page.pageNumber;
      break;
    }
    if (occurrence.start < page.startOffset) {
      pageStart = page.pageNumber;
      break;
    }
    if (i === sortedPages.length - 1) {
      pageStart = page.pageNumber;
    }
  }

  // Find pageEnd
  // Note: end is exclusive, so the character immediately inside the quote is occurrence.end - 1
  const effectiveEnd = Math.max(occurrence.start, occurrence.end - 1);
  let pageEnd = sortedPages[sortedPages.length - 1].pageNumber;

  for (let i = 0; i < sortedPages.length; i++) {
    const page = sortedPages[i];
    if (effectiveEnd >= page.startOffset && effectiveEnd <= page.endOffset) {
      pageEnd = page.pageNumber;
      break;
    }
    if (effectiveEnd < page.startOffset) {
      pageEnd = page.pageNumber;
      break;
    }
  }

  // Ensure pageEnd >= pageStart
  pageEnd = Math.max(pageStart, pageEnd);

  return {
    pageStart,
    pageEnd,
    crossesPageBreak: pageStart !== pageEnd,
  };
}
