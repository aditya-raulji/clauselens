import OpenAI from "openai";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { aiUsage } from "../schema";

export interface RateLimitEvent {
  type: "rate_limited";
  retryInSec: number;
  model: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  onRateLimited?: (event: RateLimitEvent) => void;
  tpmLimit?: number; // default 8,000
}

export interface ChatResult {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface StreamChunk {
  content: string;
  model: string;
  done: boolean;
}

export class FriendlyAIError extends Error {
  public code: string;
  public status?: number;
  public originalMessage: string;

  constructor(message: string, code: string, status?: number, originalMessage?: string) {
    super(message);
    this.name = "FriendlyAIError";
    this.code = code;
    this.status = status;
    this.originalMessage = originalMessage || message;
  }
}

/**
 * Concurrency Limiter (Max 2 concurrent requests)
 */
class ConcurrencyLimiter {
  private current = 0;
  private queue: (() => void)[] = [];

  constructor(private maxConcurrent = 2) {}

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      throw new FriendlyAIError("Request was aborted before execution.", "ABORTED");
    }

    if (this.current < this.maxConcurrent) {
      this.current++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          this.release();
        }
      };
    }

    return new Promise<() => void>((resolve, reject) => {
      const abortHandler = () => {
        const idx = this.queue.indexOf(onAcquire);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
        }
        reject(new FriendlyAIError("Request was aborted while waiting in queue.", "ABORTED"));
      };

      const onAcquire = () => {
        signal?.removeEventListener("abort", abortHandler);
        this.current++;
        let released = false;
        resolve(() => {
          if (!released) {
            released = true;
            this.release();
          }
        });
      };

      if (signal) {
        signal.addEventListener("abort", abortHandler, { once: true });
      }

      this.queue.push(onAcquire);
    });
  }

  private release() {
    this.current--;
    if (this.queue.length > 0 && this.current < this.maxConcurrent) {
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

/**
 * Sliding 60-Second Token-Per-Minute (TPM) Budgeter
 */
class TokenBudgeter {
  private usageHistory: Map<string, { timestamp: number; tokens: number }[]> = new Map();

  constructor(private defaultTpmLimit = 8000) {}

  private cleanOldEntries(model: string, now: number) {
    const history = this.usageHistory.get(model) || [];
    const windowStart = now - 60000;
    const filtered = history.filter((entry) => entry.timestamp > windowStart);
    this.usageHistory.set(model, filtered);
    return filtered;
  }

  getUsedTokensInWindow(model: string, now: number = Date.now()): number {
    const history = this.cleanOldEntries(model, now);
    return history.reduce((sum, item) => sum + item.tokens, 0);
  }

  async acquireTokens(
    model: string,
    tokensNeeded: number,
    limit: number = this.defaultTpmLimit,
    signal?: AbortSignal
  ): Promise<void> {
    while (true) {
      if (signal?.aborted) {
        throw new FriendlyAIError("Operation cancelled.", "ABORTED");
      }

      const now = Date.now();
      const used = this.getUsedTokensInWindow(model, now);

      if (used + tokensNeeded <= limit) {
        // Fits within TPM window
        const history = this.usageHistory.get(model) || [];
        history.push({ timestamp: now, tokens: tokensNeeded });
        this.usageHistory.set(model, history);
        return;
      }

      // Need to wait until oldest tokens roll out of 60s window
      const history = this.usageHistory.get(model) || [];
      if (history.length === 0) {
        // Tokens needed exceeds entire TPM limit alone; allow with throttling
        history.push({ timestamp: now, tokens: tokensNeeded });
        this.usageHistory.set(model, history);
        return;
      }

      const oldest = history[0];
      const waitMs = Math.max(100, oldest.timestamp + 60000 - now + 50);

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", abortHandler);
          resolve();
        }, waitMs);

        const abortHandler = () => {
          clearTimeout(timer);
          reject(new FriendlyAIError("Operation cancelled while waiting for rate budget.", "ABORTED"));
        };

        signal?.addEventListener("abort", abortHandler, { once: true });
      });
    }
  }
}

// Global Singletons for Limiting
const concurrencyLimiter = new ConcurrencyLimiter(2);
const tokenBudgeter = new TokenBudgeter(8000);

export class AIClient {
  private openai: OpenAI | null = null;

  private getClient(): OpenAI {
    if (!this.openai) {
      const apiKey = process.env.AI_API_KEY || "missing_key";
      const baseURL = process.env.AI_BASE_URL || "https://api.groq.com/openai/v1";
      this.openai = new OpenAI({
        apiKey,
        baseURL,
      });
    }
    return this.openai;
  }

