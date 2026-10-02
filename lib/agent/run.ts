/**
 * lib/agent/run.ts
 *
 * Agentic deep research loop for ClauseLens.
 *
 * Design:
 *  - Multi-round model → tool → result loop
 *  - HARD CAPS: max rounds, token budget, wall-clock limit, max tool calls/round
 *  - All errors are fed back as tool results (never crash)
 *  - Repeated identical calls return cached result
 *  - 2 consecutive invalid calls → force final answer
 *  - Tool rounds non-streaming; final answer streamed
 *  - SSE events emitted via onStep callback
 *  - Abort signal respected at every await
 */

import { aiClient, ChatMessage } from "@/lib/ai/client";
import {
  AgentDocContext,
  executeTool,
  TOOL_NAMES,
  TOOL_DEFINITIONS,
  ReadRange,
  buildAgentCoverage,
} from "./tools";
export type { AgentDocContext } from "./tools";
import { verifyQuote } from "@/lib/quotes/verify";
import { guardApproved, CoverageObject, formatPageRanges } from "@/lib/coverage";

// ── Configuration ─────────────────────────────────────────────────────────────

const MAX_ROUNDS    = parseInt(process.env.AGENT_MAX_ROUNDS    || "6", 10);
const MAX_TOKENS    = parseInt(process.env.AGENT_MAX_TOKENS    || "12000", 10);
const MAX_WALL_MS   = parseInt(process.env.AGENT_MAX_WALL_MS   || "55000", 10); // < route maxDuration
const MAX_TOOLS_PER_ROUND = 3;
const TOOL_RESULT_MAX_CHARS = 2000; // truncate tool results so they don't blow the context

// ── SSE event types ───────────────────────────────────────────────────────────

export interface AgentStep {
  round: number;
  maxRounds: number;
  tool: string;
  label: string;     // human-friendly description
  status: "running" | "done" | "error";
  elapsedMs?: number;
  error?: string;
}

export interface AgentRunOptions {
  docs: AgentDocContext[];          // single or multi-doc
  primaryDoc: AgentDocContext;      // first/only doc (for coverage)
  question: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  signal?: AbortSignal;
  onStep?: (step: AgentStep) => void;
  onToken?: (text: string) => void;
  onRateLimited?: (retryInSec: number) => void;
}

export interface AgentRunResult {
  answer: string;
  quotes: VerifiedAgentQuote[];
  coverage: CoverageObject;
  trace: AgentStep[];
  stoppedReason: "finished" | "round_cap" | "token_cap" | "wall_clock" | "consecutive_invalid" | "aborted" | "error";
  totalRounds: number;
}

export interface VerifiedAgentQuote {
  n: number;
  quote: string;
  status: "verified" | "unverified";
  reason?: string;
  startOffset?: number;
  endOffset?: number;
  pageStart?: number;
  pageEnd?: number;
  occurrences?: Array<{ start: number; end: number }>;
  ambiguous?: boolean;
  doc?: string;
}

// ── Human-readable tool labels ────────────────────────────────────────────────

