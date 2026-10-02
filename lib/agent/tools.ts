/**
 * lib/agent/tools.ts
 *
 * Agentic Deep Research tools for ClauseLens.
 * Each tool is pure and validated with Zod.
 * Every result records which character ranges were read for honest coverage.
 */

import { z } from "zod";
import { searchDocumentChunks } from "@/lib/retrieval/bm25";
import { DocumentChunkData } from "@/lib/chunk/chunk";

// ── Coverage tracking ─────────────────────────────────────────────────────────

export interface ReadRange {
  startOffset: number;
  endOffset: number;
  source: string; // e.g. "page:3", "section:12.3", "search:query"
}

// ── Document context passed to every tool ─────────────────────────────────────

export interface AgentDocContext {
  id: string;
  name: string;
  label: string; // "D1" for multi-doc, or just the doc name for single-doc
  canonicalText: string;
  chunks: DocumentChunkData[];
  pages: Array<{ pageNumber: number; startOffset: number; endOffset: number }>;
  totalPages: number;
}

// ── Tool result types ─────────────────────────────────────────────────────────

export interface ToolResult {
  output: string;        // text returned to the model
  rangesRead: ReadRange[]; // what was actually read
  error?: string;
  truncated?: boolean;
}

// ── Per-tool Zod schemas ─────────────────────────────────────────────────────

export const ListClausesSchema = z.object({
  document_label: z.string().optional().describe(
    "For multi-doc: which document label to list (e.g. 'D1'). Omit for single-doc."
  ),
});
export type ListClausesArgs = z.infer<typeof ListClausesSchema>;

export const SearchDocumentSchema = z.object({
  query: z.string().min(1, "query must be non-empty").max(500),
  top_k: z.number().int().min(1).max(5).default(3),
  document_label: z.string().optional(),
});
export type SearchDocumentArgs = z.infer<typeof SearchDocumentSchema>;

export const GetSectionSchema = z.object({
  identifier: z.string().min(1, "identifier must be non-empty").max(200),
  document_label: z.string().optional(),
});
export type GetSectionArgs = z.infer<typeof GetSectionSchema>;

export const GetPageSchema = z.object({
  page: z.number().int().min(1, "page must be >= 1"),
  document_label: z.string().optional(),
});
export type GetPageArgs = z.infer<typeof GetPageSchema>;

// ── Tool name registry ────────────────────────────────────────────────────────

export const TOOL_NAMES = ["list_clauses", "search_document", "get_section", "get_page"] as const;
export type ToolName = typeof TOOL_NAMES[number];

// ── OpenAI-compatible tool definitions for the API call ──────────────────────

export const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "list_clauses",
      description:
        "Returns a numbered outline of the document's clause structure (clause number/heading + page). Call this first to understand the document layout before diving into specific sections.",
      parameters: {
        type: "object",
        properties: {
          document_label: {
            type: "string",
            description: "For multi-doc: document label like 'D1' or 'D2'. Omit for single-doc."
          }
        },
        required: []
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "search_document",
      description:
        "BM25 full-text search over the document's indexed clauses. Returns chunk id, section label, page, and a 250-char snippet for each result. Use this to find clauses relevant to a query.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query (e.g. 'termination provisions', 'liability cap', 'indemnification')."
          },
          top_k: {
            type: "integer",
            description: "Number of results to return (1–5). Default: 3.",
            minimum: 1,
            maximum: 5
          },
          document_label: {
            type: "string",
            description: "For multi-doc: document label like 'D1'. Omit for single-doc."
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "get_section",
      description:
        "Returns the full text of a specific clause by number (e.g. '12.3') or by heading text (e.g. 'TERMINATION FOR CONVENIENCE'). Will be truncated to 2000 chars with a note when truncated.",
      parameters: {
        type: "object",
        properties: {
          identifier: {
            type: "string",
            description: "Clause number (e.g. '12.3', '(a)') or heading text (e.g. 'Force Majeure')."
          },
          document_label: {
            type: "string",
            description: "For multi-doc: document label like 'D1'. Omit for single-doc."
          }
        },
        required: ["identifier"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "get_page",
      description:
        "Returns the full text of a specific page number. Useful when you need to read context around a found passage. Truncated to 2000 chars when the page is very long.",
      parameters: {
        type: "object",
        properties: {
          page: {
            type: "integer",
            description: "The page number (1-indexed).",
            minimum: 1
          },
          document_label: {
            type: "string",
            description: "For multi-doc: document label like 'D1'. Omit for single-doc."
          }
        },
        required: ["page"]
      }
    }
  }
];

const MAX_SECTION_CHARS = 2000;
const MAX_PAGE_CHARS = 2000;

// ── Tool executor ─────────────────────────────────────────────────────────────

function resolveDoc(
  docs: AgentDocContext[],
  label?: string
): AgentDocContext | null {
  if (!label) return docs[0] || null;
  return docs.find((d) => d.label === label) || null;
}

