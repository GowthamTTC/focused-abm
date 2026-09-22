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
  /** Default, not just a .env suggestion: production reads this schema, so a
   *  Railway variable that nobody sets must not silently pin the old prompt. */
  CLASSIFY_PROMPT_VERSION: z.string().default("v8"),
  LLM_MODEL_DEEPDIVE: z.string().default("anthropic/claude-sonnet-4.6"),
  /** Ships at v1 on purpose, the way enrichLimit ships at 10.
   *
   *  v2 is the version Pulse's Network band needs: it adds a sentiment field and
   *  its relevance bands are byte-identical to v1's, checked by
   *  scripts/verify-pulse-pure.ts. But it has never been run against the model,
   *  and the screen it would change first is Today — an existing, working
   *  feature whose ordering depends on the relevance number. Asking a model to
   *  do a third job can move how it does the first two even when the wording
   *  for those is unchanged.
   *
   *  So the version bump is a deliberate act, not a side effect of deploying
   *  Pulse. Set this to v2 when you want the Network band and are ready to look
   *  at Today afterwards. Seats with the band gated off lose nothing by waiting. */
  POST_RELEVANCE_PROMPT_VERSION: z.string().default("v1"),

  UNIPILE_API_KEY: z.string().optional().or(z.literal("")),
  UNIPILE_DSN: z.string().optional().or(z.literal("")),

  APP_URL: z.string().url().default("http://localhost:3000"),
  /** Shared secret for Unipile (or other) webhooks. Required in production. */
  WEBHOOK_SECRET: z.string().min(16).optional().or(z.literal("")),
  DEEP_ENRICH_DAILY_CAP: z.coerce.number().int().positive().default(80),
  DEEP_ENRICH_MIN_GAP_SECONDS: z.coerce.number().int().positive().default(25),
  ACTIVITY_SCAN_DAILY_CAP: z.coerce.number().int().positive().default(100),
  ACTIVITY_SCAN_MIN_GAP_SECONDS: z.coerce.number().int().positive().default(12),
  EVENT_SCAN_CONCURRENCY: z.coerce.number().int().positive().default(8),
  EVENT_SCAN_MIN_GAP_SECONDS: z.coerce.number().int().min(0).default(0),
  EVENT_SCAN_SKIP_HOURS: z.coerce.number().int().min(0).default(6),
  EVENT_EXTENDED_CAP: z.coerce.number().int().positive().default(100),
  /** Pulse's outbound news fetch. Defaults here, not only in .env.example:
   *  production reads this schema, so an unset Railway variable must not mean
   *  "no timeout". */
  PULSE_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  /** Items ONE news collection keeps per account. The signal judge batches at
   *  25, so this is also what bounds a refresh to a couple of model calls. */
  PULSE_NEWS_MAX_ITEMS: z.coerce.number().int().positive().default(40),
  /** Posts ONE intelligence scan keeps for a company. The signal judge batches
   *  at 25, so 60 is between two and three model calls — enough to read a month
   *  of chatter without turning a curiosity into a bill. */
  INTEL_POSTS_MAX: z.coerce.number().int().positive().default(60),
});

export const env = schema.parse(process.env);
export const unipileConfigured = Boolean(env.UNIPILE_API_KEY && env.UNIPILE_DSN);
