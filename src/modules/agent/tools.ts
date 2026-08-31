/**
 * Agent tools — same org-scoped jobs as the UI buttons.
 */
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, connection } from "@/db";
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
      description: "Find people in this workspace by name or company.",
      parameters: {
        type: "object",
        properties: { q: { type: "string" } },
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
