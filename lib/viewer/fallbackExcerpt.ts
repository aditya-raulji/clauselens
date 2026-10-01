export interface PassageExcerpt {
  prefix: string;
  quote: string;
  suffix: string;
  start: number;
  end: number;
  hasPrefixEllipsis: boolean;
  hasSuffixEllipsis: boolean;
}

/**
 * Extracts a surrounding passage window (~600 chars before and after)
 * around a canonical offset range for zero-fail fallback presentation.
 */
export function getPassageExcerpt(
  canonicalText: string,
  start: number,
  end: number,
  windowChars: number = 600
): PassageExcerpt {
  if (!canonicalText) {
    return {
      prefix: "",
      quote: "",
      suffix: "",
      start: 0,
      end: 0,
      hasPrefixEllipsis: false,
      hasSuffixEllipsis: false,
    };
  }

  const safeStart = Math.max(0, Math.min(start, canonicalText.length));
  const safeEnd = Math.max(safeStart, Math.min(end, canonicalText.length));

  const winStart = Math.max(0, safeStart - windowChars);
  const winEnd = Math.min(canonicalText.length, safeEnd + windowChars);

  const prefix = canonicalText.slice(winStart, safeStart);
  const quote = canonicalText.slice(safeStart, safeEnd);
  const suffix = canonicalText.slice(safeEnd, winEnd);

  return {
    prefix,
    quote,
    suffix,
    start: safeStart,
    end: safeEnd,
    hasPrefixEllipsis: winStart > 0,
    hasSuffixEllipsis: winEnd < canonicalText.length,
  };
}
