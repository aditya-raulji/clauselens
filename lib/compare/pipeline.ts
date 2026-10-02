import { segmentContract } from "./segmenter";
import { alignClauses, computeWordDiff } from "./aligner";
import { extractFacts, diffFacts } from "./facts";
import { runSignificancePass, SignificanceInput } from "./significance";
import {
  AlignedClausePair,
  ComparisonResult,
  ComparisonSummary,
  ClauseCategory,
} from "./types";

export interface RunCompareOptions {
  docAId: string;
  docAName: string;
  textA: string;
  docBId: string;
  docBName: string;
  textB: string;
  onProgress?: (pct: number, message: string) => void;
}

/**
 * Full comparison pipeline:
 * 1) Segment both texts into clauses.
 * 2) Align clauses (label match + cosine similarity).
 * 3) Extract & diff facts per matched pair.
 * 4) Run LLM significance pass (batched), with guardrail enforcement.
 * 5) Build summary.
 */
export async function runCompare(opts: RunCompareOptions): Promise<ComparisonResult> {
  const { textA, textB, onProgress } = opts;

  onProgress?.(5, "Segmenting documents…");
  const clausesA = segmentContract(textA);
  const clausesB = segmentContract(textB);

  onProgress?.(15, "Aligning clauses…");
  const aligned = alignClauses(clausesA, clausesB);

  onProgress?.(25, "Extracting facts…");

  // Build preliminary pairs with facts but no significance yet
  const prelimPairs: Omit<AlignedClausePair, "summary" | "significance" | "category" | "why" | "autoAssessed">[] = [];

  for (let i = 0; i < aligned.length; i++) {
    const m = aligned[i];
    const factsA = m.clauseA ? extractFacts(m.clauseA.text) : { money: [], percentages: [], durations: [], dates: [], obligations: [] };
    const factsB = m.clauseB ? extractFacts(m.clauseB.text) : { money: [], percentages: [], durations: [], dates: [], obligations: [] };
    const factChanges = m.changeType !== "unchanged" && m.changeType !== "moved"
      ? diffFacts(factsA, factsB, m.clauseA?.label || "", m.clauseB?.label || "")
      : [];

    const wordDiff =
      m.changeType === "modified" && m.clauseA && m.clauseB
        ? computeWordDiff(m.clauseA.text, m.clauseB.text)
        : undefined;

    prelimPairs.push({
      id: `cp_${i}`,
      clauseA: m.clauseA,
      clauseB: m.clauseB,
      label: m.label,
      changeType: m.changeType,
      similarity: m.similarity,
      movedFromIndex: m.changeType === "moved" ? m.indexA : undefined,
      movedToIndex: m.changeType === "moved" ? m.indexB : undefined,
      factChanges,
      wordDiff,
    });
  }

  onProgress?.(35, "Running AI significance analysis…");

  // Only send non-unchanged clauses to the LLM pass
  const significanceInputs: SignificanceInput[] = prelimPairs
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => p.changeType !== "unchanged")
    .map(({ p, idx }) => ({
      index: idx,
      changeType: p.changeType,
      label: p.label,
      textA: p.clauseA?.text,
      textB: p.clauseB?.text,
      factChanges: p.factChanges,
    }));

  const significanceResults = await runSignificancePass(
    significanceInputs,
    (sigPct, msg) => {
      const overall = 35 + Math.round((sigPct / 100) * 55);
      onProgress?.(overall, msg);
    }
  );

  // Build full pairs with significance
  const sigMap = new Map<number, typeof significanceResults[0]>();
  for (const r of significanceResults) {
    sigMap.set(r.index, r);
  }

  const finalPairs: AlignedClausePair[] = prelimPairs.map((p, idx) => {
    const sig = sigMap.get(idx);
    if (sig) {
      return {
        ...p,
        summary: sig.summary,
        significance: sig.significance,
        category: sig.category,
        why: sig.why,
        autoAssessed: sig.autoAssessed,
      };
    }
    // Unchanged
    return {
      ...p,
      summary: "No changes detected in this clause.",
      significance: "cosmetic",
      category: "other",
      why: "Identical text in both versions.",
    };
  });

  onProgress?.(92, "Building summary…");
  const summary = buildSummary(finalPairs);

  onProgress?.(100, "Done");

  return {
    docA: { id: opts.docAId, name: opts.docAName },
    docB: { id: opts.docBId, name: opts.docBName },
    summary,
    changes: finalPairs,
    createdAt: new Date().toISOString(),
  };
}

function buildSummary(changes: AlignedClausePair[]): ComparisonSummary {
  const counts = {
    total: changes.length,
    unchanged: 0,
    modified: 0,
    added: 0,
    removed: 0,
    moved: 0,
    bySignificance: { high: 0, medium: 0, low: 0, cosmetic: 0 },
    byCategory: {
      liability: 0,
      payment: 0,
      termination: 0,
      confidentiality: 0,
      ip: 0,
      governing_law: 0,
      other: 0,
    } as Record<ClauseCategory, number>,
  };

  const bulletCandidates: AlignedClausePair[] = [];

  for (const c of changes) {
    counts[c.changeType]++;
    counts.bySignificance[c.significance]++;
    counts.byCategory[c.category]++;
    if (c.changeType !== "unchanged" && c.significance !== "cosmetic") {
      bulletCandidates.push(c);
    }
  }

  // Top bullets: up to 6, ordered by significance
  const ORDER = { high: 0, medium: 1, low: 2, cosmetic: 3 };
  bulletCandidates.sort((a, b) => ORDER[a.significance] - ORDER[b.significance]);

  const bullets = bulletCandidates.slice(0, 6).map((c) => {
    const tag =
      c.significance === "high" ? "🔴" : c.significance === "medium" ? "🟡" : "🟢";
    return `${tag} [${c.label}] ${c.summary}`;
  });

  const highCount = counts.bySignificance.high;
  const medCount = counts.bySignificance.medium;
  const headline =
    highCount > 0
      ? `${highCount} high-significance change${highCount > 1 ? "s" : ""} detected — legal review recommended.`
      : medCount > 0
      ? `${medCount} moderate change${medCount > 1 ? "s" : ""} detected — review advisable.`
      : "No substantive changes detected — differences appear cosmetic only.";

  return { headline, bullets, counts };
}
