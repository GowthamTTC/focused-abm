import { z } from "zod";

/** Zod-validated env — fail fast at boot, never at request time. */
const schema = z.object({
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),

  OPENROUTER_API_KEY: z.string().min(10),
  LLM_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  LLM_MODEL_CLASSIFY: z.string().default("anthropic/claude-haiku-4.5"),
  CLASSIFY_PROMPT_VERSION: z.string().default("v2"),
  LLM_MODEL_DEEPDIVE: z.string().default("anthropic/claude-sonnet-4.6"),

  UNIPILE_API_KEY: z.string().optional().or(z.literal("")),
  UNIPILE_DSN: z.string().optional().or(z.literal("")),

  APP_URL: z.string().url().default("http://localhost:3000"),
  DEEP_ENRICH_DAILY_CAP: z.coerce.number().int().positive().default(80),
  DEEP_ENRICH_MIN_GAP_SECONDS: z.coerce.number().int().positive().default(25),
  ACTIVITY_SCAN_DAILY_CAP: z.coerce.number().int().positive().default(100),
  ACTIVITY_SCAN_MIN_GAP_SECONDS: z.coerce.number().int().positive().default(12),
});

export const env = schema.parse(process.env);
export const unipileConfigured = Boolean(env.UNIPILE_API_KEY && env.UNIPILE_DSN);