function toolLabel(toolName: string, args: any): string {
  switch (toolName) {
    case "list_clauses":
      return args?.document_label
        ? `Listing clauses of ${args.document_label}…`
        : "Listing the contract's clauses…";
    case "search_document": {
      const q = args?.query ? `"${String(args.query).slice(0, 60)}"` : "the contract";
      return `Searching for ${q}…`;
    }
    case "get_section": {
      const id = args?.identifier ? `Section ${args.identifier}` : "a section";
      return `Reading ${id}…`;
    }
    case "get_page":
      return `Reading page ${args?.page ?? "?"}…`;
    default:
      return `Calling tool: ${toolName}`;
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(docs: AgentDocContext[]): string {
  const docList = docs.map((d) =>
    `  - ${d.label}: "${d.name}" (${d.totalPages} pages)`
  ).join("\n");

  return `You are a precise legal contract analysis assistant using tool calls to research.

Documents available:
${docList}

Research Strategy:
1. Start with list_clauses to understand the document structure.
2. Use search_document to find relevant clauses by topic.
3. Use get_section to read the full text of important clauses.
4. Use get_page when you need surrounding context.
5. When you have gathered enough evidence, write your final answer WITHOUT any tool calls.

Final Answer Format:
- Answer the question directly, citing evidence with [1], [2] markers.
- After your answer, include a JSON block: <quotes>JSON array</quotes>
- Each quote: { "n": 1, "quote": "verbatim text from document", "doc": "D1" }
- Quotes MUST be verbatim text from the document — never paraphrase.
- State coverage honestly: which sections you read and what percentage of the document was covered.
- If the document was only partially read and you cannot confirm absence, say so explicitly.

IMPORTANT: Never state a clause "does not exist" unless you have read 100% of the relevant sections.`;
}

// ── Quote parsing and verification ───────────────────────────────────────────

function parseQuotesFromAnswer(answer: string): Array<{ n: number; quote: string; doc?: string }> {
  const match = answer.match(/<quotes>([\s\S]*?)<\/quotes>/);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[1].trim());
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((q: any) => typeof q.n === "number" && typeof q.quote === "string");
  } catch {
    return [];
  }
}

function stripQuotesBlock(answer: string): string {
  return answer.replace(/<quotes>[\s\S]*?<\/quotes>/g, "").trim();
}

function verifyAgentQuotes(
  rawQuotes: Array<{ n: number; quote: string; doc?: string }>,
  docs: AgentDocContext[]
): VerifiedAgentQuote[] {
  return rawQuotes.map(({ n, quote, doc: docLabel }) => {
    const targetDoc = docLabel
      ? docs.find((d) => d.label === docLabel) || docs[0]
      : docs[0];

    const result = verifyQuote(quote, targetDoc.canonicalText);

    if (result.status === "verified" && result.occurrences.length > 0) {
      const occ = result.occurrences[0];
      // Map offset to page
      const page = targetDoc.pages.find(
        (p) => occ.start >= p.startOffset && occ.start < p.endOffset
      );
      return {
        n,
        quote,
        status: "verified" as const,
        startOffset: occ.start,
        endOffset: occ.end,
        pageStart: page?.pageNumber,
        pageEnd: page?.pageNumber,
        occurrences: result.occurrences,
        ambiguous: result.ambiguous,
        doc: targetDoc.label,
      };
    }

    return {
      n,
      quote,
      status: "unverified" as const,
      reason: result.reason || "not found in document",
      doc: targetDoc.label,
    };
  });
}

// ── Main agent loop ───────────────────────────────────────────────────────────

