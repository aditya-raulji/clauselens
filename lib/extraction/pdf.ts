import { ExtractedDocument, ExtractedPage } from "./types";

/**
 * Extract canonical text and page boundaries from PDF buffer using pdfjs-dist
 */
export async function extractPdf(buffer: Buffer | Uint8Array): Promise<ExtractedDocument> {
  // Use legacy build for stable Node.js execution
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore pdfjs legacy build — module typing not exported
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
  });

  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;

  const pages: ExtractedPage[] = [];
  let canonicalText = "";

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();

    // Group items into text lines
    let lastY: number | null = null;
    let pageText = "";

    for (const item of textContent.items) {
      if (!("str" in item)) continue;
      const str = item.str;
      if (!str) continue;

      const currentY = item.transform ? item.transform[5] : null;

      if (lastY !== null && currentY !== null && Math.abs(currentY - lastY) > 5) {
        pageText += "\n";
      } else if (pageText.length > 0 && !pageText.endsWith(" ") && !pageText.endsWith("\n")) {
        pageText += " ";
      }

      pageText += str;
      lastY = currentY;
    }

    // Clean up excessive whitespace within the page
    const cleanedPageText = pageText.replace(/[ \t]+/g, " ").trim();

    const startOffset = canonicalText.length;
    if (pageNum > 1 && canonicalText.length > 0) {
      canonicalText += "\n\n";
    }

    const actualStart = canonicalText.length;
    canonicalText += cleanedPageText;
    const actualEnd = canonicalText.length;

    pages.push({
      pageNumber: pageNum,
      startOffset: actualStart,
      endOffset: actualEnd,
      text: cleanedPageText,
    });
  }

  return {
    canonicalText,
    pageCount: numPages,
    pages,
  };
}
