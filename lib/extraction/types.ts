export interface ExtractedPage {
  pageNumber: number;
  startOffset: number;
  endOffset: number;
  text: string;
}

export interface ExtractedDocument {
  canonicalText: string;
  pageCount: number;
  pages: ExtractedPage[];
  htmlContent?: string;
}

export interface DocumentChunk {
  idx: number;
  startOffset: number;
  endOffset: number;
  pageStart: number;
  pageEnd: number;
  sectionLabel: string;
  text: string;
}
