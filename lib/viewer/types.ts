export interface ViewerPage {
  id?: string;
  pageNumber: number;
  startOffset: number;
  endOffset: number;
  text?: string;
}

export interface ViewerDocument {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  status: string;
  statusDetail?: string | null;
  errorMessage?: string | null;
  pageCount: number;
  canonicalText?: string | null;
  htmlContent?: string | null;
  createdAt?: string | Date;
}

export interface TextItemOffset {
  itemIndex: number;
  start: number; // offset in pageText
  end: number;   // offset in pageText (exclusive)
  str: string;
}

export interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
  pageNumber?: number;
}

export interface BlockOffset {
  id: string;
  start: number;
  end: number;
}

export interface ActiveQuoteTarget {
  n: number;
  quote: string;
  occurrenceIndex: number;
  occurrences: Array<{ start: number; end: number }>;
  pageStart?: number;
  pageEnd?: number;
  messageId?: string;
  ambiguous?: boolean;
}
