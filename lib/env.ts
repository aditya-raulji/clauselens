import { z } from "zod";

const envSchema = z.object({
  AI_API_KEY: z.string().min(1, "AI_API_KEY is required"),
  AI_BASE_URL: z
    .string()
    .min(1, "AI_BASE_URL is required")
    .default("https://api.groq.com/openai/v1"),
  AI_MODEL: z.string().min(1, "AI_MODEL is required"),
  AI_FALLBACK_MODELS: z.string().default(""),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
});

function validateEnv() {
  const parsed = envSchema.safeParse({
    AI_API_KEY: process.env.AI_API_KEY,
    AI_BASE_URL: process.env.AI_BASE_URL || "https://api.groq.com/openai/v1",
    AI_MODEL: process.env.AI_MODEL,
    AI_FALLBACK_MODELS: process.env.AI_FALLBACK_MODELS ?? "",
    DATABASE_URL: process.env.DATABASE_URL,
  });

  if (!parsed.success) {
    const missingOrInvalid = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    const message = `❌ Invalid or missing environment variables:\n${missingOrInvalid}\n\nPlease check your .env.local or .env file.`;
    throw new Error(message);
  }

  return {
    ...parsed.data,
    fallbackModels: parsed.data.AI_FALLBACK_MODELS
      ? parsed.data.AI_FALLBACK_MODELS.split(",").map((m) => m.trim()).filter(Boolean)
      : [],
  };
}

export const env = validateEnv();
