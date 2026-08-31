/**
 * Agent tools — same org-scoped jobs as the UI buttons.
 */
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, connection, accountShortlist } from "@/db";
import { companyKey } from "@/modules/radar/score";
import { toggleShortlist, enrichOneAccount, enrichOnePerson } from "@/modules/accounts/shortlist";
import { enqueue } from "@/jobs/runner";
import { countryBySlug } from "@/modules/geo/countries";

export type ToolCtx = { orgId: string };

export const TOOL_DEFS = [
  {
    type: "function" as const,
    function: {
      name: "search_accounts",
      description: "Find companies in this user's pitchable network. Use before shortlist or enrich.",
      parameters: {
        type: "object",
        properties: { q: { type: "string", description: "Company or person name" } },
        required: ["q"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_people",
      description: "Find people by name, company, or job title (e.g. VP, Head of Product).",
      parameters: {
        type: "object",
        properties: {
          q: { type: "string", description: "Name, company, or title words" },
        },
        required: ["q"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "shortlist_account",
      description: "Star a company so it is on the shortlist. Does not enrich.",
      parameters: {
        type: "object",
        properties: {
          company: { type: "string", description: "Company name as stored" },
        },
        required: ["company"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "enrich_account",
      description: "Queue deep research for ALL remaining unenriched pitchable people at this company. Only when the user clearly asks to enrich/research.",
      parameters: {
        type: "object",
        properties: { company: { type: "string" } },
        required: ["company"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "enrich_person",
      description: "Queue deep research for one person. Only when the user asks to enrich that person.",
      parameters: {
        type: "object",
        properties: { personId: { type: "string" } },
        required: ["personId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "start_radar",
      description: "Start Event Radar post search. Only when the user names an event.",
      parameters: {
        type: "object",
        properties: {
          event: { type: "string" },
          country: { type: "string", description: "united-states or india" },
          days: { type: "number" },
          pool: { type: "string", description: "first or extended" },
        },
        required: ["event"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "workspace_snapshot",
      description: "Totals for this workspace: people, pitchable, companies, shortlist, researched, ready drafts.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "count_title",
      description: "How many contacts match a title (and optional company). Always returns counts by company.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Title words e.g. VP, director, head of product" },
          company: { type: "string", description: "Optional company filter" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "enrich_shortlist",
      description: "Enrich top seats on every shortlisted company (credit-aware). Only if user asks to enrich the shortlist.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "recommend_next",
      description: "Rank what to do next: weighted scores, top accounts, title mix, committee gaps, send-outcome bandit, lookalikes. Use when user asks what to do, who to prioritize, or for recommendations.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_ready",
      description: "List people with a ready outreach draft on Review.",
      parameters: { type: "object", properties: {} },
    },
  },
];

async function resolveCompany(orgId: string, company: string) {
  const key = companyKey(company);
  const rows = await db.select({
    companyRaw: connection.companyRaw,
  }).from(connection).where(and(
    eq(connection.orgId, orgId),
    eq(connection.bucket, "pitchable"),
  )).limit(4000);
  const exact = rows.find((r) => companyKey(r.companyRaw) === key);
  if (exact) return { key: companyKey(exact.companyRaw), name: (exact.companyRaw ?? "").trim() };
  const needle = company.toLowerCase();
  const fuzzy = rows.find((r) => (r.companyRaw ?? "").toLowerCase().includes(needle));
  if (fuzzy) return { key: companyKey(fuzzy.companyRaw), name: (fuzzy.companyRaw ?? "").trim() };
  return null;
}

export async function runTool(
  ctx: ToolCtx,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; open?: string }> {
  const orgId = ctx.orgId;

  if (name === "search_accounts") {
    const q = String(args.q ?? "").trim();
    if (!q) return { text: "Need a company name." };
    const rows = await db.select({
      companyRaw: connection.companyRaw,
      firstName: connection.firstName,
      lastName: connection.lastName,
      enrichStatus: connection.enrichStatus,
    }).from(connection).where(and(
      eq(connection.orgId, orgId),
      eq(connection.bucket, "pitchable"),
      ilike(connection.companyRaw, `%${q}%`),
    )).limit(80);
    const map = new Map<string, { name: string; n: number; pending: number }>();
    for (const r of rows) {
      const k = companyKey(r.companyRaw);
      const cur = map.get(k) ?? { name: (r.companyRaw ?? "").trim(), n: 0, pending: 0 };
      cur.n += 1;
      if (["pending", "failed", "skipped"].includes(r.enrichStatus)) cur.pending += 1;
      map.set(k, cur);
    }
    const list = [...map.values()].sort((a, b) => b.n - a.n).slice(0, 8);
    if (list.length === 0) return { text: `No pitchable company matching "${q}".` };
    return {
      text: list.map((a) => `${a.name} — ${a.n} people, ${a.pending} not researched`).join("\n"),
      open: `/accounts?company=${encodeURIComponent(list[0]!.name)}&a=${encodeURIComponent(companyKey(list[0]!.name))}`,
    };
  }

  if (name === "search_people") {
    const q = String(args.q ?? "").trim();
    if (!q) return { text: "Need a name." };
    const rows = await db.select({
      id: connection.id,
      firstName: connection.firstName,
      lastName: connection.lastName,
      companyRaw: connection.companyRaw,
      positionRaw: connection.positionRaw,
      enrichStatus: connection.enrichStatus,
      matchWhy: connection.matchWhy,
      score: connection.score,
      batchId: connection.batchId,
    }).from(connection).where(and(
      eq(connection.orgId, orgId),
      or(
        ilike(connection.firstName, `%${q}%`),
        ilike(connection.lastName, `%${q}%`),
        ilike(connection.companyRaw, `%${q}%`),
        ilike(connection.positionRaw, `%${q}%`),
      ),
    )).limit(12);
    if (rows.length === 0) return { text: `No people matching "${q}".` };
    return {
      text: rows.map((p) =>
        `${p.firstName} ${p.lastName} @ ${p.companyRaw ?? "—"} — ${p.positionRaw ?? "—"} · score ${p.score ?? "—"} · ${p.enrichStatus}${p.matchWhy ? `\n  ${p.matchWhy}` : ""} [${p.id}]`
      ).join("\n"),
      open: rows[0]?.batchId
        ? `/batches/${rows[0].batchId}?view=${rows[0].enrichStatus === "done" ? "enriched" : "pitchable"}&p=${rows[0].id}`
        : `/people?q=${encodeURIComponent(q)}`,
    };
  }

  if (name === "shortlist_account") {
    const company = String(args.company ?? "").trim();
    const hit = await resolveCompany(orgId, company);
    if (!hit) return { text: `Could not find company "${company}" in pitchable accounts.` };
    await toggleShortlist(orgId, hit.key, hit.name, true);
    return { text: `Shortlisted ${hit.name}. Enrich when you are ready.`, open: `/accounts?a=${encodeURIComponent(hit.key)}&view=shortlist` };
  }

  if (name === "enrich_account") {
    const company = String(args.company ?? "").trim();
    const hit = await resolveCompany(orgId, company);
    if (!hit) return { text: `Could not find company "${company}".` };
    await toggleShortlist(orgId, hit.key, hit.name, true);
    const result = await enrichOneAccount(orgId, hit.key);
    return {
      text: result.people === 0
        ? `${hit.name}: nobody left to research (or already queued).`
        : `Queued research for ${result.people} people at ${hit.name}. Watch the top bar.`,
      open: `/accounts?a=${encodeURIComponent(hit.key)}&enriched=${result.people}`,
    };
  }

  if (name === "enrich_person") {
    const personId = String(args.personId ?? "").trim();
    const ok = await enrichOnePerson(orgId, personId);
    if (!ok) return { text: "Person not found in this workspace." };
    return { text: "Queued research for that person. Watch the top bar." };
  }

  if (name === "start_radar") {
    const eventName = String(args.event ?? "").trim();
    if (!eventName) return { text: "Need an event name." };
    const country = String(args.country ?? "united-states");
    const slug = countryBySlug(country) ? country : (country.toLowerCase().includes("india") ? "india" : "united-states");
    if (!countryBySlug(slug)) return { text: "Country must be united-states or india." };
    const days = Math.min(30, Math.max(1, Number(args.days) || 7));
    const pool = String(args.pool ?? "first") === "extended" ? "extended" : "first";
    await enqueue(orgId, "event_extended", {
      country: slug,
      days,
      eventName,
      degree: pool === "extended" ? "extended" : "first",
    });
    return {
      text: `Radar scan started: "${eventName}", ${slug}, last ${days} days, ${pool === "extended" ? "2nd/3rd" : "1st"} degree. Watch the top bar.`,
      open: `/radar?days=${days}&pool=${pool}&country=${slug}&scanning=1&event=${encodeURIComponent(eventName)}&q=${encodeURIComponent(eventName)}`,
    };
  }

  if (name === "workspace_snapshot") {
    const [row] = await db.select({
      people: sql<number>`count(*)::int`,
      pitchable: sql<number>`count(*) filter (where bucket = 'pitchable')::int`,
      researched: sql<number>`count(*) filter (where enrich_status = 'done')::int`,
      pending: sql<number>`count(*) filter (where bucket = 'pitchable' and enrich_status in ('pending','failed','skipped'))::int`,
      ready: sql<number>`count(*) filter (where outreach_message is not null and sent_at is null)::int`,
      companies: sql<number>`count(distinct company_raw) filter (where bucket = 'pitchable' and company_raw is not null and company_raw <> '')::int`,
    }).from(connection).where(eq(connection.orgId, orgId));
    const [sl] = await db.select({ n: sql<number>`count(*)::int` }).from(accountShortlist).where(eq(accountShortlist.orgId, orgId));
    return {
      text: [
        `People: ${row?.people ?? 0}`,
        `Pitchable: ${row?.pitchable ?? 0}`,
        `Companies: ${row?.companies ?? 0}`,
        `On shortlist: ${sl?.n ?? 0}`,
        `Researched: ${row?.researched ?? 0}`,
        `Pitchable not researched: ${row?.pending ?? 0}`,
        `Ready drafts: ${row?.ready ?? 0}`,
      ].join("\n"),
    };
  }

  if (name === "count_title") {
    const title = String(args.title ?? "").trim();
    const company = String(args.company ?? "").trim();
    if (!title) return { text: "Need a title." };
    const cond = [eq(connection.orgId, orgId), eq(connection.bucket, "pitchable"), ilike(connection.positionRaw, `%${title}%`)];
    const rows = await db.select({
      id: connection.id,
      firstName: connection.firstName,
      lastName: connection.lastName,
      companyRaw: connection.companyRaw,
      positionRaw: connection.positionRaw,
      enrichStatus: connection.enrichStatus,
    }).from(connection).where(and(...cond)).limit(400);
    const filtered = company
      ? rows.filter((r) => (r.companyRaw ?? "").toLowerCase().includes(company.toLowerCase()))
      : rows;
    if (filtered.length === 0) return { text: `0 pitchable contacts with title matching "${title}"${company ? ` at ${company}` : ""}.` };
    const byCo = new Map<string, { n: number; pending: number }>();
    for (const r of filtered) {
      const name = (r.companyRaw ?? "Unknown").trim() || "Unknown";
      const cur = byCo.get(name) ?? { n: 0, pending: 0 };
      cur.n += 1;
      if (["pending", "failed", "skipped"].includes(r.enrichStatus)) cur.pending += 1;
      byCo.set(name, cur);
    }
    const ranked = [...byCo.entries()].sort((a, b) => b[1].n - a[1].n);
    const top = ranked[0]!;
    const sample = filtered.slice(0, 8).map((p) => `${p.firstName} ${p.lastName} — ${p.positionRaw} @ ${p.companyRaw}`).join("\n");
    return {
      text: [
        `${filtered.length} pitchable contact(s) matching title "${title}"${company ? ` at ${company}` : ""}.`,
        `Across ${ranked.length} companies.`,
        `Largest share: ${top[0]} with ${top[1].n} (${Math.round(top[1].n / filtered.length * 100)}%).`,
        ranked.slice(0, 8).map(([n, s]) => `${n}: ${s.n} people, ${s.pending} not researched`).join("\n"),
        "Sample:",
        sample,
      ].join("\n"),
      open: `/accounts?q=${encodeURIComponent(top[0])}`,
    };
  }

  if (name === "enrich_shortlist") {
    const { enrichShortlistedAccounts } = await import("@/modules/accounts/shortlist");
    const result = await enrichShortlistedAccounts(orgId);
    return {
      text: result.people === 0
        ? `Shortlist has ${result.accounts} companies but 0 people queued (already researched or empty).`
        : `Queued research for ${result.people} people across ${result.accounts} shortlisted companies.`,
      open: `/accounts?view=shortlist&enriched=${result.people}`,
    };
  }

  if (name === "recommend_next") {
    const { recommendAll, formatRecommend } = await import("@/modules/recommend");
    const rec = await recommendAll(orgId);
    const top = rec.accounts[0];
    return {
      text: formatRecommend(rec),
      open: top ? `/accounts?a=${encodeURIComponent(top.key)}` : "/accounts",
    };
  }

  if (name === "list_ready") {
    const rows = await db.select({
      id: connection.id,
      firstName: connection.firstName,
      lastName: connection.lastName,
      companyRaw: connection.companyRaw,
      batchId: connection.batchId,
    }).from(connection).where(and(
      eq(connection.orgId, orgId),
      sql`outreach_message is not null`,
      sql`sent_at is null`,
    )).orderBy(desc(connection.rank)).limit(12);
    if (rows.length === 0) return { text: "No ready drafts. Enrich people first, then open Review.", open: "/review?tab=ready" };
    return {
      text: rows.map((p) => `${p.firstName} ${p.lastName} @ ${p.companyRaw ?? "—"}`).join("\n"),
      open: `/review?tab=ready`,
    };
  }

  return { text: `Unknown tool ${name}` };
}