function noDocError(label?: string): ToolResult {
  const valid = "Available labels: " + ["D1", "D2", "D3", "D4", "D5"].slice(0, 5).join(", ");
  return {
    output: label
      ? `Error: document "${label}" not found. ${valid}`
      : "Error: no document loaded.",
    rangesRead: [],
    error: "document_not_found",
  };
}

/**
 * list_clauses — produce a numbered outline
 */
export function toolListClauses(
  docs: AgentDocContext[],
  args: unknown
): ToolResult {
  // Validate args
  const parsed = ListClausesSchema.safeParse(args);
  if (!parsed.success) {
    return {
      output: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}. Valid parameters: document_label (optional string).`,
      rangesRead: [],
      error: "validation_error",
    };
  }

  const doc = resolveDoc(docs, parsed.data.document_label);
  if (!doc) return noDocError(parsed.data.document_label);

  const lines: string[] = [];
  lines.push(`Clause outline for: ${doc.name}`);

  // Build outline from chunks' sectionLabels, grouping by unique label+page
  const seen = new Set<string>();
  let count = 0;

  for (const chunk of doc.chunks) {
    if (count >= 80) { lines.push("… (outline truncated at 80 entries)"); break; }
    const key = `${chunk.sectionLabel}:${chunk.pageStart}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pageStr = chunk.pageStart === chunk.pageEnd
      ? `p.${chunk.pageStart}`
      : `pp.${chunk.pageStart}–${chunk.pageEnd}`;
    lines.push(`  ${chunk.sectionLabel}  [${pageStr}]`);
    count++;
  }

  if (lines.length === 1) lines.push("  (No clause structure detected — document may be unstructured)");

  return {
    output: lines.join("\n"),
    rangesRead: [], // outline only, no actual text returned
  };
}

/**
 * search_document — BM25 search with snippets
 */
export function toolSearchDocument(
  docs: AgentDocContext[],
  args: unknown
): ToolResult {
  const parsed = SearchDocumentSchema.safeParse(args);
  if (!parsed.success) {
    return {
      output: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}. Required: query (string). Optional: top_k (1–5), document_label (string).`,
      rangesRead: [],
      error: "validation_error",
    };
  }

  const { query, top_k, document_label } = parsed.data;

  const doc = resolveDoc(docs, document_label);
  if (!doc) return noDocError(document_label);

  const results = searchDocumentChunks(doc.id, query, doc.chunks, top_k, true);

  if (results.length === 0) {
    return {
      output: `No results found for query: "${query}" in ${doc.name}.`,
      rangesRead: [],
    };
  }

  const lines: string[] = [`Search results for "${query}" in ${doc.name}:`];
  const ranges: ReadRange[] = [];

  for (let i = 0; i < results.length; i++) {
    const { chunk, score } = results[i];
    const pageStr = chunk.pageStart === chunk.pageEnd
      ? `p.${chunk.pageStart}`
      : `pp.${chunk.pageStart}–${chunk.pageEnd}`;
    const snippet = chunk.text.slice(0, 250).replace(/\s+/g, " ").trim();
    const ellipsis = chunk.text.length > 250 ? "…" : "";

    lines.push(`\n[Result ${i + 1}] Section: ${chunk.sectionLabel} | ${pageStr} | Score: ${score.toFixed(2)}`);
    lines.push(`  "${snippet}${ellipsis}"`);

    ranges.push({
      startOffset: chunk.startOffset,
      endOffset: Math.min(chunk.startOffset + 250, chunk.endOffset),
      source: `search:${query}`,
    });
  }

  return {
    output: lines.join("\n"),
    rangesRead: ranges,
  };
}

/**
 * get_section — full text of a clause by number or heading
 */
export function toolGetSection(
  docs: AgentDocContext[],
  args: unknown
): ToolResult {
  const parsed = GetSectionSchema.safeParse(args);
  if (!parsed.success) {
    return {
      output: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}. Required: identifier (string). Optional: document_label (string).`,
      rangesRead: [],
      error: "validation_error",
    };
  }

  const { identifier, document_label } = parsed.data;
  const doc = resolveDoc(docs, document_label);
  if (!doc) return noDocError(document_label);

  const normId = identifier.trim().toLowerCase();

  // Strategy 1: match section label exactly or by leading number
  let matched = doc.chunks.find(
    (c) => c.sectionLabel.toLowerCase() === normId ||
           c.sectionLabel.toLowerCase().startsWith(normId + " ") ||
           c.sectionLabel.toLowerCase().startsWith(normId + ".")
  );

  // Strategy 2: match by heading text in first line of chunk
  if (!matched) {
    matched = doc.chunks.find((c) => {
      const firstLine = c.text.split("\n")[0].trim().toLowerCase();
      return firstLine.includes(normId) || firstLine.startsWith(normId);
    });
  }

  // Strategy 3: search for the text anywhere in sectionLabel
  if (!matched) {
    matched = doc.chunks.find((c) =>
      c.sectionLabel.toLowerCase().includes(normId)
    );
  }

  if (!matched) {
    return {
      output: `Section "${identifier}" not found in ${doc.name}. Try using list_clauses to see available sections, or search_document to find relevant text.`,
      rangesRead: [],
    };
  }

  const text = matched.text;
  const truncated = text.length > MAX_SECTION_CHARS;
  const output = [
    `Section: ${matched.sectionLabel} | pp.${matched.pageStart}–${matched.pageEnd} | ${doc.name}`,
    truncated
      ? `${text.slice(0, MAX_SECTION_CHARS)}\n\n[Note: truncated at ${MAX_SECTION_CHARS} chars. Full section is ${text.length} chars. Use get_page to read more.]`
      : text,
  ].join("\n\n");

  return {
    output,
    rangesRead: [{
      startOffset: matched.startOffset,
      endOffset: truncated ? matched.startOffset + MAX_SECTION_CHARS : matched.endOffset,
      source: `section:${identifier}`,
    }],
    truncated,
  };
}

