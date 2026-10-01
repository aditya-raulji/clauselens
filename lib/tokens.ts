/**
 * lib/tokens.ts
 *
 * Fast token estimation for rate limiting and sliding window budgets.
 * Follows the standard heuristic: estimateTokens(text) = ceil(chars / 4).
 */

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