  public getModelChain(preferredModel?: string): string[] {
    const primary = preferredModel || process.env.AI_MODEL || "llama-3.3-70b-versatile";
    const fallbacks = (process.env.AI_FALLBACK_MODELS || "")
      .split(",")
      .map((m) => m.trim())
      .filter((m) => m.length > 0 && m !== primary);

    return [primary, ...fallbacks];
  }

  public estimateTokens(messages: ChatMessage[], maxTokens = 1500): number {
    const totalChars = messages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
    const promptTokens = Math.ceil(totalChars / 4);
    return promptTokens + maxTokens;
  }

  public classifyError(error: any): FriendlyAIError {
    const status = error?.status || error?.statusCode;
    const msg = error?.message || String(error);

    if (status === 401 || /invalid_api_key|unauthorized/i.test(msg)) {
      return new FriendlyAIError(
        "Invalid AI API key or unauthorized request. Please check your credentials.",
        "INVALID_API_KEY",
        401,
        msg
      );
    }

    if (
      status === 429 ||
      /rate limit|too many requests|tokens per minute|requests per minute|quota/i.test(msg)
    ) {
      return new FriendlyAIError(
        "AI rate limit reached. ClauseLens is automatically throttling or attempting fallbacks.",
        "RATE_LIMIT",
        429,
        msg
      );
    }

    if (/context_length_exceeded|maximum context length/i.test(msg)) {
      return new FriendlyAIError(
        "Contract excerpt is too large for the model's context window. Please query a smaller section.",
        "CONTEXT_TOO_LARGE",
        400,
        msg
      );
    }

    if (status >= 500 && status < 600) {
      return new FriendlyAIError(
        "AI provider is experiencing service interruptions. ClauseLens will retry.",
        "SERVER_ERROR",
        status,
        msg
      );
    }

    if (error?.name === "AbortError" || /aborted/i.test(msg)) {
      return new FriendlyAIError("Request was cancelled.", "ABORTED", undefined, msg);
    }

    return new FriendlyAIError(
      `AI Service error: ${msg}`,
      "UNKNOWN_ERROR",
      status,
      msg
    );
  }

  private isDailyOrPermanentRateLimit(error: any): boolean {
    const msg = (error?.message || "").toLowerCase();
    return (
      msg.includes("daily") ||
      msg.includes("quota exceeded") ||
      msg.includes("limit reached for today") ||
      msg.includes("insufficient_quota") ||
      msg.includes("monthly")
    );
  }

  private async recordUsage(tokens: number): Promise<void> {
    try {
      if (!tokens || tokens <= 0) return;
      const today = new Date().toISOString().split("T")[0];
      await db
        .insert(aiUsage)
        .values({
          day: today,
          tokens,
        })
        .onConflictDoUpdate({
          target: aiUsage.day,
          set: {
            tokens: sql`${aiUsage.tokens} + ${tokens}`,
          },
        });
    } catch {
      // Non-fatal if database logging fails
    }
  }

