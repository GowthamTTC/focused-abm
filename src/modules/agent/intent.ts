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

const WORKSPACE_VERB =
  /\b(enrich|shortlist|unshortlist|snapshot|account|accounts|draft|drafts|qualified|qualify|marketeroid|marketroid|icp|workspace|pipeline|send first|who to send|what else|what'?s left|top \d+|next \d+)\b/i;

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

export function parseRadarReply(message: string): {
  event: string;
  country: string;
  days: number;
  pool: string;
  statedCountry: boolean;
  statedDays: boolean;
  statedPool: boolean;
} | null {
  let s = message.trim();
  if (!s) return null;
  if (WORKSPACE_VERB.test(s) && !/\b(scan|radar)\b/i.test(s)) return null;
  if (/^(hi|hello|hey|yo|thanks|thank you|ok|okay|no|yes)\b/i.test(s) && !/\b(scan|radar)\b/i.test(s)) return null;
  if (/\b(not radar|isn'?t radar|this is not radar|don'?t scan)\b/i.test(s)) return null;

  const statedCountry = /\b(india|indian|bharat|united states|usa|america|american|u\.s\.a\.?|u\.s\.)\b/i.test(s) || /\bUS\b/.test(s);
  const country = /\b(india|indian|bharat)\b/i.test(s) ? "india" : "united-states";
  const statedPool = /\b(1st|2nd|3rd|first|second|third|extended|beyond first)\b/i.test(s);
  const pool = /\b(2nd|3rd|second|third|extended|beyond first|not first)\b/i.test(s) ? "extended" : "first";
  const wordDays: Record<string, number> = { one: 1, two: 2, three: 3, seven: 7, fourteen: 14, thirty: 30 };
  const wordHit = s.match(/\b(one|two|three|seven|fourteen|thirty)\s+days?\b/i);
  const dayHit = s.match(/\b(?:last|past)\s+(\d+)\s+days?\b/i) || s.match(/\b(\d+)\s+days?\b/i);
  const statedDays = Boolean(wordHit || dayHit || /\b(last|past)\s+(month|week)\b/i.test(s) || /\b\d+\s*d\b/i.test(s));
  const days = /\b(last|past)\s+month\b/i.test(s) || /\b30\s*d\b/i.test(s)
    ? 30
    : /\b(last|past)\s+(week|7\s*d)\b/i.test(s)
      ? 7
      : wordHit
        ? wordDays[wordHit[1]!.toLowerCase()] ?? 7
        : dayHit
          ? Math.min(30, Math.max(1, parseInt(dayHit[1]!, 10)))
          : 7;

  s = s.replace(/\b(radar|scan|event scan|event name|event|last|past|month|week|\d+\s+days?|days?|one|two|three|seven|fourteen|thirty|in the|going to|headed to|at|for|about|talking about|united states|usa|america|american|u\.s\.a\.?|u\.s\.|\bus\b|india|indian|bharat|1st|2nd|3rd|first|second|third|degree|extended|connections?|network|please|name|people)\b/gi, " ");
  s = s.replace(/[+|]+/g, " ").replace(/\s+/g, " ").trim();
  if (s.length < 3) return null;
  if (/^(event|hits|yes|no|ok|name|it is not)$/i.test(s)) return null;
  if (WORKSPACE_VERB.test(s)) return null;
  const words = s.split(/\s+/);
  if (words.length > 6) return null;
  return { event: s, country, days, pool, statedCountry, statedDays, statedPool };
}

function askedForEvent(history: { role: string; content: string }[]) {
  const last = [...history].reverse().find((h) => h.role === "assistant");
  return !!last && /\b(what'?s the event|event name|name the event)\b/i.test(last.content);
}

function isEventLike(raw: string, parsed: { event: string } | null, history: { role: string; content: string }[]) {
  if (!parsed) return false;
  if (WORKSPACE_VERB.test(raw)) return false;
  if (/\b(not radar|isn'?t radar|this is not radar)\b/i.test(raw)) return false;
  if (/\b(scan|radar)\b/i.test(raw) && parsed.event.length >= 3) return true;
  if (askedForEvent(history) && parsed.event.split(/\s+/).length <= 6) return true;
  if (/\b(20\d{2}|saastr|dreamforce|reinvent|inbound|unbound|collision)\b/i.test(raw)) return true;
  return false;
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

  if (/\b(not radar|isn'?t radar|this is not radar|don'?t scan|cancel (the )?scan)\b/i.test(raw)) {
    if (/\benrich\b/i.test(m) || /\benrich\b/i.test(raw)) {
      return { ...base, tool: "enrich_shortlist", wantsWrite: true, args: { confirm: false } };
    }
    return { ...base, tool: "whats_left", wantsWrite: false };
  }

  // The reason list, routed rather than left to the model to guess: it is the
  // question the whole post ladder exists to answer, and Radar owns anything
  // about an event or a conference — a scan of a metro is not a reason to
  // message someone about what they said.
  if (/\b(who posted|posted something|posted anything|reasons? to (reach|message|open)|open with|hooks?)\b/i.test(m)
      && !/\b(radar|event|conference|expo|summit|booth|metro)\b/i.test(m)) {
    return { ...base, tool: "reasons_to_reach_out", wantsWrite: false, args: { n } };
  }

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
  if (autoYes && /shortlist/i.test(m) && !/radar|scan/i.test(m)) {
    return { ...base, tool: "shortlist_top", wantsWrite: true, args: { n, confirm: true, skipShortlisted } };
  }

  if (/\b(title mix|how many (vps?|directors?|founders?)|break( that)? title)\b/i.test(m)) {
    return { ...base, tool: "insight", wantsWrite: false, args: { topic: "titles" } };
  }
  if (/\b(committee|gaps?|missing (cxo|vp|roles?))\b/i.test(m)) {
    return { ...base, tool: "insight", wantsWrite: false, args: { topic: "gaps" } };
  }
  if (/\b(lookalike|similar to|like the ones I sent)\b/i.test(m)) {
    return { ...base, tool: "insight", wantsWrite: false, args: { topic: "lookalikes" } };
  }
  if (/\b(who (should I |to )?send|send first|best draft)\b/i.test(m)) {
    return { ...base, tool: "insight", wantsWrite: false, args: { topic: "send" } };
  }
  if (/\b(radar hits|who mentioned|last scan|event hits)\b/i.test(m)) {
    return { ...base, tool: "insight", wantsWrite: false, args: { topic: "radar" } };
  }
  if (/\b(marketeroid|marketroid|hire a marketer)\b/i.test(m)) {
    return { ...base, tool: "insight", wantsWrite: false, args: { topic: "service", service: "marketeroid" } };
  }

  if (/\b(what'?s?\s+left|what else|leftover|remaining|still need)\b/i.test(m)) {
    return { ...base, tool: "whats_left", wantsWrite: false };
  }
  if (/\b(snapshot|workspace totals|how many people)\b/i.test(m)) {
    return { ...base, tool: "workspace_snapshot", wantsWrite: false };
  }
  if (/\b(ready draft|drafts?\s+ready|who to send)\b/i.test(m)) {
    return { ...base, tool: "list_ready", wantsWrite: false };
  }
  if (/\b(how many|count)\b/i.test(m) && /\b(vp|director|head|founder|c[teo]o)\b/i.test(m)) {
    const title = (m.match(/\b(vps?|directors?|heads? of [\w ]+|founders?)\b/i) || ["VP"])[0];
    return { ...base, tool: "count_title", wantsWrite: false, args: { title } };
  }

  if (/\b(enrich them|enrich (the |all )?(shortlist|shortlisted)|enrich remaining|enrich all)\b/i.test(m)
      || (/\benrich\b/i.test(m) && /\b(account|shortlist|them|contacts?)\b/i.test(m))) {
    return { ...base, tool: "enrich_shortlist", wantsWrite: true, args: { confirm: autoYes } };
  }
  if (/\bshortlist\b/i.test(m) && /\b(top|these|recommended|next)\b/i.test(m)) {
    const skip = skipShortlisted || /\b(these|next)\b/i.test(m);
    return { ...base, tool: "shortlist_top", wantsWrite: true, args: { n, confirm: autoYes, skipShortlisted: skip } };
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
    return { ...base, tool: "workspace_snapshot", wantsWrite: false };
  }

  const parsed = parseRadarReply(m);
  const askedScan = /\b(scan|radar|event scan|going to (an )?event|on site)\b/i.test(m);
  if (askedScan && !parsed) {
    return { ...base, tool: "start_radar", wantsWrite: false, args: { event: "" } };
  }
  if (isEventLike(m, parsed, history) && parsed) {
    return {
      ...base,
      tool: "start_radar",
      wantsWrite: true,
      args: { ...parsed, confirm: false },
    };
  }

  const inScope = /\b(account|shortlist|enrich|research|radar|draft|icp|people|person|contact|linkedin|sync|send|post|posted|posts|hook|vp|founder|director|company|workspace|snapshot|scan|title|committee|lookalike|met|skipped|flag|event|nova|abm|gtm|marketeroid|marketroid)\b/i.test(m)
    || /\b(yes|yep|yeah|ok|okay|no)\b/i.test(m);
  if (!inScope) return { ...base, offTopic: true };
  return base;
}

export function followupsFor(intent: AgentIntent, tools: string[], pending: unknown[]): string[] {
  if (pending.length) return [];
  if (tools.includes("clear_shortlist")) return ["Top 10 accounts", "Next 10 accounts"];
  if (tools.includes("shortlist_top") || tools.includes("shortlist_account")) return ["Enrich them", "What else left"];
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
  if (tools.includes("insight") && intent.args.topic === "service") {
    return ["Shortlist these accounts", "Enrich them", "What else left"];
  }
  if (tools.includes("insight")) {
    return ["Who has a ready draft now?", "What else left"];
  }
  if (tools.includes("start_radar")) {
    return ["Radar hits from the last scan", "What else left"];
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
  return "I could not read that workspace query. Try: top 10 accounts, next 10 accounts, enrich them, what else left.";
}
