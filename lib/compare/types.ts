export type ChangeType = "unchanged" | "modified" | "added" | "removed" | "moved";

export type SignificanceLevel = "high" | "medium" | "low" | "cosmetic";

export type ClauseCategory =
  | "liability"
  | "payment"
  | "termination"
  | "confidentiality"
  | "ip"
  | "governing_law"
  | "other";

export interface ClauseSegment {
  id: string;
  label: string; // e.g. "Section 4.1", "1.", "(a)", or "Paragraph 3"
  text: string;
  startOffset: number;
  endOffset: number;
  pageNumber?: number;
}

export interface FactChange {
  label: string; // e.g. "Liability cap", "Notice period", "Obligation"
  before?: string;
  after?: string;
  description: string; // e.g. "Liability cap: AED 100,000 -> AED 1,000,000"
}

export interface ExtractedFacts {
  money: string[];
  percentages: string[];
  durations: string[];
  dates: string[];
  obligations: string[];
}

export interface WordDiffChunk {
  type: "equal" | "added" | "removed";
  text: string;
}

export interface AlignedClausePair {
  id: string;
  clauseA?: ClauseSegment;
  clauseB?: ClauseSegment;
  label: string;
  changeType: ChangeType;
  similarity: number; // 0.0 - 1.0
  movedFromIndex?: number;
  movedToIndex?: number;
  factChanges: FactChange[];
  wordDiff?: WordDiffChunk[];
  
  // LLM / Guardrail assessment
  summary: string;
  significance: SignificanceLevel;
  category: ClauseCategory;
  why: string;
  autoAssessed?: boolean;
}

export interface ComparisonSummary {
  headline: string;
  bullets: string[];
  counts: {
    total: number;
    unchanged: number;
    modified: number;
    added: number;
    removed: number;
    moved: number;
    bySignificance: {
      high: number;
      medium: number;
      low: number;
      cosmetic: number;
    };
    byCategory: Record<ClauseCategory, number>;
  };
}

export interface ComparisonResult {
  docA: { id: string; name: string };
  docB: { id: string; name: string };
  summary: ComparisonSummary;
  changes: AlignedClausePair[];
  createdAt: string;
}
