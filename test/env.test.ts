import { describe, it, expect, vi } from "vitest";

describe("Environment validation", () => {
  it("throws clear error when required variables are missing", async () => {
    // Save original env
    const originalEnv = { ...process.env };
    
    // Clear required env vars
    delete process.env.AI_API_KEY;
    delete process.env.DATABASE_URL;

    // Reset module cache and dynamically import
    vi.resetModules();
    await expect(async () => {
      await import("../lib/env");
    }).rejects.toThrow("Invalid or missing environment variables");

    // Restore env
    process.env = originalEnv;
  });
});
