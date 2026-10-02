# ClauseLens — Agentic Deep Research Mode

> **File**: `docs/agent.md`  
> Last updated: Part C, Option 2 implementation.

---

## 1. Overview

The **Deep Research** mode is an agentic loop where the AI model issues tool calls to explore the contract, rather than receiving the entire document text in the prompt.

This solves two key problems:
- **Context length limits**: Large contracts (50+ pages) cannot fit in a single prompt.
- **Focused retrieval**: The model reads only what is relevant, reducing hallucination risk.

Toggle: Click **Quick Answer** → **Deep Research** in the chat composer. The toggle is in the bottom-left of the composer bar.

---

## 2. Architecture

```
User question
    │
    ▼
┌─────────────────────────────────────┐
│  lib/agent/run.ts — runAgentLoop()  │
│                                     │
│  Round 1:                           │
│    Model ← [system + question]      │
│    Model → tool_call: list_clauses  │
│    Tool result → Model              │
│                                     │
│  Round 2:                           │
│    Model → tool_call: search_document│
│    Tool result → Model              │
│                                     │
│  Round N:                           │
│    Model → (no tool call) = ANSWER  │
│    Streaming final answer           │
│    Quote verification               │
│    Coverage + absence guard         │
└─────────────────────────────────────┘
    │
    ▼
SSE stream: agent_step, token, quotes, coverage, done
    │
    ▼
AgentTimeline component in ChatInterface
```

---

## 3. Tools (`lib/agent/tools.ts`)

All tools are **pure functions** — no network calls, no side effects.  
Every tool result records `rangesRead: ReadRange[]` for honest coverage.

| Tool | Arguments | Returns |
|------|-----------|---------|
| `list_clauses` | `document_label?` | Numbered outline of all clauses (label + page). Capped at 80 entries. |
| `search_document` | `query`, `top_k? (1-5)`, `document_label?` | BM25 results: chunk id, section label, page, 250-char snippet. |
| `get_section` | `identifier`, `document_label?` | Full text of a clause by number (e.g. `"12.3"`) or heading. Truncated to 2000 chars. |
| `get_page` | `page`, `document_label?` | Text of one page. Truncated to 2000 chars. |

### Validation (Zod)

Every tool validates its arguments with a Zod schema before execution. Invalid arguments produce:
```
Error: validation_error
Output: "Invalid arguments: <field>: <message>. Required: ..."
```

This output is fed back to the model as a tool result, allowing it to self-correct.

---

## 4. Agent Loop (`lib/agent/run.ts`)

### Hard Caps (env-configurable)

| Variable | Default | Effect |
|----------|---------|--------|
| `AGENT_MAX_ROUNDS` | `6` | Maximum tool-call rounds before forcing final answer |
| `AGENT_MAX_TOKENS` | `12000` | Total estimated tokens across all rounds |
| `AGENT_MAX_WALL_MS` | `55000` | Wall-clock limit (kept under route's 60s maxDuration) |
| `MAX_TOOLS_PER_ROUND` | `3` (hardcoded) | Tool calls per model response |

### Error Handling

| Failure Mode | Behavior |
|-------------|----------|
| Unknown tool name | Returns `unknown_tool` error message as tool result; model can retry |
| Invalid JSON arguments | Parse error fed back to model as tool result |
| Zod validation error | Friendly error message fed back; consecutive count incremented |
| 2 consecutive invalid calls | Loop exits with `stoppedReason: "consecutive_invalid"` |
| Repeated identical tool call | Cached result returned + "already retrieved" note |
| Provider 400 (malformed tool call) | Fallback message fed back to model |
| Abort signal | `stoppedReason: "aborted"` |
| Round cap hit | `stoppedReason: "round_cap"` → forced final answer |
| Token cap hit | `stoppedReason: "token_cap"` → forced final answer |
| Wall clock exceeded | `stoppedReason: "wall_clock"` → forced final answer |

### Final Answer

After tool rounds complete (or caps hit), the model produces a streaming final answer.  
The system appends a reminder: "include `<quotes>[...]</quotes>` block".

The final answer is parsed for:
- `<quotes>[{"n":1,"quote":"verbatim text","doc":"D1"}]</quotes>` blocks
- Our code verifies each quote against the canonical text (Rule 1: never trust AI positions)
- Coverage is computed from `rangesRead` across all tool calls (Rule 2: honest coverage)
- `guardApproved()` intercepts absence phrases when coverage is incomplete

---

## 5. SSE Events

| Event | Data | Description |
|-------|------|-------------|
| `meta` | `{ messageId, conversationId, agentMode: true }` | Initial metadata |
| `status` | `{ text }` | Human-readable status message |
| `agent_step` | `AgentStep` | One step card: `{ round, maxRounds, tool, label, status, elapsedMs }` |
| `token` | `{ text }` | Streaming token of the final answer |
| `agent_done` | `{ totalRounds, stoppedReason, trace }` | Summary when loop finishes |
| `quotes` | `{ items: VerifiedAgentQuote[] }` | Verified quote array |
| `coverage` | `CoverageObject` | Coverage report |
| `done` | `{}` | Stream complete |
| `error` | `{ message, retryable }` | Fatal error |

---

## 6. AgentTimeline UI Component

The `AgentTimeline` React component (inlined in `ChatInterface.tsx`) renders a collapsible timeline card:

- **While streaming**: Shows "Deep Research · Step N of 6" + spinner on running step
- **After done**: Collapses to "Researched in N steps · Xs"
- Each step card shows: tool icon, human label, round number, elapsed time
- Step status: `running` (spinner), `done` (green checkmark), `error` (red triangle)
- Stop-reason warning banner for non-finished exits
- Persisted in message history via `msg.trace` field

---

## 7. Multi-Document Support

All tools accept `document_label` (e.g. `"D1"`, `"D2"`) to target a specific document.  
If omitted, defaults to the first document.

The system prompt lists all available documents with their labels.  
Coverage is computed from the primary document (first doc) for the coverage badge.

---

## 8. Invariant Rules

### Rule 1: Never trust AI positions
The AI is never allowed to return `start_offset`, `end_offset`, or page numbers.  
It may only return verbatim `quote` strings inside `<quotes>...</quotes>`.  
Our code locates each quote in the canonical text using `verifyQuote()`.

### Rule 2: Honest coverage  
If only subset of the document was read, the answer is prefixed with:  
> "Based on N tool retrievals covering pages X, Y (Z of T pages)..."

The `guardApproved()` function intercepts any absence claims made with incomplete coverage.

---

## 9. Known Limitations

1. **Tool call support**: Requires provider API support for the `tools` parameter. Groq supports this; some older OpenAI-compatible providers may not.  
2. **Free-tier TPM**: Each round costs 400–800 tokens. 6 rounds may approach the 8k/min limit for small models.  
3. **Streaming + tool calls**: Tool-call rounds are non-streaming (must wait for full response). Only the final answer streams.  
4. **No cross-round memory**: Each round sees the full message history, but tool results are not summarized — the context grows each round.

---

## 10. Testing

```sh
npm test -- --reporter=verbose test/agent.test.ts
```

Tests in `test/agent.test.ts` cover:
- Unknown tool names
- Missing/invalid Zod arguments  
- Nonsense parameters (negative page, too-large top_k, wrong types)
- Malformed JSON arguments (null, array, number passed as args)
- Multi-doc label resolution (D1, D2, D99)
- Coverage tracking (rangesRead contents)
- buildAgentCoverage edge cases
