import mammoth from "mammoth";
import { ExtractedDocument, ExtractedPage } from "./types";

/**
 * Extract canonical text, HTML, and synthetic page boundaries from DOCX using mammoth
 */
export async function extractDocx(buffer: Buffer | Uint8Array): Promise<ExtractedDocument> {
  const nodeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  // Extract raw text and HTML
  const [textResult, htmlResult] = await Promise.all([
    mammoth.extractRawText({ buffer: nodeBuffer }),
    mammoth.convertToHtml({ buffer: nodeBuffer }),
  ]);

  const rawText = textResult.value || "";
  const htmlContent = htmlResult.value || "";

  // Normalize line breaks and spaces
  const normalizedText = rawText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // DOCX files are continuous flow; partition into readable virtual pages (~2500-3000 chars each)
  // while preserving paragraph boundaries
  const pages: ExtractedPage[] = [];
  const paragraphs = normalizedText.split("\n\n");

  let currentPageNum = 1;
  let currentPageText = "";
  let canonicalText = "";
  let pageStartOffset = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i].trim();
    if (!para) continue;

    if (currentPageText.length + para.length > 2800 && currentPageText.length > 0) {
      // Flush current page
      const actualStart = canonicalText.length;
      if (canonicalText.length > 0) canonicalText += "\n\n";
      canonicalText += currentPageText;

      pages.push({
        pageNumber: currentPageNum,
        startOffset: actualStart,
        endOffset: canonicalText.length,
        text: currentPageText,
      });

      currentPageNum++;
      currentPageText = para;
    } else {
      if (currentPageText.length > 0) {
        currentPageText += "\n\n";
      }
      currentPageText += para;
    }
  }

  if (currentPageText.length > 0) {
    const actualStart = canonicalText.length;
    if (canonicalText.length > 0) canonicalText += "\n\n";
    canonicalText += currentPageText;

    pages.push({
      pageNumber: currentPageNum,
      startOffset: actualStart,
      endOffset: canonicalText.length,
      text: currentPageText,
    });
  }

  // Fallback for empty or 1-page documents
  if (pages.length === 0) {
    pages.push({
      pageNumber: 1,
      startOffset: 0,
      endOffset: canonicalText.length,
      text: canonicalText,
    });
  }

  return {
    canonicalText,
    pageCount: pages.length,
    pages,
    htmlContent,
  };
}
