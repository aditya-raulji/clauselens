import { describe, it, expect, vi, beforeAll } from "vitest";

// Mock db to avoid database connection during AI client unit tests
vi.mock("../lib/db", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(true),
      }),
    }),
  },
}));

vi.mock("../lib/env", () => ({
  env: {
    AI_API_KEY: "mock_api_key",
    AI_BASE_URL: "https://api.groq.com/openai/v1",
    AI_MODEL: "llama-3.3-70b-versatile",
    AI_FALLBACK_MODELS: "llama-3.1-8b-instant,mixtral-8x7b-32768",
    DATABASE_URL: "postgres://mock:mock@localhost:5432/mock",
    fallbackModels: ["llama-3.1-8b-instant", "mixtral-8x7b-32768"],
  },
}));

import { AIClient, FriendlyAIError } from "../lib/ai/client";

describe("AIClient Unit Tests", () => {
  const client = new AIClient();

  it("calculates model chain correctly with primary and comma-separated fallbacks", () => {
    process.env.AI_MODEL = "llama-3.3-70b-versatile";
    process.env.AI_FALLBACK_MODELS = "llama-3.1-8b-instant, mixtral-8x7b-32768";

    const chain = client.getModelChain();
    expect(chain).toEqual([
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "mixtral-8x7b-32768",
    ]);
  });

  it("estimates tokens based on characters / 4 + maxTokens", () => {
    const messages = [
      { role: "system" as const, content: "You are a helpful contract analyst." }, // 36 chars -> 9 tokens
      { role: "user" as const, content: "Summarize this indemnification clause." }, // 38 chars -> 10 tokens
    ]; // Total chars: 74 -> ceil(74/4) = 19
    const estimated = client.estimateTokens(messages, 1500);
    expect(estimated).toBe(19 + 1500);
  });

  it("classifies rate limit errors into friendly messages", () => {
    const err = client.classifyError({
      status: 429,
      message: "Rate limit reached for model in organization",
    });
    expect(err).toBeInstanceOf(FriendlyAIError);
    expect(err.code).toBe("RATE_LIMIT");
    expect(err.message).toContain("AI rate limit reached");
  });

  it("classifies context length exceeded errors into friendly messages", () => {
    const err = client.classifyError({
      status: 400,
      message: "context_length_exceeded: maximum context length is 8192 tokens",
    });
    expect(err.code).toBe("CONTEXT_TOO_LARGE");
    expect(err.message).toContain("Contract excerpt is too large");
  });

  it("classifies 401 authentication errors into friendly messages", () => {
    const err = client.classifyError({
      status: 401,
      message: "invalid_api_key",
    });
    expect(err.code).toBe("INVALID_API_KEY");
  });
});
