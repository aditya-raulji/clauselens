import { buildPageText, PageTextItem } from "@/lib/extract/pageText";
import { TextItemOffset, HighlightRect } from "./types";

export interface ItemSpanSlice {
  itemIndex: number;
  sliceStart: number;
  sliceEnd: number;
}

/**
 * Builds page text using the canonical buildPageText() function and
 * maps each text content item to its [start, end) index within that text.
 */
export function buildPageTextWithOffsets(items: PageTextItem[]): {
  text: string;
  items: TextItemOffset[];
} {
  const canonical = buildPageText(items);
  if (!canonical || !items || items.length === 0) {
    return { text: canonical, items: [] };
  }

  const result: TextItemOffset[] = [];
  let searchPos = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.str || item.str.length === 0) {
      continue;
    }

    const itemStr = item.str;

    // 1. Direct exact search from searchPos
    let idx = canonical.indexOf(itemStr, searchPos);

    // 2. If not found, try trimmed
    if (idx === -1) {
      const trimmed = itemStr.trim();
      if (trimmed.length > 0) {
        idx = canonical.indexOf(trimmed, searchPos);
      }
    }

    // 3. If still not found, search with collapsed internal whitespace
    if (idx === -1) {
      const collapsed = itemStr.replace(/\s+/g, " ").trim();
      if (collapsed.length > 0) {
        idx = canonical.indexOf(collapsed, searchPos);
      }
    }

    // 4. If found ahead, record the span and advance searchPos
    if (idx !== -1) {
      const spanLen = itemStr.length;
      result.push({
        itemIndex: i,
        start: idx,
        end: idx + spanLen,
        str: itemStr,
      });
      searchPos = idx + spanLen;
    }
  }

  return { text: canonical, items: result };
}

/**
 * Given the item offsets for a page, returns which text items overlap with
 * the range [targetStart, targetEnd) and the [sliceStart, sliceEnd) within each item's string.
 */
export function findOverlappingItemSlices(
  items: TextItemOffset[],
  targetStart: number,
  targetEnd: number
): ItemSpanSlice[] {
  if (targetEnd <= targetStart || !items || items.length === 0) {
    return [];
  }

  const slices: ItemSpanSlice[] = [];

  for (const item of items) {
    if (item.end <= targetStart || item.start >= targetEnd) {
      continue;
    }

    const sliceStart = Math.max(0, targetStart - item.start);
    const sliceEnd = Math.min(item.str.length, targetEnd - item.start);

    if (sliceStart < sliceEnd) {
      slices.push({
        itemIndex: item.itemIndex,
        sliceStart,
        sliceEnd,
      });
    }
  }

  return slices;
}

/**
 * Merges bounding rectangles that are on the same line to avoid fragmented highlight borders.
 */
export function mergeBoundingRects(rects: HighlightRect[]): HighlightRect[] {
  if (!rects || rects.length <= 1) {
    return rects || [];
  }

  // Sort top-to-bottom, then left-to-right
  const sorted = [...rects].sort((a, b) => {
    if (Math.abs(a.top - b.top) > 4) {
      return a.top - b.top;
    }
    return a.left - b.left;
  });

  const merged: HighlightRect[] = [];
  let current = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    const sameLine = Math.abs(current.top - next.top) <= 4;
    const currentRight = current.left + current.width;
    // Overlapping or adjacent horizontally (within 6px gap)
    const touchesHorizontally = next.left <= currentRight + 6;

    if (sameLine && touchesHorizontally) {
      const newRight = Math.max(currentRight, next.left + next.width);
      const newTop = Math.min(current.top, next.top);
      const newBottom = Math.max(current.top + current.height, next.top + next.height);

      current.left = Math.min(current.left, next.left);
      current.top = newTop;
      current.width = newRight - current.left;
      current.height = newBottom - newTop;
    } else {
      merged.push(current);
      current = { ...next };
    }
  }

  merged.push(current);
  return merged;
}
