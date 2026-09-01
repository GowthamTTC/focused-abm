import OpenAI from "openai";
import { env } from "@/lib/env";
import { TOOL_DEFS, runTool, type ToolCtx } from "./tools";
import { suggestFollowups } from "./suggest";
import { habitBlock, topTopic, type NovaLearn } from "./learn";

const client = new OpenAI({
  apiKey: env.OPENROUTER_API_KEY,
  baseURL: env.LLM_BASE_URL,
  defaultHeaders: {
    "HTTP-Referer": env.APP_URL,
    "X-Title": "Focused ABM Agent",
  },
});

const SYSTEM = `You are the Focused ABM assistant for THIS user's private workspace (their LinkedIn network only).
You can search people/titles/companies, shortlist, enrich, run Radar, list drafts, and call recommend_next (all six rankers).

Every reply MUST:
1. Use tools for numbers. Never invent counts.
2. Lead with numbers (e.g. "14 VPs across 6 companies. Capital One has 5 — 36%.").
3. Name the top account share when relevant.
4. End with a single **Recommendation:** line. If the user asks what to do / who to prioritize, call recommend_next first.
5. Writes (shortlist, enrich, Radar) ALWAYS ask first. The server ignores confirm unless the user just said yes / on my behalf.
8. After a confirmed write, point them at the deeplink for that bucket (shortlist, People, Review, Radar).
9. After a confirmed shortlist, list people at that account and offer enrich for full visibility.
6. Never invent HQ, revenue, or people missing from tool output.
7. Radar is post-search + country, not live GPS.`

export async function runAgent(input: {
  orgId: string;
  page: string;
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  learn?: NovaLearn | null;
}): Promise<{ reply: string; open?: string; openLabel?: string; tools: string[]; suggestions: string[]; pending: { kind: string; title: string; yes: string }[] }> {
  const ctx: ToolCtx = { orgId: input.orgId };
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: `${SYSTEM}\nCurrent page: ${input.page}\n${habitBlock(input.learn)}` },
    ...input.history.slice(-8).map((m) => ({ role: m.role, content: m.content }) as OpenAI.Chat.ChatCompletionMessageParam),
    { role: "user", content: input.message },
  ];

  let open: string | undefined;
  let openLabel: string | undefined;
  const tools: string[] = [];
  const pending: { kind: string; title: string; yes: string }[] = [];
  const WRITES = new Set(["shortlist_account", "enrich_account", "enrich_person", "enrich_shortlist", "start_radar"]);
  const autoYes = /\byes\b/i.test(input.message) && /behalf|shortlist|enrich|scan|radar/i.test(input.message);
  for (let i = 0; i < 4; i++) {
    const res = await client.chat.completions.create({
      model: env.LLM_MODEL_CLASSIFY,
      temperature: 0.2,
      max_tokens: 900,
      tools: TOOL_DEFS,
      messages,
    });
    const choice = res.choices[0];
    if (!choice) break;
    const msg = choice.message;
    const calls = msg.tool_calls;
    if (!calls?.length) {
      const reply = (msg.content ?? "Done.").trim();
      return {
        reply, open, openLabel, tools, pending,
        suggestions: suggestFollowups({ message: input.message, tools, reply, topTopic: topTopic(input.learn) }),
      };
    }
    messages.push({
      role: "assistant",
      content: msg.content ?? "",
      tool_calls: calls,
    });
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = {}; }
      tools.push(call.function.name);
      if (WRITES.has(call.function.name)) args.confirm = autoYes;
      const out = await runTool(ctx, call.function.name, args);
      if (out.pending) pending.push(...out.pending);
      if (out.open) open = out.open;
      if (out.openLabel) openLabel = out.openLabel;
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: out.text,
      });
    }
  }
  const reply = "I ran the tools. Check the page or the top bar for progress.";
  return {
    reply, open, openLabel, tools, pending,
    suggestions: suggestFollowups({ message: input.message, tools, reply, topTopic: topTopic(input.learn) }),
  };
}
