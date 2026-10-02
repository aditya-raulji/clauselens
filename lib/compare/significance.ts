import { z } from "zod";
import { aiClient } from "@/lib/ai/client";
import {
  AlignedClausePair,
  SignificanceLevel,
  ClauseCategory,
  FactChange,
  ChangeType,
} from "./types";
import { isHighRiskClause } from "./facts";

// ── Zod schema for LLM response ────────────────────────────────────────────
const LLMAssessmentSchema = z.object({
  summary: z.string().min(5),
  significance: z.enum(["high", "medium", "low", "cosmetic"]),
  category: z.enum([
    "liability",
    "payment",
    "termination",
    "confidentiality",
    "ip",
    "governing_law",
    "other",
  ]),
  why: z.string().min(3),
});

type LLMAssessment = z.infer<typeof LLMAssessmentSchema>;

// ── Code-enforced guardrails ───────────────────────────────────────────────
function applyGuardrails(
  assessment: LLMAssessment,
  changeType: ChangeType,
  factChanges: FactChange[],
  textA: string,
  textB: string
): LLMAssessment {
  let { significance, category } = assessment;

  // Rule 1: if factChanges is non-empty, significance cannot be below medium
  if (factChanges.length > 0 && (significance === "low" || significance === "cosmetic")) {
    significance = "medium";
  }

  // Rule 2: numeric changes in liability/indemnity/payment/termination/penalty → high
  const combinedText = (textA + " " + textB).toLowerCase();
  const hasMoneySensitiveChange =
    factChanges.some((fc) => fc.label === "Amount") &&
    isHighRiskClause(combinedText);

  if (hasMoneySensitiveChange) {
    significance = "high";
  }

  // Rule 3: removed or added liability/indemnity/termination clause → high
  if (
    (changeType === "added" || changeType === "removed") &&
    isHighRiskClause(combinedText)
  ) {
    significance = "high";
  }

  // Rule 4: obligations shift ("shall" → "may") must be at least medium
  if (
    factChanges.some((fc) => fc.label === "Obligation") &&
    (significance === "low" || significance === "cosmetic")
  ) {
    significance = "medium";
  }

  return { ...assessment, significance, category };
}

// ── Deterministic fallback assessment ─────────────────────────────────────
function deterministicAssessment(
  changeType: ChangeType,
  factChanges: FactChange[],
  textA: string,
  textB: string
): LLMAssessment {
  const isRisky = isHighRiskClause((textA || "") + " " + (textB || ""));
  const hasFacts = factChanges.length > 0;
  const hasMoneyChange = factChanges.some((fc) => fc.label === "Amount");
  const hasObligationChange = factChanges.some((fc) => fc.label === "Obligation");

  let significance: SignificanceLevel;
  let category: ClauseCategory;
  let summary: string;
  let why: string;

  // Determine category from text
  const combined = ((textA || "") + " " + (textB || "")).toLowerCase();
  if (combined.includes("liabilit") || combined.includes("indemnif")) {
    category = "liability";
  } else if (combined.includes("payment") || combined.includes("invoice")) {
    category = "payment";
  } else if (combined.includes("terminat")) {
    category = "termination";
  } else if (combined.includes("confidential")) {
    category = "confidentiality";
  } else if (combined.includes("intellectual property") || combined.includes(" ip ")) {
    category = "ip";
  } else if (combined.includes("governing law") || combined.includes("jurisdiction")) {
    category = "governing_law";
  } else {
    category = "other";
  }

  if (changeType === "added") {
    significance = isRisky ? "high" : hasFacts ? "medium" : "low";
    summary = `A new ${category !== "other" ? category : "clause"} clause has been added.`;
    why = "New clauses create obligations that didn't previously exist.";
  } else if (changeType === "removed") {
    significance = isRisky ? "high" : hasFacts ? "medium" : "low";
    summary = `A ${category !== "other" ? category : ""} clause has been removed.`;
    why = "Removed clauses may eliminate protections or obligations.";
  } else if (changeType === "moved") {
    significance = "low";
    summary = "This clause appears in a different position in the document.";
    why = "Reordering without textual change is typically structural only.";
  } else if (hasMoneyChange) {
    significance = isRisky ? "high" : "medium";
    summary = `Monetary amount changed: ${factChanges.find((f) => f.label === "Amount")?.description || "see fact changes"}`;
    why = "Numerical amount changes are substantive and legally significant.";
  } else if (hasObligationChange) {
    significance = "medium";
    summary = `Obligation language changed: ${factChanges.find((f) => f.label === "Obligation")?.description || ""}`;
    why = "Changing 'shall' to 'may' (or vice versa) alters legal obligation.";
  } else if (hasFacts) {
    significance = "medium";
    summary = "Changes detected in factual terms (duration, dates, percentages).";
    why = "Factual changes affect the practical effect of the clause.";
  } else if (changeType === "modified") {
    significance = "cosmetic";
    summary = "The clause was reworded with no apparent change in substance.";
    why = "No factual or risk-relevant elements changed.";
  } else {
    significance = "cosmetic";
    summary = "No substantive change detected in this clause.";
    why = "Identical or near-identical text.";
  }

  return { summary, significance, category, why };
}