  /**
   * Non-streaming chat completion with retry, fallback, rate limiting, and token tracking
   */
  async chat(options: ChatOptions): Promise<ChatResult> {
    const release = await concurrencyLimiter.acquire(options.signal);
    try {
      const models = this.getModelChain(options.model);
      let lastError: any = null;

      for (let mIdx = 0; mIdx < models.length; mIdx++) {
        const currentModel = models[mIdx];
        const estimatedTokens = this.estimateTokens(options.messages, options.maxTokens || 1500);

        // Budget tokens
        await tokenBudgeter.acquireTokens(
          currentModel,
          estimatedTokens,
          options.tpmLimit || 8000,
          options.signal
        );

        // Retry loop for the current model
        const maxRetries = 3;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          if (options.signal?.aborted) {
            throw new FriendlyAIError("Chat request aborted.", "ABORTED");
          }

          try {
            const client = this.getClient();
            const isGptOss = currentModel.toLowerCase().includes("gpt-oss");

            const completionParams: any = {
              model: currentModel,
              messages: options.messages as any,
              max_tokens: options.maxTokens || 1500,
              temperature: options.temperature ?? 0.1,
            };

            if (isGptOss) {
              completionParams.reasoning_effort = "low";
            }

            const response = await client.chat.completions.create(completionParams, {
              signal: options.signal,
            });

            const choice = response.choices[0];
            const content = choice?.message?.content || "";
            const usage = response.usage || {
              prompt_tokens: Math.ceil(estimatedTokens * 0.7),
              completion_tokens: Math.ceil(content.length / 4),
              total_tokens: estimatedTokens,
            };

            // Record token usage
            await this.recordUsage(usage.total_tokens);

            return {
              content,
              model: response.model || currentModel,
              usage: {
                promptTokens: usage.prompt_tokens,
                completionTokens: usage.completion_tokens,
                totalTokens: usage.total_tokens,
              },
            };
          } catch (err: any) {
            lastError = err;
            const status = err?.status || err?.statusCode;
            const isRateLimit = status === 429 || /rate limit/i.test(err?.message || "");
            const isServerErr = status >= 500 && status < 600;

            // Check if daily quota is exceeded -> advance model chain immediately
            if (this.isDailyOrPermanentRateLimit(err)) {
              break; // break retry loop to try next fallback model
            }

            if ((isRateLimit || isServerErr) && attempt < maxRetries) {
              // Parse Retry-After header if available
              let retryInSec = 2;
              const headerRetry = err?.headers?.["retry-after"];
              if (headerRetry) {
                const parsed = parseInt(headerRetry, 10);
                if (!isNaN(parsed) && parsed > 0) retryInSec = parsed;
              } else {
                // Exponential backoff with jitter
                const base = 1.5;
                const jitter = Math.random() * 0.5;
                retryInSec = Math.min(10, Math.pow(base, attempt + 1) + jitter);
              }

              if (options.onRateLimited) {
                options.onRateLimited({
                  type: "rate_limited",
                  retryInSec: Math.round(retryInSec),
                  model: currentModel,
                });
              }

              await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(resolve, retryInSec * 1000);
                options.signal?.addEventListener(
                  "abort",
                  () => {
                    clearTimeout(timer);
                    reject(new FriendlyAIError("Aborted during retry delay", "ABORTED"));
                  },
                  { once: true }
                );
              });
              continue; // retry same model
            }

            // If 429 after retries, proceed to next model in fallback chain
            if (isRateLimit && mIdx < models.length - 1) {
              break;
            }

            throw this.classifyError(err);
          }
        }
      }

      throw this.classifyError(lastError);
    } finally {
      release();
    }
  }

  /**
   * Streaming chat completion with fallback and AbortSignal support
   */
  async *chatStream(
    options: ChatOptions
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const release = await concurrencyLimiter.acquire(options.signal);
    try {
      const models = this.getModelChain(options.model);
      let lastError: any = null;

      for (let mIdx = 0; mIdx < models.length; mIdx++) {
        const currentModel = models[mIdx];
        const estimatedTokens = this.estimateTokens(options.messages, options.maxTokens || 1500);

        await tokenBudgeter.acquireTokens(
          currentModel,
          estimatedTokens,
          options.tpmLimit || 8000,
          options.signal
        );

        try {
          const client = this.getClient();
          const isGptOss = currentModel.toLowerCase().includes("gpt-oss");

          const stream = await client.chat.completions.create(
            {
              model: currentModel,
              messages: options.messages as any,
              max_tokens: options.maxTokens || 1500,
              temperature: options.temperature ?? 0.1,
              stream: true,
              ...(isGptOss ? { reasoning_effort: "low" as any } : {}),
            },
            {
              signal: options.signal,
            }
          );

          let accumulatedChars = 0;

          for await (const chunk of stream) {
            if (options.signal?.aborted) {
              throw new FriendlyAIError("Stream cancelled.", "ABORTED");
            }
            const text = chunk.choices[0]?.delta?.content || "";
            if (text) {
              accumulatedChars += text.length;
              yield {
                content: text,
                model: currentModel,
                done: false,
              };
            }
          }

          // Estimate streaming tokens used
          const completionTokens = Math.ceil(accumulatedChars / 4);
          const totalTokens = Math.ceil(estimatedTokens * 0.7) + completionTokens;
          await this.recordUsage(totalTokens);

          yield {
            content: "",
            model: currentModel,
            done: true,
          };
          return;
        } catch (err: any) {
          lastError = err;
          const status = err?.status || err?.statusCode;
          const isRateLimit = status === 429 || /rate limit/i.test(err?.message || "");

          if ((isRateLimit || this.isDailyOrPermanentRateLimit(err)) && mIdx < models.length - 1) {
            // Fallback to next model in chain
            if (options.onRateLimited) {
              options.onRateLimited({
                type: "rate_limited",
                retryInSec: 1,
                model: currentModel,
              });
            }
            continue;
          }

          throw this.classifyError(err);
        }
      }

      throw this.classifyError(lastError);
    } finally {
      release();
    }
  }
}

export const aiClient = new AIClient();
