import { ClauseSegment, ChangeType, WordDiffChunk } from "./types";

export interface AlignmentCandidate {
  clauseA?: ClauseSegment;
  clauseB?: ClauseSegment;
  indexA?: number;
  indexB?: number;
  label: string;
  changeType: ChangeType;
  similarity: number;
}

/**
 * Clean & tokenize string into a set/bag of words
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

/**
 * Compute Jaccard / token-set overlap similarity between two texts.
 */
export function computeTokenSimilarity(textA: string, textB: string): number {
  const tokensA = new Set(tokenize(textA));
  const tokensB = new Set(tokenize(textB));

  if (tokensA.size === 0 && tokensB.size === 0) return 1.0;
  if (tokensA.size === 0 || tokensB.size === 0) return 0.0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersection++;
    }
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 1.0 : intersection / union;
}

/**
 * Normalize label for exact or heading matching (e.g. "Section 4.1." -> "4.1")
 */
export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/^(?:article|section|sec\.|clause)\s+/i, "")
    .replace(/[():.\s]/g, "")
    .trim();
}

/**
 * Compute word-level diff chunks (LCS algorithm)
 */
export function computeWordDiff(textA: string, textB: string): WordDiffChunk[] {
  const wordsA = textA.split(/(\s+)/);
  const wordsB = textB.split(/(\s+)/);

  // If text is very long, limit to prevent excessive LCS overhead
  if (wordsA.length > 1000 || wordsB.length > 1000) {
    return [
      { type: "removed", text: textA },
      { type: "added", text: textB },
    ];
  }

  // Classic LCS matrix
  const m = wordsA.length;
  const n = wordsB.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (wordsA[i - 1] === wordsB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to form diff chunks
  const chunks: WordDiffChunk[] = [];
  let i = m;
  let j = n;

  const rawChunks: WordDiffChunk[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && wordsA[i - 1] === wordsB[j - 1]) {
      rawChunks.push({ type: "equal", text: wordsA[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rawChunks.push({ type: "added", text: wordsB[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      rawChunks.push({ type: "removed", text: wordsA[i - 1] });
      i--;
    }
  }

  rawChunks.reverse();

  // Merge consecutive tokens of same type
  for (const c of rawChunks) {
    if (chunks.length > 0 && chunks[chunks.length - 1].type === c.type) {
      chunks[chunks.length - 1].text += c.text;
    } else {
      chunks.push({ type: c.type, text: c.text });
    }
  }

  return chunks;
}

/**
 * Greedy 1-to-1 Aligner:
 * Matches clauses by:
 * 1. Normalized label match (if similarity > 0.35)
 * 2. High text similarity match (similarity >= 0.50)
 * 3. Categorizes as unchanged (sim == 1.0), modified, added, removed, or moved (same text, relative order shifted).
 */
export function alignClauses(
  clausesA: ClauseSegment[],
  clausesB: ClauseSegment[]
): AlignmentCandidate[] {
  const matchedA = new Set<number>();
  const matchedB = new Set<number>();
  const matches: { idxA: number; idxB: number; sim: number }[] = [];

  // Pass 1: Identical or normalized label match
  for (let i = 0; i < clausesA.length; i++) {
    const normA = normalizeLabel(clausesA[i].label);
    if (!normA) continue;

    for (let j = 0; j < clausesB.length; j++) {
      if (matchedB.has(j)) continue;
      const normB = normalizeLabel(clausesB[j].label);
      if (normA === normB) {
        const sim = computeTokenSimilarity(clausesA[i].text, clausesB[j].text);
        if (sim >= 0.25 || clausesA[i].text.trim() === clausesB[j].text.trim()) {
          matches.push({ idxA: i, idxB: j, sim });
          matchedA.add(i);
          matchedB.add(j);
          break;
        }
      }
    }
  }

  // Pass 2: High token similarity for remaining unmatched
  const similarityMatrix: { idxA: number; idxB: number; sim: number }[] = [];
  for (let i = 0; i < clausesA.length; i++) {
    if (matchedA.has(i)) continue;
    for (let j = 0; j < clausesB.length; j++) {
      if (matchedB.has(j)) continue;
      const sim = computeTokenSimilarity(clausesA[i].text, clausesB[j].text);
      if (sim >= 0.40) {
        similarityMatrix.push({ idxA: i, idxB: j, sim });
      }
    }
  }

  // Sort descending by similarity
  similarityMatrix.sort((a, b) => b.sim - a.sim);

  for (const candidate of similarityMatrix) {
    if (matchedA.has(candidate.idxA) || matchedB.has(candidate.idxB)) continue;
    matches.push(candidate);
    matchedA.add(candidate.idxA);
    matchedB.add(candidate.idxB);
  }

  // Build full alignment list
  const results: AlignmentCandidate[] = [];

  // Add matched pairs
  for (const m of matches) {
    const a = clausesA[m.idxA];
    const b = clausesB[m.idxB];

    const exactMatch = a.text.trim() === b.text.trim();
    // Check if relative position shifted significantly (> 1 position difference from expected)
    const isMoved = exactMatch && Math.abs(m.idxA - m.idxB) >= 2;

    let changeType: ChangeType = "modified";
    if (isMoved) {
      changeType = "moved";
    } else if (exactMatch) {
      changeType = "unchanged";
    }

    results.push({
      clauseA: a,
      clauseB: b,
      indexA: m.idxA,
      indexB: m.idxB,
      label: b.label || a.label,
      changeType,
      similarity: m.sim,
    });
  }

  // Add removed (in A but not B)
  for (let i = 0; i < clausesA.length; i++) {
    if (!matchedA.has(i)) {
      results.push({
        clauseA: clausesA[i],
        indexA: i,
        label: clausesA[i].label,
        changeType: "removed",
        similarity: 0,
      });
    }
  }

  // Add added (in B but not A)
  for (let j = 0; j < clausesB.length; j++) {
    if (!matchedB.has(j)) {
      results.push({
        clauseB: clausesB[j],
        indexB: j,
        label: clausesB[j].label,
        changeType: "added",
        similarity: 0,
      });
    }
  }

  // Sort by document appearance (using indexB if present, else indexA)
  results.sort((x, y) => {
    const pos1 = x.indexB !== undefined ? x.indexB : (x.indexA ?? 0) + 0.5;
    const pos2 = y.indexB !== undefined ? y.indexB : (y.indexA ?? 0) + 0.5;
    return pos1 - pos2;
  });

  return results;
}
