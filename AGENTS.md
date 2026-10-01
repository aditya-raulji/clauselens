<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ClauseLens — System & Agent Architecture Guide

> **IMPORTANT**: Read this file (`AGENTS.md`) first before designing or modifying any feature in ClauseLens.

---

## 1. Product Summary
ClauseLens is a high-precision, single-user AI contract analysis web application (no authentication required).
- **Core Workflow**: Users upload legal contracts (PDF or DOCX), view canonical text and extracted pages, and chat with an AI analysis engine.
- **Zero-Hallucination & Verified Citations**: Every answer provided by the assistant must be derived ONLY from the uploaded document(s). Every claim is backed by verbatim quotes that our **application code** verifies actually exist in the document text. Clicking a verified quote in the chat immediately opens the document viewer, scrolls to the exact passage, and highlights it.
- **Advanced Modes**:
  - Multi-document queries (e.g. comparing cross-document obligations or rights across multiple contracts).
  - Side-by-side document comparison (clause diffing, change summaries between contract revisions).
  - Agentic deep research mode with structured tool calls.

---

## 2. Strict Design System (Light Theme Only)

ClauseLens follows a bespoke, minimalist legal-tech aesthetic. Strictly light theme only (no dark mode).

### Typography
- **Headlines / Hero Headline**:
  - `Instrument Serif` (italic, weight 400) **ONLY** for the main hero headline (52–64px, letter-spacing `-1.5px`), e.g., *"Understand your contracts, clearly."*
- **Everything Else**:
  - `Inter` (weights 400, 500, 600).
  - Section headings (*Documents*, *Recent contracts*, *Verified sources*, table titles) are always clean, crisp Inter; **NEVER cursive or serif**.

### Color Palette & Tokens
- **Background (`--bg`)**: `#F7F5F0` (warm document paper)
- **Card Background (`--card`)**: `#FCFBF8` (elevated surface)
- **Primary Text (`--text`)**: `#171717` (near-black ink)
- **Secondary Text (`--secondary`)**: `#77736C` (muted slate/pencil)
- **Borders (`--border`)**: `#E7E2D9` (clean 1px structural hairline)
- **Primary Orange (`--primary-orange`)**: `#F97316` (used sparingly: upload button, active nav item, key highlights, processing indicators, selected citation)
- **Verified Green (`--verified-green`)**: `#3F7D58` (100% code-verified quotes and matched sources)
- **Unverified Amber (`--unverified-amber`)**: `#B7791F` (unconfirmed, inferred, or partially matched citations)
- **AI / Research Blue (`--ai-blue`)**: `#5267A8` (deep research mode, reasoning badges, tool calls)

### Radii & Elevation
- **Cards**: `16px` (`rounded-[16px]`)
- **Buttons**: `10–12px` (`rounded-[11px]`)
- **Inputs & Textareas**: `12px` (`rounded-[12px]`)
- **Badges / Pills**: `999px` (`rounded-full`)
- **Shadows**: Prefer crisp `1px` borders (`#E7E2D9`) over drop shadows. The only permitted shadow is:
  `box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);`

### UI Components (`components/ui`)
All reusable primitives follow this design system:
- `Button` (`primary`, `secondary`, `ghost`)
- `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`
- `Badge` (`neutral`, `verified`, `unverified`, `ai`, `processing`)
- `Input` & `Textarea`
- `Dialog` (accessible modal dialog with backdrop)
- `Toast` (with `ToastProvider` and `useToast`)
- `Skeleton`
- `EmptyState`
- `ErrorState`
- `ProgressBar`
- `Spinner`

---

## 3. Architecture & Stack Decisions

### Backend & Database
- **Framework**: Next.js App Router (TypeScript).
- **Database**: Neon Serverless PostgreSQL with Drizzle ORM (`@neondatabase/serverless`, `drizzle-orm/neon-http`).
- **File Storage Abstraction (`lib/storage.ts`)**:
  - Original PDF/DOCX binary files are stored in PostgreSQL `bytea` (`document_files` table).
  - Kept strictly out of the main `documents` table so listings, searches, and status queries remain ultra-lightweight.
  - Interfaced via `saveFile(docId, bytes)` and `getFile(docId)` to allow seamless future migration to Vercel Blob or S3.
- **Chunked File Uploads (`upload_parts`)**:
  - Vercel and serverless functions enforce a strict ~4.5MB request body payload limit.
  - Large agreements (>4MB) must be uploaded in chunked parts and assembled into `document_files` upon completion.

### AI Engine & Free-Tier Guardrails (`lib/ai/client.ts`)
- **Provider & SDK**: OpenAI-compatible client targeting Groq / OpenAI endpoint (`AI_BASE_URL`).
- **Free-Tier Limits**:
  - Free tier models (e.g. Groq) operate under strict constraints: ~8,000 Tokens Per Minute (TPM) and ~200,000 tokens/day per model.
  - Every prompt must stay small, concise, and focused. Never dump 50 pages into a single prompt.
- **Concurrency Limiter**: Maximum 2 concurrent in-flight requests.
- **TPM Budgeter**: Sliding 60-second window tracking token consumption (`chars / 4 + maxTokens`). Requests that would exceed the limit are queued and delayed rather than failing.
- **Model Fallback Chain**: Starts with `AI_MODEL`, falling back to each comma-separated model in `AI_FALLBACK_MODELS` upon 429 rate limit or daily quota exhaustion.
- **Exponential Backoff**: Backoff with jitter on 429/5xx, honoring `Retry-After`. Emits `{ type: 'rate_limited', retryInSec, model }`.
- **Reasoning Effort**: For `gpt-oss` models, sends `reasoning_effort: "low"`.
- **Usage Tracking**: Records tokens into `ai_usage` table per day.

---

## 4. Invariant Engineering Rules

### Rule 1: Never trust AI-reported positions or page numbers; locate quotes ourselves
- LLMs routinely hallucinate line numbers, page numbers, character offsets, and subtle phrasing alterations.
- The AI assistant is only allowed to return quote strings.
- **Our code** must locate the quote in the canonical document text using strict exact matching (with normalized whitespace/punctuation fallback) and compute the exact `start_offset`, `end_offset`, and page number. If the code cannot find the quote in the document text, mark it as `unverified` and do not generate a misleading link.

### Rule 2: If only part of a document was read, never answer as if all was read
- If prompt budget constraints or chunk retrieval limits mean only an excerpt or subset of chunks were provided to the model, the response must transparently state the coverage percentage or sections analyzed.
- Never state "The contract contains no clause regarding X" unless 100% of the contract was examined. If partially read, state: *"Based on the analyzed sections (Sections 1–4, 42% coverage), no indemnification clause was found."*

---

## 5. Git & Development Workflow

- **Conventional Commits**: Format commit messages as `chore: ...`, `feat: ...`, `fix: ...`, `refactor: ...`.
- **Security Check**: Always verify `git status` to ensure `.env`, `.env.local`, or any `.env*.local` files are NEVER staged or committed. Only `.env.example` may be tracked.
- **Verification Before Final Commit**:
  - Run `npm test` (Vitest unit tests) and ensure all tests pass.
  - Run `npm run build` (Next.js production build) to verify type integrity and static generation.
- **Push**: Push to current branch with `git push origin <branch>`.
