import OpenAI from "openai";
import { env } from "@/lib/env";
import { TOOL_DEFS, runTool, type ToolCtx } from "./tools";
import { suggestFollowups } from "./suggest";
import { habitBlock, topTopic, type NovaLearn } from "./learn";
import { classifyIntent, followupsFor, fallbackReply } from "./intent";

const client = new OpenAI({
  apiKey: env.OPENROUTER_API_KEY,
  baseURL: env.LLM_BASE_URL,
  defaultHeaders: {
    "HTTP-Referer": env.APP_URL,
    "X-Title": "Focused ABM Agent",
  },
});

const SYSTEM = `You are Nova, the Focused ABM assistant for THIS user's private workspace only.
Use tool output as ground truth. Never invent HQ, revenue, counts, or people.
"Top N accounts" = best ICP matches (may include shortlisted).
"Next N accounts" = best ICP matches that are NOT shortlisted. Never repeat the shortlisted page.
Writes need permission; the server already asked Yes/No when needed.
Radar is post-search + country, not live GPS.
Talk like a sharp coworker. End with **Recommendation:** when you suggest a next step.`;

export async function runAgent(input: {
  orgId: string;
  page: string;
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  learn?: NovaLearn | null;
}): Promise<{
  reply: string;
  open?: string;
  openLabel?: string;
  tools: string[];
  suggestions: string[];
  pending: { kind: string; title: string; yes: string; tone?: string }[];
  cards: { kind: string; title: string; subtitle?: string; pills: string[] }[];
}> {
  const ctx: ToolCtx = { orgId: input.orgId };
  const intent = classifyIntent(input.message, input.history);
  const tools: string[] = [];
  const pending: { kind: string; title: string; yes: string; tone?: string }[] = [];
  const cards: { kind: string; title: string; subtitle?: string; pills: string[] }[] = [];
  let open: string | undefined;
  let openLabel: string | undefined;
  let toolText = "";

  const apply = async (name: string, args: Record<string, unknown>) => {
    const WRITES = new Set(["shortlist_top", "shortlist_account", "unshortlist_account", "clear_shortlist", "radar_floor", "enrich_account", "enrich_person", "enrich_shortlist", "start_radar", "mark_sent", "undo_sent", "flag_person", "sync_network", "stop_jobs"]);
    if (WRITES.has(name)) args.confirm = intent.autoYes;
    if (name === "recommend_next") {
      args.n = args.n ?? intent.n;
      if (intent.skipShortlisted) args.skipShortlisted = true;
    }
    if (name === "shortlist_top") {
      args.n = args.n ?? intent.n;
      if (intent.skipShortlisted || intent.args.skipShortlisted) args.skipShortlisted = true;
    }
    tools.push(name);
    const out = await runTool(ctx, name, args);
    if (out.pending && (intent.wantsWrite || intent.autoYes)) pending.push(...out.pending);
    if (out.cards) cards.push(...out.cards);
    if (out.open) open = out.open;
    if (out.openLabel) openLabel = out.openLabel;
    toolText = [toolText, out.text].filter(Boolean).join("\n");
    return out;
  };

  if (intent.tool) {
    await apply(intent.tool, { ...intent.args });
  } else {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: `${SYSTEM}\nCurrent page: ${input.page}\n${habitBlock(input.learn)}` },
      ...input.history.slice(-8).map((m) => ({ role: m.role, content: m.content }) as OpenAI.Chat.ChatCompletionMessageParam),
      { role: "user", content: input.message },
    ];
    for (let i = 0; i < 4; i++) {
      const res = await client.chat.completions.create({
        model: env.LLM_MODEL_DEEPDIVE || env.LLM_MODEL_CLASSIFY,
        temperature: 0.2,
        max_tokens: 1800,
        tools: TOOL_DEFS,
        messages,
      });
      const choice = res.choices[0];
      if (!choice) break;
      const msg = choice.message;
      const calls = msg.tool_calls;
      if (!calls?.length) {
        const reply = fallbackReply((msg.content ?? "").trim(), toolText, pending, cards);
        const suggestions = followupsFor(intent, tools, pending);
        return {
          reply, open, openLabel, tools, pending, cards,
          suggestions: suggestions.length ? suggestions : suggestFollowups({
            message: input.message, tools, reply, topTopic: topTopic(input.learn),
          }),
        };
      }
      messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls });
      for (const call of calls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = {}; }
        const out = await apply(call.function.name, args);
        messages.push({ role: "tool", tool_call_id: call.id, content: out.text });
      }
    }
  }

  let modelText = "";
  if (toolText && !pending.length) {
    try {
      const res = await client.chat.completions.create({
        model: env.LLM_MODEL_DEEPDIVE || env.LLM_MODEL_CLASSIFY,
        temperature: 0.3,
        max_tokens: 900,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `User asked: ${input.message}\n\nWorkspace facts:\n${toolText.slice(0, 6000)}\n\nWrite the answer. Do not invent extra accounts.` },
        ],
      });
      modelText = (res.choices[0]?.message.content ?? "").trim();
    } catch { /* keep tool text */ }
  }

  const reply = fallbackReply(modelText, toolText, pending, cards);
  const suggestions = followupsFor(intent, tools, pending);
  return {
    reply, open, openLabel, tools, pending, cards,
    suggestions: suggestions.length ? suggestions : suggestFollowups({
      message: input.message, tools, reply, topTopic: topTopic(input.learn),
    }),
  };
}
