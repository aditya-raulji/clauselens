import mammoth from "mammoth";
import { ExtractedDocument, ExtractedPage } from "./types";

/**
 * Extract canonical text, annotated HTML, and synthetic page boundaries from DOCX.
 *
 * AGENTS.md invariants:
 *  - Every block element (p, h1-h6, li, td, th) gets a data-block attribute with
 *    a sequential ID so the browser viewer can map offsets back to DOM nodes.
 *  - canonical_text is derived from the same blocks (joined by "\n") so offsets
 *    between HTML viewer and canonical text are consistent.
 *  - Per-block start/end offsets are stored as a JSON in the htmlContent (embedded
 *    as a <script id="block-offsets" type="application/json"> at the end).
 *  - Empty or corrupt DOCX: clear human-readable errors.
 */

const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th"]);
const CHARS_PER_VIRTUAL_PAGE = 2800;

interface BlockOffset {
  id: string;
  start: number;
  end: number;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

/**
 * Parse mammoth HTML into blocks with stable IDs; derive canonical text + offsets.
 */
function processHtml(rawHtml: string): {
  annotatedHtml: string;
  canonicalText: string;
  blockOffsets: BlockOffset[];
} {
  // We do a simple, zero-dependency tag scan rather than a full DOM parse
  // (stays Node-compatible and avoids jsdom bundle size)
  const blockOffsets: BlockOffset[] = [];
  let blockId = 0;
  let canonicalText = "";

  // Replace every block-level opening tag with annotated version
  const annotatedHtml = rawHtml.replace(
    /<(p|h[1-6]|li|td|th)(\s[^>]*)?>[\s\S]*?<\/\1>/gi,
    (match, tag) => {
      const id = `b${blockId++}`;
      // Extract inner text of this block
      const innerText = stripHtml(match).replace(/\s+/g, " ").trim();
      if (innerText) {
        const start = canonicalText.length;
        if (canonicalText.length > 0) canonicalText += "\n";
        canonicalText += innerText;
        const end = canonicalText.length;
        blockOffsets.push({ id, start, end });
      }
      // Inject data-block id into the opening tag
      return match.replace(
        new RegExp(`^<${tag}(\\s[^>]*)?>`,"i"),
        (openTag) => {
          if (openTag.endsWith("/>")) {
            return openTag.slice(0, -2) + ` data-block="${id}"/>`;
          }
          return openTag.slice(0, -1) + ` data-block="${id}">`;
        }
      );
    }
  );

  return { annotatedHtml, canonicalText, blockOffsets };
}

export async function extractDocx(buffer: Buffer | Uint8Array): Promise<ExtractedDocument> {
  const nodeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  let htmlResult: { value: string; messages: any[] };
  try {
    htmlResult = await mammoth.convertToHtml({ buffer: nodeBuffer });
  } catch (err: any) {
    const msg = (err?.message || "").toLowerCase();
    if (msg.includes("corrupt") || msg.includes("invalid") || msg.includes("zip")) {
      throw new Error(
        "This DOCX file appears to be corrupted. Please check the file and re-upload."
      );
    }
    throw new Error(`Could not open DOCX: ${err?.message || "Unknown error"}`);
  }

  const rawHtml = htmlResult.value || "";

  if (!rawHtml || rawHtml.trim().length < 10) {
    throw new Error(
      "No readable content could be extracted from this DOCX. The file may be empty, corrupted, or contain only images."
    );
  }

  const { annotatedHtml, canonicalText, blockOffsets } = processHtml(rawHtml);

  if (!canonicalText || canonicalText.trim().length === 0) {
    throw new Error(
      "No readable text was found in this DOCX. It may contain only images or formatting."
    );
  }

  // Embed block offsets JSON at end of HTML so the viewer can load them
  const offsetJson = JSON.stringify(blockOffsets);
  const htmlContent =
    annotatedHtml +
    `\n<script id="block-offsets" type="application/json">${offsetJson}</script>`;

  // Build synthetic virtual pages from canonical text by paragraph boundaries
  const pages: ExtractedPage[] = [];
  const paragraphs = canonicalText.split("\n");

  let currentPageNum = 1;
  let currentPageChars = 0;
  let pageStartInCanonical = 0;
  let offsetInCanonical = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const paraLen = para.length + (i < paragraphs.length - 1 ? 1 : 0); // +1 for \n

    if (
      currentPageChars + paraLen > CHARS_PER_VIRTUAL_PAGE &&
      currentPageChars > 0
    ) {
      // flush current page
      pages.push({
        pageNumber: currentPageNum,
        startOffset: pageStartInCanonical,
        endOffset: offsetInCanonical,
        text: canonicalText.slice(pageStartInCanonical, offsetInCanonical),
      });
      currentPageNum++;
      pageStartInCanonical = offsetInCanonical;
      currentPageChars = 0;
    }

    currentPageChars += paraLen;
    offsetInCanonical += paraLen;
  }

  // Flush last page
  if (currentPageChars > 0 || pages.length === 0) {
    pages.push({
      pageNumber: currentPageNum,
      startOffset: pageStartInCanonical,
      endOffset: canonicalText.length,
      text: canonicalText.slice(pageStartInCanonical),
    });
  }

  return {
    canonicalText,
    pageCount: pages.length,
    pages,
    htmlContent,
  };
}
