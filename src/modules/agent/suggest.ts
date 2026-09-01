export function suggestFollowups(input: {
  message: string;
  tools: string[];
  reply: string;
  topTopic?: string | null;
}): string[] {
  const m = input.message.toLowerCase();
  const t = new Set(input.tools);
  const out: string[] = [];
  const add = (s: string) => { if (!out.includes(s) && out.length < 5) out.push(s); };

  if (t.has("count_title") || /\bvp|director|title|head of\b/.test(m)) {
    add("Break that title mix down by company");
    add("Which of those still need research?");
    add("Shortlist the company with the most of that title");
  }
  if (t.has("shortlist_top") || t.has("shortlist_account") || t.has("search_accounts")) {
    add("Enrich them");
  }
  if (t.has("enrich_account") || t.has("enrich_person") || t.has("enrich_shortlist")) {
    add("Who has a ready draft now?");
    add("Recommend who to send first");
    add("Workspace snapshot");
  }
  if (t.has("start_radar") || /scan|radar|event/.test(m)) {
    add("Who mentioned that event from my 1st degree?");
    add("Filter Radar to the top account");
    add("What should I do next?");
  }
  if (t.has("recommend_next") || t.has("workspace_snapshot")) {
    add("Shortlist these accounts");
    add("How many VPs — which account has most?");
    add("Enrich all remaining on the shortlist");
  }
  if (t.has("list_ready")) {
    add("Recommend who to send first");
    add("What should I do next?");
  }

  const habit =
    input.topTopic === "title" ? "How many directors — which account has most?" :
    input.topTopic === "enrich" ? "Who still needs research on the shortlist?" :
    input.topTopic === "radar" ? "Scan another US event last 7 days" :
    input.topTopic === "review" ? "Who has a ready draft?" :
    input.topTopic === "account" ? "What should I do next on accounts?" :
    null;
  if (habit) out.splice(Math.min(1, out.length), 0, habit);

  add("What should I do next?");
  add("Workspace snapshot");
  add("How many VPs — which account has most?");
  return out.slice(0, 3);
}