/**
 * get_page — full text of a specific page
 */
export function toolGetPage(
  docs: AgentDocContext[],
  args: unknown
): ToolResult {
  const parsed = GetPageSchema.safeParse(args);
  if (!parsed.success) {
    return {
      output: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}. Required: page (integer >= 1). Optional: document_label (string).`,
      rangesRead: [],
      error: "validation_error",
    };
  }

  const { page, document_label } = parsed.data;
  const doc = resolveDoc(docs, document_label);
  if (!doc) return noDocError(document_label);

  if (page > doc.totalPages) {
    return {
      output: `Page ${page} does not exist. ${doc.name} has ${doc.totalPages} pages.`,
      rangesRead: [],
      error: "page_out_of_range",
    };
  }

  // Find page from pages index
  const pageRecord = doc.pages.find((p) => p.pageNumber === page);
  if (!pageRecord) {
    // Fallback: estimate page slice from canonical text
    const approxCharsPerPage = Math.ceil(doc.canonicalText.length / doc.totalPages);
    const startOffset = (page - 1) * approxCharsPerPage;
    const endOffset = Math.min(doc.canonicalText.length, page * approxCharsPerPage);
    const text = doc.canonicalText.slice(startOffset, endOffset);
    const truncated = text.length > MAX_PAGE_CHARS;

    return {
      output: [
        `Page ${page} (estimated) | ${doc.name}`,
        truncated ? `${text.slice(0, MAX_PAGE_CHARS)}\n\n[Truncated at ${MAX_PAGE_CHARS} chars]` : text,
      ].join("\n\n"),
      rangesRead: [{
        startOffset,
        endOffset: truncated ? startOffset + MAX_PAGE_CHARS : endOffset,
        source: `page:${page}`,
      }],
      truncated,
    };
  }

  const { startOffset, endOffset } = pageRecord;
  const text = doc.canonicalText.slice(startOffset, endOffset);
  const truncated = text.length > MAX_PAGE_CHARS;

  return {
    output: [
      `Page ${page} | ${doc.name}`,
      truncated ? `${text.slice(0, MAX_PAGE_CHARS)}\n\n[Truncated at ${MAX_PAGE_CHARS} chars. Full page is ${text.length} chars.]` : text,
    ].join("\n\n"),
    rangesRead: [{
      startOffset,
      endOffset: truncated ? startOffset + MAX_PAGE_CHARS : endOffset,
      source: `page:${page}`,
    }],
    truncated,
  };
}

/**
 * Dispatch a tool call by name. Returns error result for unknown tools.
 */
export function executeTool(
  name: string,
  args: unknown,
  docs: AgentDocContext[]
): ToolResult {
  switch (name) {
    case "list_clauses":   return toolListClauses(docs, args);
    case "search_document": return toolSearchDocument(docs, args);
    case "get_section":    return toolGetSection(docs, args);
    case "get_page":       return toolGetPage(docs, args);
    default:
      return {
        output: `Unknown tool "${name}". Valid tools: ${TOOL_NAMES.join(", ")}.`,
        rangesRead: [],
        error: "unknown_tool",
      };
  }
}

/**
 * Build a coverage object from an accumulated set of ReadRanges.
 */
export function buildAgentCoverage(
  rangesRead: ReadRange[],
  doc: AgentDocContext
): { pagesRead: number[]; complete: boolean; summaryText: string; chunksRead: number } {
  if (rangesRead.length === 0) {
    return { pagesRead: [], complete: false, summaryText: "No document text was read.", chunksRead: 0 };
  }

  // Map ranges to pages
  const pagesReadSet = new Set<number>();
  for (const range of rangesRead) {
    for (const p of doc.pages) {
      if (range.startOffset < p.endOffset && range.endOffset > p.startOffset) {
        pagesReadSet.add(p.pageNumber);
      }
    }
  }

  const pagesRead = Array.from(pagesReadSet).sort((a, b) => a - b);
  const complete = pagesRead.length === doc.totalPages;
  const summaryText = complete
    ? `Read all ${doc.totalPages} pages.`
    : `Based on ${rangesRead.length} tool retrievals covering pages ${pagesRead.join(", ")} (${pagesRead.length} of ${doc.totalPages}).`;

  return {
    pagesRead,
    complete,
    summaryText,
    chunksRead: rangesRead.length,
  };
}
