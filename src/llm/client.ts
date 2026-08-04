/**
 * The one LLM seam. Everything goes through complete() so that:
 *  - models are configured per stage (haiku for bulk Stage A, sonnet for Stage B)
 *  - outputs are Zod-validated with one self-healing retry
 *  - swapping OpenRouter for the Anthropic SDK at merge time touches ONLY this file.
 *
 * OpenRouter speaks the OpenAI-compatible API and passes cache_control through
 * to Anthropic, so the big static blocks (the six ICP schemas) are cached.
 */
import OpenAI from "openai";
import { z } from "zod";
import { env } from "@/lib/env";
import { fill, loadPrompt } from "./prompts";

const client = new OpenAI({
  apiKey: env.OPENROUTER_API_KEY,
  baseURL: env.LLM_BASE_URL,
  defaultHeaders: {
    "HTTP-Referer": env.APP_URL,
    "X-Title": "Focused ABM",
  },
});

export type Stage = "classify" | "deepdive";
const modelFor: Record<Stage, string> = {
  classify: env.LLM_MODEL_CLASSIFY,
  deepdive: env.LLM_MODEL_DEEPDIVE,
};

function extractJson(text: string): string {
  // Models occasionally wrap JSON in fences — strip defensively.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.search(/[[{]/);
  return start >= 0 ? body.slice(start) : body;
}

export async function complete<T>(opts: {
  stage: Stage;
  prompt: string;             // prompt name under /prompts
  version?: string;
  vars: Record<string, string>;
  /** Static block worth caching across calls (e.g. the services digest). */
  cachedContext?: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
}): Promise<T> {
  const p = await loadPrompt(opts.prompt, opts.version ?? "v1");
  const system = fill(p.system, opts.vars);
  const user = fill(p.user, opts.vars);

  const systemContent: OpenAI.Chat.ChatCompletionContentPartText[] = opts.cachedContext
    ? [
        { type: "text", text: system },
        // @ts-expect-error cache_control is an Anthropic extension OpenRouter forwards
        { type: "text", text: opts.cachedContext, cache_control: { type: "ephemeral" } },
      ]
    : [{ type: "text", text: system }];

  const ask = async (repairNote?: string) => {
    const res = await client.chat.completions.create({
      model: modelFor[opts.stage],
      max_tokens: opts.maxTokens ?? 4000,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: repairNote ? `${user}\n\n${repairNote}` : user },
      ],
    });
    return res.choices[0]?.message?.content ?? "";
  };

  const first = await ask();
  try {
    return opts.schema.parse(JSON.parse(extractJson(first)));
  } catch (e) {
    const repaired = await ask(
      `Your previous reply was not valid JSON for the required shape (${e instanceof Error ? e.message.slice(0, 300) : "parse error"}). Reply again with ONLY the JSON object/array, no prose, no code fences.`,
    );
    return opts.schema.parse(JSON.parse(extractJson(repaired)));
  }
}
