/**
 * lib/quotes/normalize.ts
 *
 * Framework-free text normalization with character index mapping.
 * Given raw document or quote text, returns:
 *   - norm: normalized string
 *   - map: array of indices where map[i] is the offset in the ORIGINAL text
 *          of normalized character i.
 */

export interface NormalizedResult {
  norm: string;
  map: number[];
}

interface RawCharItem {
  char: string;
  origIdx: number;
  origLen: number;
}

// Zero-width characters & soft hyphen
const ZERO_WIDTH_OR_SOFT_HYPHEN = /[\u00AD\u200B\u200C\u200D\uFEFF\u2060]/;

// Dashes: en-dash, em-dash, horizontal bar, minus sign, hyphens
const DASHES = /[\u2013\u2014\u2015\u2212\u2010\u2011]/g;

// Curly double quotes and guillemets
const DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g;

// Curly single quotes, prime, backtick
const SINGLE_QUOTES = /[\u2018\u2019\u201A\u201B\u2032\u0060]/g;

// Whitespace (including NBSP and Unicode space separators)
const WHITESPACE = /[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/u;

/**
 * Normalizes text while preserving a character-by-character mapping
 * back to original character offsets.
 *
 * Normalization stages:
 *  1. Scan original code points (handling surrogate pairs).
 *  2. Repair hyphenation across line breaks ("agree-\nment" -> "agreement").
 *  3. Character normalization (NFKC, lowercase, curly quotes, dashes, ligatures,
 *     soft-hyphens/zero-width chars removal).
 *  4. Collapse whitespace runs to a single space.
 *  5. Trim leading and trailing whitespace.
 */
export function normalizeWithMap(text: string): NormalizedResult {
  if (!text || text.length === 0) {
    return { norm: "", map: [] };
  }

  // 1. Scan original characters with original string offset and code-unit length
  const rawItems: RawCharItem[] = [];
  const totalLen = text.length;
  let i = 0;

  while (i < totalLen) {
    const code = text.charCodeAt(i);
    let origLen = 1;
    let char = text[i];

    // High surrogate check for UTF-16 pair
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < totalLen) {
      origLen = 2;
      char = text.slice(i, i + 2);
    }

    rawItems.push({ char, origIdx: i, origLen });
    i += origLen;
  }

  // 2. Repair hyphenation across line breaks:
  // e.g. "agree-\nment" -> "agreement"
  // When a word character is followed by a hyphen [-–—\u00AD] and a newline (with optional space/CR),
  // followed by another word character, skip the hyphen and line break.
  const itemsAfterHyphen: RawCharItem[] = [];
  for (let j = 0; j < rawItems.length; j++) {
    const curr = rawItems[j];

    if (
      j > 0 &&
      /[-–—\u00AD]/.test(curr.char)
    ) {
      const prev = rawItems[j - 1];
      // Check if previous char is letter or number
      if (/[\p{L}\p{N}]/u.test(prev.char)) {
        let k = j + 1;
        // Skip horizontal spaces before newline
        while (k < rawItems.length && /[ \t]/.test(rawItems[k].char)) {
          k++;
        }
        // Check for newline
        if (
          k < rawItems.length &&
          (rawItems[k].char === "\n" || rawItems[k].char === "\r")
        ) {
          if (
            rawItems[k].char === "\r" &&
            k + 1 < rawItems.length &&
            rawItems[k + 1].char === "\n"
          ) {
            k++;
          }
          k++; // skip past newline

          // Skip horizontal spaces after newline
          while (k < rawItems.length && /[ \t]/.test(rawItems[k].char)) {
            k++;
          }

          // Check if followed by letter or number
          if (k < rawItems.length && /[\p{L}\p{N}]/u.test(rawItems[k].char)) {
            // Repair: skip hyphen and newline run
            j = k - 1;
            continue;
          }
        }
      }
    }

    itemsAfterHyphen.push(curr);
  }

  // 3. Character-level normalization: ligatures, NFKC, quotes, dashes, lowercase
  const normChars: Array<{ char: string; origIdx: number; origLen: number }> = [];

  for (const item of itemsAfterHyphen) {
    let ch = item.char;

    // Drop soft-hyphens & zero-width characters
    if (ZERO_WIDTH_OR_SOFT_HYPHEN.test(ch)) {
      continue;
    }

    // Explicit ligature expansions (those not expanded by NFKC or needing special handling)
    if (ch === "œ" || ch === "Œ") {
      normChars.push({ char: "o", origIdx: item.origIdx, origLen: item.origLen });
      normChars.push({ char: "e", origIdx: item.origIdx, origLen: item.origLen });
      continue;
    }
    if (ch === "æ" || ch === "Æ") {
      normChars.push({ char: "a", origIdx: item.origIdx, origLen: item.origLen });
      normChars.push({ char: "e", origIdx: item.origIdx, origLen: item.origLen });
      continue;
    }

    // NFKC normalization (expands ﬁ -> fi, ﬂ -> fl, ﬀ -> ff, ﬃ -> ffi, ﬄ -> ffl, etc.)
    ch = ch.normalize("NFKC");

    // Replace curly quotes with straight quotes
    ch = ch.replace(DOUBLE_QUOTES, '"');
    ch = ch.replace(SINGLE_QUOTES, "'");

    // Replace en/em/minus dashes with "-"
    ch = ch.replace(DASHES, "-");

    // Lowercase
    ch = ch.toLowerCase();

    // Map whitespace to space ' '
    if (WHITESPACE.test(ch)) {
      ch = " ";
    }

    // Push decomposed/normalized characters, mapping to original item offset
    for (const c of ch) {
      normChars.push({
        char: c,
        origIdx: item.origIdx,
        origLen: item.origLen,
      });
    }
  }

  // 4. Collapse whitespace runs to a single space
  const collapsed: Array<{ char: string; origIdx: number; origLen: number }> = [];
  for (const item of normChars) {
    if (item.char === " ") {
      if (collapsed.length > 0 && collapsed[collapsed.length - 1].char === " ") {
        // Skip consecutive space
        continue;
      }
    }
    collapsed.push(item);
  }

  // 5. Trim leading and trailing whitespace
  let start = 0;
  while (start < collapsed.length && collapsed[start].char === " ") {
    start++;
  }

  let end = collapsed.length;
  while (end > start && collapsed[end - 1].char === " ") {
    end--;
  }

  const trimmed = collapsed.slice(start, end);
  const norm = trimmed.map((t) => t.char).join("");
  const map = trimmed.map((t) => t.origIdx);

  return { norm, map };
}
