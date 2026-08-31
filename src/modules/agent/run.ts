import OpenAI from "openai";
import { env } from "@/lib/env";
import { TOOL_DEFS, runTool, type ToolCtx } from "./tools";

const client = new OpenAI({
  apiKey: env.OPENROUTER_API_KEY,
  baseURL: env.LLM_BASE_URL,
  defaultHeaders: {
    "HTTP-Referer": env.APP_URL,
    "X-Title": "Focused ABM Agent",
  },
});

const SYSTEM = `You are the Focused ABM workspace assistant for THIS user's private LinkedIn workspace only.
You help them shortlist companies, enrich contacts, run Event Radar, and find ready drafts.
Rules:
- Use tools for facts. Never invent HQ, revenue, or people who are not in tool results.
- Enrich and Radar spend credits. Call those tools only when the user clearly asks to run research/scan/enrich.
- Shortlist does not enrich.
- Be short. Name companies and people. Offer one next action.
- If a tool returns an "open" path, mention they can open that screen.
- Page context: you may be on Accounts, Radar, or Review — stay relevant.
- Do not claim GPS or live location. Radar is post-search + country.`;

export async function runAgent(input: {
  orgId: string;
  page: string;
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
}): Promise<{ reply: string; open?: string }> {
  const ctx: ToolCtx = { orgId: input.orgId };
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: `${SYSTEM}\nCurrent page: ${input.page}` },
    ...input.history.slice(-8).map((m) => ({ role: m.role, content: m.content }) as OpenAI.Chat.ChatCompletionMessageParam),
    { role: "user", content: input.message },
  ];

  let open: string | undefined;
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
      return { reply: (msg.content ?? "Done.").trim(), open };
    }
    messages.push({
      role: "assistant",
      content: msg.content ?? "",
      tool_calls: calls,
    });
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = {}; }
      const out = await runTool(ctx, call.function.name, args);
      if (out.open) open = out.open;
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: out.text,
      });
    }
  }
  return { reply: "I ran the tools. Check the page or the top bar for progress.", open };
}
