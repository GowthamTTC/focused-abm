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
You can search people/titles/companies, shortlist one or shortlist_top (top N at once), enrich, run Radar, list drafts, and call recommend_next.

Ground every number and recommendation in this workspace ICP and tool output. Prefer matchWhy / service slug over generic advice.
Talk like a sharp coworker, not a form. Use tools for any number. If they ask what is left, call whats_left.
End with a **Recommendation:** when you suggest a next action.
5. "Show / list / top N accounts" is READ ONLY — call recommend_next. Do not ask Yes/No. Do not call shortlist_top unless they said shortlist/star.
6. Writes ALWAYS ask first. When asking permission, still name the accounts. UI shows Yes/No.
8. After Yes, results stay in this chat as cards. No invented URLs.
9. shortlist_top only when they said shortlist the top accounts.
6. Never invent HQ, revenue, or people missing from tool output.
7. Radar is post-search + country, not live GPS.`

function requestedN(message: string, history: { content: string }[] = []) {
  const blob = `${history.map((h) => h.content).join(" ")} ${message}`;
  const hits = [...blob.matchAll(/\btop\s+(\d+)\b/gi)].map((x) => parseInt(x[1], 10)).filter((n) => n > 0 && n <= 20);
  if (hits.length) return Math.max(...hits);
  const m = message.match(/\b(\d+)\s+accounts?\b/i);
  const n = m ? parseInt(m[1], 10) : 3;
  return Number.isFinite(n) ? Math.min(20, Math.max(1, n)) : 3;
}

function composeReply(model: string, pending: { title: string }[], cards: { title: string; subtitle?: string; pills: string[] }[]) {
  const thin = !model || model.length < 24 || /^yes or no\??$/i.test(model.trim()) || model.trim() === "Done.";
  if (!thin) return model;
  const lines: string[] = [];
  if (cards.length) {
    lines.push(pending.length ? "Shall I apply this on your behalf?" : "Top accounts:");
    for (const [i, c] of cards.entries()) {
      lines.push(`${i + 1}. ${c.title}${c.subtitle ? ` — ${c.subtitle}` : ""}${c.pills?.length ? ` · ${c.pills.join(" · ")}` : ""}`);
    }
  } else if (pending.length) {
    lines.push(model || "Shall I do that on your behalf?");
  } else {
    lines.push(model);
  }
  return lines.join("\n");
}

export async function runAgent(input: {
  orgId: string;
  page: string;
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  learn?: NovaLearn | null;
}): Promise<{ reply: string; open?: string; openLabel?: string; tools: string[]; suggestions: string[]; pending: { kind: string; title: string; yes: string; tone?: string }[]; cards: { kind: string; title: string; subtitle?: string; pills: string[] }[] }> {
  const ctx: ToolCtx = { orgId: input.orgId };
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: `${SYSTEM}\nCurrent page: ${input.page}\n${habitBlock(input.learn)}` },
    ...input.history.slice(-8).map((m) => ({ role: m.role, content: m.content }) as OpenAI.Chat.ChatCompletionMessageParam),
    { role: "user", content: input.message },
  ];

  let open: string | undefined;
  let openLabel: string | undefined;
  const tools: string[] = [];
  const pending: { kind: string; title: string; yes: string; tone?: string }[] = [];
  const cards: { kind: string; title: string; subtitle?: string; pills: string[] }[] = [];
  const WRITES = new Set(["shortlist_top", "shortlist_account", "enrich_account", "enrich_person", "enrich_shortlist", "start_radar"]);
  const autoYes = /\byes\b/i.test(input.message) && /behalf|shortlist|enrich|scan|radar/i.test(input.message);
  const wantsWrite = /\b(shortlist|star|enrich|scan|radar|behalf)\b/i.test(input.message);
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
      const reply = composeReply((msg.content ?? "Done.").trim(), pending, cards);
      return {
        reply, open, openLabel, tools, pending, cards,
        suggestions: pending.length
          ? []
          : (tools.includes("shortlist_top") || tools.includes("shortlist_account")) && wantsWrite
            ? ["Enrich them"]
            : tools.includes("recommend_next") || tools.includes("shortlist_top")
              ? [`Shortlist the top ${requestedN(input.message, input.history)} accounts`]
              : suggestFollowups({ message: input.message, tools, reply, topTopic: topTopic(input.learn) }),
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
      if (call.function.name === "recommend_next" || call.function.name === "shortlist_top") {
        if (args.n == null) args.n = requestedN(input.message, input.history);
      }
      if (WRITES.has(call.function.name)) args.confirm = autoYes;
      const out = await runTool(ctx, call.function.name, args);
      if (out.pending && (wantsWrite || autoYes)) pending.push(...out.pending);
      if (out.cards) cards.push(...out.cards);
      if (out.open) open = out.open;
      if (out.openLabel) openLabel = out.openLabel;
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: out.text,
      });
    }
  }
  const reply = composeReply("I ran the tools.", pending, cards);
  return {
    reply, open, openLabel, tools, pending, cards,
    suggestions: pending.length ? [] : (tools.includes("shortlist_top") || tools.includes("shortlist_account")) ? ["Enrich them"] : suggestFollowups({ message: input.message, tools, reply, topTopic: topTopic(input.learn) }),
  };
}
