/**
 * Deterministic Nova intent — the model does not choose the tool for
 * these phrases. N comes from THIS message first, then the last user turn.
 */
export type AgentIntent = {
  tool: string | null;
  args: Record<string, unknown>;
  wantsWrite: boolean;
  autoYes: boolean;
  skipShortlisted: boolean;
  n: number;
  offTopic?: boolean;
};

const WRITE_RE = /\b(shortlist|unshortlist|unselect|star|enrich|scan|radar|behalf|clear shortlist)\b/i;

export function parseN(message: string, fallback = 3): number {
  const next = message.match(/\bnext\s+(\d+)\b/i);
  if (next) return clampN(next[1]);
  const top = message.match(/\btop\s+(\d+)\b/i);
  if (top) return clampN(top[1]);
  const acc = message.match(/\b(\d+)\s+accounts?\b/i);
  if (acc) return clampN(acc[1]);
  return fallback;
}

function clampN(raw: string) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 3;
  return Math.min(20, Math.max(1, n));
}

export function resolveN(message: string, history: { role: string; content: string }[] = []): number {
  const here = parseN(message, 0);
  if (here) return here;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.role !== "user") continue;
    const n = parseN(history[i]!.content, 0);
    if (n) return n;
  }
  return 3;
}

export function classifyIntent(
  message: string,
  history: { role: string; content: string }[] = [],
): AgentIntent {
  const raw = message.trim();
  const bareYes = /^(yes|yep|yeah|ok|okay)\b/i.test(raw);
  const prior = [...history].reverse().find((h) => h.role === "user" && !/^(yes|yep|yeah|ok|okay)\b/i.test(h.content.trim()));
  const m = bareYes && prior ? prior.content.trim() : raw;
  const n = resolveN(m, history);
  const autoYes = bareYes || (/\byes\b/i.test(raw) && /behalf|shortlist|enrich|scan|radar|remove|clear|unselect/i.test(raw));
  const wantsWrite = WRITE_RE.test(m) || autoYes || /remove all/i.test(m);
  const nextPage = /\bnext\s+(\d+|accounts?)\b/i.test(m) || /\bthese\s+accounts?\b/i.test(m);
  const threadSkip = history.some((h) => /\bnext\s+(\d+|accounts?)\b|\bthese\s+accounts?\b/i.test(h.content));
  const skipShortlisted = nextPage || threadSkip;
  const base = { n, wantsWrite, autoYes, skipShortlisted, args: {} as Record<string, unknown>, tool: null as string | null };


  if (autoYes && /unshortlist all|clear shortlist|unselect all|remove all/i.test(m)) {
    return { ...base, tool: "clear_shortlist", wantsWrite: true, args: { confirm: true } };
  }
  if (autoYes && /unshortlist/i.test(m)) {
    const company = m.replace(/yes[,.]?|unshortlist|on my behalf/gi, "").trim();
    return { ...base, tool: "unshortlist_account", wantsWrite: true, args: { company, confirm: true } };
  }
  if (/\b(clear shortlist|unshortlist all|unselect all|remove all (the )?shortlist|remove all shortlisted)\b/i.test(m)) {
    return { ...base, tool: "clear_shortlist", wantsWrite: true, args: { confirm: autoYes } };
  }
  if (/\bunshortlist\b|\bremove .* from (the )?shortlist\b/i.test(m)) {
    const company = m.replace(/unshortlist|remove|from (the )?shortlist|please/gi, "").trim();
    return { ...base, tool: "unshortlist_account", wantsWrite: true, args: { company, confirm: false } };
  }
  if (/\bmark\b/i.test(m) && /\b(met|skipped|skip)\b/i.test(m)) {
    const status = /skip/i.test(m) ? "skipped" : "met";
    const person = m.replace(/yes[,.]?|mark|as|met|skipped|skip|on radar|on my behalf/gi, "").trim();
    return { ...base, tool: "radar_floor", wantsWrite: true, args: { person, status, confirm: autoYes } };
  }


  if (/\bsync (my )?(network|connections|linkedin)\b/i.test(m)) {
    return { ...base, tool: "sync_network", wantsWrite: true, args: { confirm: autoYes } };
  }
  if (/\bstop (the )?(job|jobs|scan|enrich)/i.test(m)) {
    return { ...base, tool: "stop_jobs", wantsWrite: true, args: { confirm: autoYes } };
  }
  if (/\bundo sent\b/i.test(m)) {
    const person = m.replace(/yes[,.]?|undo sent( for)?|on my behalf/gi, "").trim();
    return { ...base, tool: "undo_sent", wantsWrite: true, args: { person, confirm: autoYes } };
  }
  if (/\bmark .* sent\b|\bmarked .* sent\b/i.test(m)) {
    const person = m.replace(/yes[,.]?|mark(ed)?|as sent|sent|on my behalf/gi, "").trim();
    return { ...base, tool: "mark_sent", wantsWrite: true, args: { person, confirm: autoYes } };
  }
  if (/\bflag\b/i.test(m) && /\b(dropped|verify|variant)\b/i.test(m)) {
    const verdict = /dropped/i.test(m) ? "dropped" : /variant/i.test(m) ? "variant" : "verify";
    const person = m.replace(/yes[,.]?|flag|as|dropped|verify|variant|on my behalf/gi, "").trim();
    return { ...base, tool: "flag_person", wantsWrite: true, args: { person, verdict, confirm: autoYes } };
  }

  if (autoYes && /enrich/i.test(m)) {
    return { ...base, tool: "enrich_shortlist", wantsWrite: true, args: { confirm: true } };
  }
  if (autoYes && /shortlist/i.test(m)) {
    return { ...base, tool: "shortlist_top", wantsWrite: true, args: { n, confirm: true, skipShortlisted } };
  }
  if (autoYes && /radar|scan/i.test(m)) {
    return { ...base, tool: "start_radar", wantsWrite: true, args: { confirm: true } };
  }


  if (/\b(title mix|how many (vps?|directors?|founders?)|break( that)? title)\b/i.test(m)) {
    return { ...base, tool: "insight", wantsWrite: false, args: { topic: "titles" } };
  }
  if (/\b(committee|gaps?|missing (cxo|vp|roles?))\b/i.test(m)) {
    return { ...base, tool: "insight", wantsWrite: false, args: { topic: "gaps" } };
  }
  if (/\b(lookalike|similar to|like the ones I sent|looks like people)\b/i.test(m)) {
    return { ...base, tool: "insight", wantsWrite: false, args: { topic: "lookalikes" } };
  }
  if (/\b(who (should I |to )?send|send first|best draft)\b/i.test(m)) {
    return { ...base, tool: "insight", wantsWrite: false, args: { topic: "send" } };
  }

  if (/\b(what'?s?\s+left|what else|leftover|still need|not researched|pending research)\b/i.test(m) && !/\benrich\b/i.test(m)) {
    return { ...base, tool: "whats_left", wantsWrite: false };
  }
  if (/\b(snapshot|workspace totals|how many people|how big is (my|the) (network|workspace))\b/i.test(m)) {
    return { ...base, tool: "workspace_snapshot", wantsWrite: false };
  }
  if (/\b(ready drafts?|drafts?\s+ready|who to send)\b/i.test(m)) {
    return { ...base, tool: "list_ready", wantsWrite: false };
  }
  if (/\b(how many|count)\b/i.test(m) && /\b(vp|director|head|founder|c[teo]o)\b/i.test(m)) {
    const title = (m.match(/\b(vps?|directors?|heads? of [\w ]+|founders?)\b/i) || ["VP"])[0];
    return { ...base, tool: "count_title", wantsWrite: false, args: { title } };
  }

  if (/\b(find company|search company|lookup company)\b/i.test(m)) {
    const q = m.replace(/^(find|search|lookup)\s+company\s+/i, "").trim();
    return { ...base, tool: "search_accounts", wantsWrite: false, args: { q } };
  }
  if (/\b(find|search|who is|lookup)\b/i.test(m) && !/\baccount/i.test(m) && !/\bcompany\b/i.test(m)) {
    const q = m.replace(/^(find|search|who is|lookup)\s+/i, "").trim();
    return { ...base, tool: "search_people", wantsWrite: false, args: { q } };
  }
  if ((/\benrich\b/i.test(m) || /\bresearch\b/i.test(m)) && !/\b(them|shortlist|remaining|all)\b/i.test(m) && !/\brecent/i.test(m)) {
    const company = m.replace(/enrich(ment)?|research|please|the|account/gi, "").trim();
    if (company.length > 1) {
      return { ...base, tool: "enrich_account", wantsWrite: true, args: { company, confirm: autoYes } };
    }
  }
  if (/\b(enrich them|enrich (the )?shortlist|enrich remaining|research them|research the shortlist)\b/i.test(m)) {
    return { ...base, tool: "enrich_shortlist", wantsWrite: true, args: { confirm: false } };
  }
  if ((/\bshortlist\b/i.test(m) || /\bstar\b/i.test(m)) && /\b(top|these|recommended|next)\b/i.test(m)) {
    const skip = skipShortlisted || /\b(these|next)\b/i.test(m);
    return { ...base, tool: "shortlist_top", wantsWrite: true, args: { n, confirm: false, skipShortlisted: skip } };
  }

  if (/\b(which companies dominate|radar densit|companies on (this )?radar)\b/i.test(m)) {
    return { ...base, tool: "insight", wantsWrite: false, args: { topic: "radar_companies" } };
  }
  if (/\b(marked met|already met|who have I (already )?marked)\b/i.test(m)) {
    return { ...base, tool: "insight", wantsWrite: false, args: { topic: "radar_met" } };
  }
  if (/\b(scan|radar|event scan|going to (an )?event|in town|on site)\b/i.test(m)) {
    const event = (m.match(/(?:scan|radar)\s+(.+?)(?:\s+last|\s+in\s+the|\s*$)/i) || [, ""])[1]?.trim();
    const named = event && !/^(event|hits|scan|us|india)$/i.test(event) && event.length > 2;
    if (!named) {
      return { ...base, tool: "radar_guide", wantsWrite: false };
    }
    const pool = /2nd|3rd|extended/i.test(m) ? "extended" : "first";
    return {
      ...base,
      tool: "start_radar",
      wantsWrite: true,
      args: { event, confirm: false, country: /india/i.test(m) ? "india" : "united-states", days: /14/.test(m) ? 14 : 7, pool },
    };
  }

  if ((/\b(show|list|give|bring up|top|next)\b/i.test(m) && /\baccount/i.test(m)) || /\b(top|next)\s+\d+\b/i.test(m)) {
    return {
      ...base,
      tool: "recommend_next",
      wantsWrite: false,
      args: { n, skipShortlisted },
    };
  }

  if (/\bwhat should i do|recommend who|prioritize\b/i.test(m)) {
    return { ...base, tool: "recommend_next", wantsWrite: false, args: { n, skipShortlisted: false } };
  }

  if (/^(hi|hello|hey|yo|sup|good (morning|afternoon|evening))\b/i.test(m)) {
    return { ...base, tool: "radar_guide", wantsWrite: false, args: { welcome: true } };
  }
  const inScope = /\b(account|shortlist|enrich|research|radar|draft|icp|people|person|contact|linkedin|sync|send|vp|founder|director|company|workspace|snapshot|scan|title|committee|lookalike|met|skipped|flag|event|saastr|dreamforce|nova|abm|gtm|marketeroid)\b/i.test(m)
    || /\b(yes|yep|yeah|ok|okay|no)\b/i.test(m);
  if (!inScope) return { ...base, offTopic: true };
  return base;
}

export function followupsFor(intent: AgentIntent, tools: string[], pending: unknown[]): string[] {
  if (pending.length) return [];
  if (tools.includes("radar_guide") && intent.args.welcome) {
    return ["Workspace snapshot", "Top 10 accounts", "radar"];
  }
  if (tools.includes("radar_guide")) {
    return ["scan SaaStr last 7 days US", "scan SaaStr last 7 days India", "Radar hits from the last scan"];
  }
  if (tools.includes("start_radar")) {
    return ["Radar hits from the last scan", "Which companies dominate this Radar scan?"];
  }
  if (tools.includes("radar_floor")) {
    return ["Who have I already marked met?", "Shortlist these accounts"];
  }
  if (tools.includes("clear_shortlist")) return ["Top 10 accounts", "Next 10 accounts"];
  if (tools.includes("shortlist_top") || tools.includes("shortlist_account")) return ["Enrich them"];
  if (tools.includes("enrich_shortlist") || tools.includes("enrich_account")) {
    return ["Who has a ready draft now?", "What else left"];
  }
  if (tools.includes("whats_left")) return ["Enrich them", "Who has a ready draft now?"];
  if (tools.includes("recommend_next") && intent.skipShortlisted) {
    return ["Shortlist these accounts", "What else left", "Who still needs research on the shortlist?"];
  }
  if (tools.includes("workspace_snapshot")) {
    return ["Top 10 accounts", "What else left"];
  }
  if (tools.includes("recommend_next")) {
    return ["Shortlist these accounts", "Next 10 accounts", "What else left"];
  }
  if (tools.includes("list_ready") || (intent.args && intent.args.topic === "send")) {
    return ["Who looks like the people I already drafted?", "What else left"];
  }
  if (tools.includes("insight") && intent.args.topic === "radar") {
    return ["Which companies dominate this Radar scan?", "mark Jane met", "Who have I already marked met?"];
  }
  if (tools.includes("insight") && intent.args.topic === "radar_companies") {
    return ["Who have I already marked met?", "Shortlist these accounts", "What else left"];
  }
  if (tools.includes("insight") && intent.args.topic === "radar_met") {
    return ["Shortlist these accounts", "What else left", "Enrich them"];
  }
  if (tools.includes("insight")) {
    return ["Who has a ready draft now?", "What else left"];
  }
  if (tools.includes("list_ready")) return ["Recommend who to send first"];
  return [];
}

export function fallbackReply(model: string, toolText: string, pending: { title: string }[], cards: { title: string }[]): string {
  const text = (model || "").trim();
  const thin = !text || text.length < 8 || /^yes or no\??$/i.test(text) || text === "Done.";
  if (!thin) return text;
  if (toolText.trim()) return toolText.trim();
  if (cards.length) {
    return cards.map((c, i) => `${i + 1}. ${c.title}`).join("\n");
  }
  if (pending.length) return "Shall I do that on your behalf?";
  return "I could not read that workspace query. Try: top 10 accounts, next 10 accounts, what else left.";
}