export async function runAgentLoop(opts: AgentRunOptions): Promise<AgentRunResult> {
  const { docs, primaryDoc, question, history, signal, onStep, onToken, onRateLimited } = opts;

  const startMs = Date.now();
  const trace: AgentStep[] = [];
  const allRangesRead: ReadRange[] = [];

  // Token budget tracking (rough: chars/4)
  let tokensBudgetUsed = 0;

  // Call result cache to detect repeats
  const callCache = new Map<string, string>();
  let consecutiveInvalidCalls = 0;

  // Build conversation: [system] + history + [user question]
  const systemPrompt = buildSystemPrompt(docs);
  const conversationMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: question },
  ];

  // OpenAI-style messages (tool calls & results)
  const openaiMessages: any[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: question },
  ];

  let stoppedReason: AgentRunResult["stoppedReason"] = "finished";
  let finalAnswer = "";

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    // Wall clock cap
    if (Date.now() - startMs > MAX_WALL_MS) {
      stoppedReason = "wall_clock";
      break;
    }
    // Token budget cap
    if (tokensBudgetUsed >= MAX_TOKENS) {
      stoppedReason = "token_cap";
      break;
    }
    // Abort check
    if (signal?.aborted) {
      stoppedReason = "aborted";
      break;
    }

    // Non-streaming tool-round call
    let response: any;
    try {
      const client = (aiClient as any).getClient?.();

      // Build params with tool_choice auto
      const params: any = {
        model: aiClient.getModelChain()[0],
        messages: openaiMessages,
        tools: TOOL_DEFINITIONS,
        tool_choice: "auto",
        max_tokens: 1000,
        temperature: 0.05,
      };

      // We call raw OpenAI-compatible API for tool support
      response = await (client as any).chat.completions.create(params, { signal });
      tokensBudgetUsed += (response.usage?.total_tokens || 400);
    } catch (err: any) {
      const isAbort = signal?.aborted || err?.name === "AbortError" || err?.code === "ABORTED";
      if (isAbort) { stoppedReason = "aborted"; break; }

      // Provider rejected the tool call (400 malformed tool call)
      const is400 = err?.status === 400 || /tool call validation failed|invalid_request/i.test(err?.message || "");
      if (is400) {
        consecutiveInvalidCalls++;
        openaiMessages.push({
          role: "user",
          content: `[System: The previous tool call was rejected by the provider (${err.message}). Please try again with valid tool arguments or provide a final answer without tool calls.]`,
        });
        if (consecutiveInvalidCalls >= 2) { stoppedReason = "consecutive_invalid"; break; }
        continue;
      }

      stoppedReason = "error";
      finalAnswer = `Research encountered an error: ${err?.message || "unknown"}.`;
      break;
    }

    const choice = response.choices[0];
    if (!choice) { stoppedReason = "error"; break; }

    const message = choice.message;
    openaiMessages.push(message);

    // ── Check if model returned tool calls ───────────────────────────────────
    const toolCalls = message.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      // No tool calls → this is the final answer
      finalAnswer = message.content || "";
      stoppedReason = "finished";
      break;
    }

    // Cap tool calls per round
    const callsThisRound = toolCalls.slice(0, MAX_TOOLS_PER_ROUND);

    // Execute each tool call
    for (const tc of callsThisRound) {
      if (signal?.aborted) { stoppedReason = "aborted"; break; }

      const toolName = tc.function?.name || "unknown";
      let parsedArgs: any = {};

      // Parse JSON args safely
      try {
        parsedArgs = JSON.parse(tc.function?.arguments || "{}");
      } catch {
        parsedArgs = {};
        // Return parse error as tool result
        openaiMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `Error: malformed JSON arguments: "${tc.function?.arguments}". Please provide valid JSON.`,
        });
        consecutiveInvalidCalls++;
        continue;
      }

      const label = toolLabel(toolName, parsedArgs);
      const stepId = trace.length;

      // Emit "running" event
      const step: AgentStep = {
        round,
        maxRounds: MAX_ROUNDS,
        tool: toolName,
        label,
        status: "running",
      };
      trace.push(step);
      onStep?.(step);

      // Check cache for identical call
      const cacheKey = `${toolName}:${JSON.stringify(parsedArgs)}`;
      let toolOutputStr: string;
      let fromCache = false;

      if (callCache.has(cacheKey)) {
        toolOutputStr = callCache.get(cacheKey)! + "\n[Note: already retrieved in a previous step]";
        fromCache = true;
      } else {
        // Execute the tool
        let toolResult = executeTool(toolName, parsedArgs, docs);
        allRangesRead.push(...toolResult.rangesRead);

        // Truncate output to keep context small
        toolOutputStr = toolResult.output.slice(0, TOOL_RESULT_MAX_CHARS);
        if (toolResult.output.length > TOOL_RESULT_MAX_CHARS) {
          toolOutputStr += `\n[Truncated at ${TOOL_RESULT_MAX_CHARS} chars]`;
        }

        callCache.set(cacheKey, toolResult.output.slice(0, TOOL_RESULT_MAX_CHARS));

        // Track consecutive invalid
        if (toolResult.error === "validation_error" || toolResult.error === "unknown_tool") {
          consecutiveInvalidCalls++;
        } else {
          consecutiveInvalidCalls = 0; // reset on success
        }
      }

      // Budget the tool result tokens
      tokensBudgetUsed += Math.ceil(toolOutputStr.length / 4);

      // Append tool result
      openaiMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: toolOutputStr,
      });

      // Update step to done
      const elapsed = Date.now() - startMs;
      trace[stepId] = {
        ...step,
        status: toolOutputStr.startsWith("Error:") || toolOutputStr.startsWith("Invalid") ? "error" : "done",
        elapsedMs: elapsed,
      };
      onStep?.(trace[stepId]);

      // Stop loop if too many consecutive invalid calls
      if (consecutiveInvalidCalls >= 2) { stoppedReason = "consecutive_invalid"; break; }
    }

    if (stoppedReason === "consecutive_invalid") {
      break;
    }

    if (round === MAX_ROUNDS && !finalAnswer) {
      stoppedReason = "round_cap";
    }
  }

  // ── Force final answer on cap ──────────────────────────────────────────────
  const needsForcedAnswer =
    stoppedReason !== "finished" && stoppedReason !== "aborted" && !finalAnswer;

  if (needsForcedAnswer || (stoppedReason === "finished" && !finalAnswer)) {
    // Force a streaming final answer with what was gathered
    const stopMsg = stoppedReason === "round_cap"
      ? "Research stopped at the step limit; this answer may be incomplete."
      : stoppedReason === "token_cap"
      ? "Research stopped due to token budget; this answer may be incomplete."
      : stoppedReason === "wall_clock"
      ? "Research stopped at the time limit; this answer may be incomplete."
      : stoppedReason === "consecutive_invalid"
      ? "Research stopped after repeated invalid tool calls; this answer may be incomplete."
      : "";

    openaiMessages.push({
      role: "user",
      content: stopMsg
        ? `[System: ${stopMsg} Summarize findings from the tools already called. State coverage honestly. Format with [n] citations and <quotes>...</quotes>.] `
        : "Please provide your final answer now. Use [n] citation markers and include a <quotes>[...]</quotes> block.",
    });

    try {
      // Stream final answer
      const streamGen = aiClient.chatStream({
        messages: openaiMessages.map((m: any) => ({
          role: m.role === "tool" ? "user" : m.role,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        })),
        maxTokens: 1400,
        temperature: 0.05,
        signal,
        onRateLimited: (evt) => onRateLimited?.(evt.retryInSec),
      });

      for await (const chunk of streamGen) {
        if (signal?.aborted) { stoppedReason = "aborted"; break; }
        if (chunk.content) {
          finalAnswer += chunk.content;
          onToken?.(chunk.content);
        }
      }
    } catch (err: any) {
      const isAbort = signal?.aborted || err?.name === "AbortError" || err?.code === "ABORTED";
      if (isAbort) stoppedReason = "aborted";
      finalAnswer = finalAnswer || `(Research stopped: ${err?.message || "unknown error"})`;
    }
  } else if (stoppedReason === "finished" && finalAnswer) {
    // Stream already-collected finalAnswer token by token
    for (const ch of finalAnswer) {
      onToken?.(ch);
    }
  }

  // ── Parse + verify quotes ─────────────────────────────────────────────────
  const rawQuotes = parseQuotesFromAnswer(finalAnswer);
  const verifiedQuotes = verifyAgentQuotes(rawQuotes, docs);
  const visibleAnswer = stripQuotesBlock(finalAnswer);

  // ── Build coverage ────────────────────────────────────────────────────────
  const agentCov = buildAgentCoverage(allRangesRead, primaryDoc);
  const coverage: CoverageObject = {
    mode: "retrieval",
    totalPages: primaryDoc.totalPages,
    pagesRead: agentCov.pagesRead,
    chunksRead: agentCov.chunksRead,
    totalChunks: primaryDoc.chunks.length,
    complete: agentCov.complete,
    pageRanges: formatPageRanges(agentCov.pagesRead),
    summaryText: agentCov.summaryText,
  };

  // Apply absence guard
  const guarded = guardApproved(visibleAnswer, coverage);

  return {
    answer: guarded.text,
    quotes: verifiedQuotes,
    coverage,
    trace,
    stoppedReason,
    totalRounds: trace.filter((s) => s.status === "done" || s.status === "error").length,
  };
}