// ── Batch LLM significance pass ────────────────────────────────────────────
export interface SignificanceInput {
  index: number;
  changeType: ChangeType;
  label: string;
  textA?: string;
  textB?: string;
  factChanges: FactChange[];
}

export interface SignificanceOutput {
  index: number;
  summary: string;
  significance: SignificanceLevel;
  category: ClauseCategory;
  why: string;
  autoAssessed?: boolean;
}

const BATCH_SYSTEM_PROMPT = `You are a legal contract reviewer. For each clause comparison item, return a JSON array where each element has exactly these keys: summary, significance, category, why.

Rules:
- summary: 1-2 sentences, plain language, what actually changed and why it matters.
- significance: "high" (material legal/financial impact) | "medium" (minor obligation or fact change) | "low" (structural change, no substance) | "cosmetic" (only rewording, same substance).
- category: one of: liability | payment | termination | confidentiality | ip | governing_law | other
- why: brief reason for the significance rating.
- Rewording with no substance change MUST be "cosmetic".
- Return a valid JSON array with exactly the same count as the input.`;

function buildBatchPrompt(items: SignificanceInput[]): string {
  const numbered = items.map((item, i) => {
    const lines = [`Item ${i + 1} — Label: "${item.label}" — Change type: ${item.changeType}`];
    if (item.textA) lines.push(`OLD: ${item.textA.slice(0, 300)}`);
    if (item.textB) lines.push(`NEW: ${item.textB.slice(0, 300)}`);
    if (item.factChanges.length > 0) {
      lines.push(`Fact changes: ${item.factChanges.map((f) => f.description).join("; ")}`);
    }
    return lines.join("\n");
  });
  return `Assess the following ${items.length} clause changes. Return a JSON array of exactly ${items.length} objects.\n\n${numbered.join("\n\n---\n\n")}`;
}

export async function runSignificancePass(
  inputs: SignificanceInput[],
  onProgress?: (pct: number, message: string) => void
): Promise<SignificanceOutput[]> {
  if (inputs.length === 0) return [];

  // Batch into groups of 5 to respect token budget
  const BATCH_SIZE = 5;
  const results: SignificanceOutput[] = new Array(inputs.length);

  const batches: SignificanceInput[][] = [];
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    batches.push(inputs.slice(i, i + BATCH_SIZE));
  }

  for (let bIdx = 0; bIdx < batches.length; bIdx++) {
    const batch = batches[bIdx];
    const pct = Math.round(((bIdx + 1) / batches.length) * 100);

    onProgress?.(pct, `Assessing batch ${bIdx + 1}/${batches.length}…`);

    let batchResults: LLMAssessment[] | null = null;

    try {
      const response = await aiClient.chat({
        messages: [
          { role: "system", content: BATCH_SYSTEM_PROMPT },
          { role: "user", content: buildBatchPrompt(batch) },
        ],
        maxTokens: 800,
        temperature: 0.05,
      });

      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed) && parsed.length === batch.length) {
          batchResults = parsed.map((item: unknown) => {
            try {
              return LLMAssessmentSchema.parse(item);
            } catch {
              return null;
            }
          }).filter(Boolean) as LLMAssessment[];

          if (batchResults.length !== batch.length) {
            batchResults = null; // Force fallback
          }
        }
      }
    } catch {
      // LLM failed → will use fallback
    }

    for (let i = 0; i < batch.length; i++) {
      const item = batch[i];
      let assessment: LLMAssessment;
      let autoAssessed = false;

      if (batchResults && batchResults[i]) {
        assessment = applyGuardrails(
          batchResults[i],
          item.changeType,
          item.factChanges,
          item.textA || "",
          item.textB || ""
        );
      } else {
        assessment = applyGuardrails(
          deterministicAssessment(
            item.changeType,
            item.factChanges,
            item.textA || "",
            item.textB || ""
          ),
          item.changeType,
          item.factChanges,
          item.textA || "",
          item.textB || ""
        );
        autoAssessed = true;
      }

      results[item.index] = {
        index: item.index,
        summary: assessment.summary,
        significance: assessment.significance,
        category: assessment.category,
        why: assessment.why,
        autoAssessed,
      };
    }
  }

  return results;
}
