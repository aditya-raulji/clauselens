import { BlockOffset } from "./types";

/**
 * Parses embedded block offsets JSON from DOCX html_content.
 */
export function parseBlockOffsets(html: string): BlockOffset[] {
  if (!html) return [];

  const scriptMatch = html.match(
    /<script[^>]*id=["']block-offsets["'][^>]*>([\s\S]*?)<\/script>/i
  );

  if (scriptMatch && scriptMatch[1]) {
    try {
      return JSON.parse(scriptMatch[1].trim());
    } catch {
      // Fall through to attribute scan
    }
  }

  return [];
}

/**
 * Removes any existing citation highlight marks from the DOCX container
 * and normalizes the text nodes.
 */
export function cleanUpMarks(container: HTMLElement): void {
  if (!container) return;

  const marks = container.querySelectorAll("mark[data-cite]");
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (parent) {
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      parent.normalize();
    }
  });
}

/**
 * Highlights a canonical text range [start, end) inside a rendered DOCX container
 * across all overlapping blocks (paragraphs, headers, list items, table cells).
 * Returns the created <mark> elements.
 */
export function highlightDocxRange(
  container: HTMLElement,
  blockOffsets: BlockOffset[],
  start: number,
  end: number,
  isSelected: boolean = true
): HTMLElement[] {
  if (!container || !blockOffsets || blockOffsets.length === 0 || end <= start) {
    return [];
  }

  const createdMarks: HTMLElement[] = [];

  for (const block of blockOffsets) {
    // Check if canonical range overlaps with this block
    if (block.end <= start || block.start >= end) {
      continue;
    }

    const blockEl = container.querySelector(
      `[data-block="${block.id}"]`
    ) as HTMLElement | null;

    if (!blockEl) {
      continue;
    }

    // Offset relative to the block's text
    const blockLocalStart = Math.max(0, start - block.start);
    const blockLocalEnd = Math.min(block.end - block.start, end - block.start);

    if (blockLocalStart >= blockLocalEnd) {
      continue;
    }

    // Collect all Text nodes within blockEl
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(
      blockEl,
      NodeFilter.SHOW_TEXT,
      null
    );

    let node: Node | null;
    while ((node = walker.nextNode())) {
      textNodes.push(node as Text);
    }

    if (textNodes.length === 0) {
      continue;
    }

    // Traverse text nodes and identify sub-spans
    let currentOffset = 0;

    for (const tNode of textNodes) {
      const nodeText = tNode.textContent || "";
      const nodeLen = nodeText.length;
      const nodeStart = currentOffset;
      const nodeEnd = currentOffset + nodeLen;
      currentOffset += nodeLen;

      // Check overlap with blockLocalStart..blockLocalEnd
      if (nodeEnd <= blockLocalStart || nodeStart >= blockLocalEnd) {
        continue;
      }

      const spanStartInNode = Math.max(0, blockLocalStart - nodeStart);
      const spanEndInNode = Math.min(nodeLen, blockLocalEnd - nodeStart);

      if (spanStartInNode < spanEndInNode) {
        try {
          const range = document.createRange();
          range.setStart(tNode, spanStartInNode);
          range.setEnd(tNode, spanEndInNode);

          const mark = document.createElement("mark");
          mark.setAttribute("data-cite", "true");
          mark.className = isSelected
            ? "bg-[#F97316]/40 border-b-2 border-[#F97316] text-inherit rounded-xs px-0.5 transition-colors"
            : "bg-[#F97316]/20 border-b border-[#F97316]/50 text-inherit rounded-xs px-0.5 transition-colors";

          range.surroundContents(mark);
          createdMarks.push(mark);
        } catch {
          // If surroundContents fails due to complex DOM boundary, gracefully continue
        }
      }
    }
  }

  return createdMarks;
}
