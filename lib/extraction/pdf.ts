import { buildPageText } from "@/lib/extract/pageText";
import { ExtractedDocument, ExtractedPage } from "./types";

/**
 * Extract canonical text and page boundaries from PDF buffer using pdfjs-dist.
 * Uses the legacy Node build (no Worker required).
 *
 * AGENTS.md invariants:
 *  - Uses shared buildPageText() so browser viewer offsets match server offsets.
 *  - Detects scanned/image PDFs (< 30 chars/page avg or > 80% empty pages)
 *    and throws a human-readable error rather than returning empty text.
 *  - Detects password-protected PDFs.
 */
export async function extractPdf(buffer: Buffer | Uint8Array): Promise<ExtractedDocument> {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore pdfjs legacy build — module typing not exported
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const data = new Uint8Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );

  let pdfDoc: any;
  try {
    const loadingTask = pdfjs.getDocument({
      data,
      useSystemFonts: true,
      disableFontFace: true,
    });
    pdfDoc = await loadingTask.promise;
  } catch (err: any) {
    const msg = (err?.message || "").toLowerCase();
    if (msg.includes("password") || msg.includes("encrypted")) {
      throw new Error(
        "This PDF is password-protected. Please remove the password and re-upload."
      );
    }
    throw new Error(`Could not open PDF: ${err?.message || "Unknown error"}`);
  }

  const numPages: number = pdfDoc.numPages;
  const pages: ExtractedPage[] = [];
  let canonicalText = "";

  let totalChars = 0;
  let emptyPageCount = 0;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();

    const pageText = buildPageText(textContent.items as any[]);

    if (pageText.length < 10) {
      emptyPageCount++;
    }
    totalChars += pageText.length;

    const startOffset = canonicalText.length === 0
      ? 0
      : canonicalText.length + 2; // account for "\n\n" separator

    if (pageNum > 1 && canonicalText.length > 0) {
      canonicalText += "\n\n";
    }

    const actualStart = canonicalText.length;
    canonicalText += pageText;
    const actualEnd = canonicalText.length;

    pages.push({
      pageNumber: pageNum,
      startOffset: actualStart,
      endOffset: actualEnd,
      text: pageText,
    });
  }

  // Scanned / image PDF detection
  if (numPages > 0) {
    const avgCharsPerPage = totalChars / numPages;
    const emptyPageRatio = emptyPageCount / numPages;

    if (avgCharsPerPage < 30 || emptyPageRatio > 0.8) {
      throw new Error(
        "This PDF looks like a scanned image with no readable text. ClauseLens can't read it yet. Please upload a text-based PDF or run OCR first."
      );
    }
  }

  if (canonicalText.trim().length === 0) {
    throw new Error(
      "No text could be extracted from this PDF. It may be a scanned image or contain only embedded graphics. Please upload a text-based PDF."
    );
  }

  return {
    canonicalText,
    pageCount: numPages,
    pages,
  };
}
