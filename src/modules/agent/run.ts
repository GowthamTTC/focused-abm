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

const SYSTEM = `You are Nova for THIS Focused ABM workspace only.
You can: snapshot, list/shortlist accounts, enrich, Radar, drafts, mark sent, flag, sync, stop jobs.
You cannot: weather, jokes, general coding, world news, or anything outside this workspace.
If the user is off-topic, say you are limited to this environment and point them to the next step in the sequence:
1 workspace snapshot → 2 top accounts → 3 shortlist → 4 next 10 → 5 what else left → 6 enrich them → 7 who to send.
Radar drive: event name → US/India + 1st or 2nd+3rd → Yes to scan → hits → company density → met/skip → shortlist those companies.\nNever invent HQ, revenue, counts, or people. Tools are ground truth. Writes need Yes/No.`;

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
  cards: { kind: string; title: string; subtitle?: string; pills: string[]; href?: string }[];
}> {
  const ctx: ToolCtx = { orgId: input.orgId };
  const intent = classifyIntent(input.message, input.history);
  if (intent.offTopic) {
    const reply = "I'm limited to this environment — your Focused ABM workspace (accounts, shortlist, enrich, Radar, drafts). I can't help with that ask.\n\n**Next step:** Workspace snapshot, then Top 10 accounts.";
    return {
      reply,
      tools: [],
      suggestions: ["Workspace snapshot", "Top 10 accounts", "What else left"],
      pending: [],
      cards: [],
    };
  }
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
    const skipRecCards = name === "recommend_next" && tools.some((x) => x === "list_ready" || x === "insight");
    if (out.cards && !skipRecCards) cards.push(...out.cards);
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
        const peopleOnly = tools.includes("list_ready") || intent.args.topic === "send" || intent.args.topic === "lookalikes";
        const shown = peopleOnly ? cards.filter((c) => c.kind === "person") : cards;
        const reply = fallbackReply((msg.content ?? "").trim(), toolText, pending, shown);
        const suggestions = followupsFor(intent, tools, pending);
        return {
          reply, open, openLabel, tools, pending, cards: shown,
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

  const peopleOnly = tools.includes("list_ready") || intent.args.topic === "send" || intent.args.topic === "lookalikes";
  const shown = peopleOnly ? cards.filter((c) => c.kind === "person") : cards;
  const reply = fallbackReply(modelText, toolText, pending, shown);
  const suggestions = followupsFor(intent, tools, pending);
  return {
    reply, open, openLabel, tools, pending, cards: shown,
    suggestions: suggestions.length ? suggestions : suggestFollowups({
      message: input.message, tools, reply, topTopic: topTopic(input.learn),
    }),
  };
}
