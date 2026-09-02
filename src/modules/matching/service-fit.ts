/**
 * Stage A — classify every connection in a batch.
 * Rule pass first (free); everything unresolved goes to the LLM in batches
 * of 25 with the services digest as CACHED context (one cache write, ~200
 * cheap reads across a 5k-connection batch).
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, connection, service } from "@/db";
import { env } from "@/lib/env";
import type { IcpJson } from "@/db/schema";
import { complete } from "@/llm/client";
import { companyPeerSignal, offIcpTitleSignal, rulePass } from "./rule-pass";
import { ownCompanyWhy } from "./own-company";
import { detectSeniority } from "./normalize";
import { getOrgSettings } from "@/modules/settings/org-settings";

const BATCH = 25;

const KNOWN_BUCKETS = new Set(["pitchable", "off_icp", "peer_competitor", "excluded"]);
const fitItem = z.object({
  id: z.string(),
  bucket: z.string().min(1), // loose on purpose — coerced below so one bad word can't kill a run
  service_slug: z.string().nullable(),
  confidence: z.number().int().min(0).max(100),
  why: z.string().min(1),
});
const fitArray = z.array(fitItem);

export function servicesDigest(services: { slug: string; name: string; icp: IcpJson }[]): string {
  return "SERVICES (choose service_slug from these):\n" + services.map((s) =>
    [
      `— slug: ${s.slug} · ${s.name}`,
      `  what: ${s.icp.summary}`,
      `  fit signals: ${s.icp.fit_signals.join("; ")}`,
      `  typical pains: ${s.icp.pain_points.slice(0, 4).join("; ")}`,
      `  disqualifiers: ${s.icp.disqualifiers.join("; ")}`,
    ].join("\n"),
  ).join("\n");
}

export async function classifyBatch(
  orgId: string,
  batchId: string,
  opts: { reclassifyAll?: boolean } = {},
  onProgress?: (done: number, total: number) => Promise<void>,
  shouldStop?: () => Promise<boolean>,
): Promise<{ classified: number; ruleHits: number; llmCalls: number }> {
  const services = (await db.select().from(service)
    .where(and(eq(service.orgId, orgId), eq(service.status, "active"))))
    .map((s) => ({ slug: s.slug, name: s.name, icp: s.icpJson }));
  if (services.length === 0) throw new Error("No active services — seed or create services first.");

  // Loaded BEFORE the rule pass, not after it: the own-company exclusion below
  // needs sellerName, and the LLM cap is not read until pass 2.
  const settings = await getOrgSettings(orgId);
  const ownCompany = (settings.sellerName ?? "").toLowerCase().trim();

  // Default: touch ONLY unclassified rows, so repeated runs genuinely continue
  // from where the guardrail stopped (and never re-bill the same people).
  // reclassifyAll wipes that filter for a deliberate fresh pass after ICP/prompt edits.
  const conditions = [eq(connection.batchId, batchId), eq(connection.orgId, orgId)];
  if (!opts.reclassifyAll) conditions.push(isNull(connection.bucket));
  const rows = await db.select().from(connection).where(and(...conditions));

  let done = 0; let ruleHits = 0; let llmCalls = 0;
  const needLlm: typeof rows = [];
  const ruleVerdicts: Verdict[] = [];

  // Pass 1 — rules (collected in memory, written in bulk below).
  for (const c of rows) {
    const title = c.positionRaw ?? c.headlineRaw ?? "";
    const company = (c.companyRaw ?? "").toLowerCase();
    if (!title.trim() && !company.trim()) {
      ruleVerdicts.push({ id: c.id, bucket: "excluded", slug: null, conf: 100, why: "Blank row — no position and no company.", method: "rule" });
      done += 1; continue;
    }
    // Blank sellerName = rule off. Without the guard an empty string matches
    // every company and excludes the entire batch.
    if (ownCompany && company.includes(ownCompany)) {
      ruleVerdicts.push({ id: c.id, bucket: "excluded", slug: null, conf: 100, why: ownCompanyWhy(settings.sellerName!), method: "rule" });
      done += 1; continue;
    }
    if (detectSeniority(title) === "junior") {
      ruleVerdicts.push({ id: c.id, bucket: "excluded", slug: null, conf: 95, why: "Title signals student/intern/fresher — excluded.", method: "rule" });
      done += 1; continue;
    }
    const peerSig = companyPeerSignal(c.companyRaw ?? "");
    if (peerSig) {
      ruleVerdicts.push({ id: c.id, bucket: "peer_competitor", slug: null, conf: 85, why: `Company name signals an agency/studio ("${peerSig}") — peer, not buyer.`, method: "rule" });
      done += 1; continue;
    }
    const offSig = offIcpTitleSignal(title);
    if (offSig) {
      ruleVerdicts.push({ id: c.id, bucket: "off_icp", slug: null, conf: 85, why: `Title signals coach/personal-brand ("${offSig}") — audience, not buyer.`, method: "rule" });
      done += 1; continue;
    }
    const rule = rulePass(title, services);
    if (rule.hit) {
      ruleHits += 1;
      ruleVerdicts.push({
        id: c.id, bucket: "pitchable", slug: rule.hit.serviceSlug, conf: 90,
        why: `Title matched pattern "${rule.hit.pattern}" for ${rule.hit.serviceSlug} · seniority ${rule.hit.seniority}.`, method: "rule",
      });
      done += 1; continue;
    }
    needLlm.push(c);
  }
  await bulkSetFit(ruleVerdicts);
  if (onProgress) await onProgress(done, rows.length);

  // Pass 2 — LLM in batches of 25, capped by the matching guardrail,
  // v10: 3 calls in flight at once; each call's 25 verdicts land in one bulk write.
  const { classifyLlmPeopleCap } = settings;
  const digest = servicesDigest(services);
  const slices: (typeof rows)[] = [];
  let planned = 0;
  for (let i = 0; i < needLlm.length; i += BATCH) {
    const slice = needLlm.slice(i, i + BATCH);
    if (classifyLlmPeopleCap !== "all" && planned + slice.length > classifyLlmPeopleCap) break;
    planned += slice.length;
    slices.push(slice);
  }

  const CONCURRENCY = 3;
  const failures: string[] = [];
  let next = 0;

  const runSlice = async (slice: typeof rows) => {
    const peopleJson = JSON.stringify(slice.map((c) => ({
      id: c.id,
      name: `${c.firstName} ${c.lastName}`.trim(),
      company: c.companyRaw ?? "",
      position: c.positionRaw ?? c.headlineRaw ?? "",
    })), null, 0);

    const out = await complete({
      stage: "classify",
      prompt: "service-fit",
      version: env.CLASSIFY_PROMPT_VERSION,
      vars: { people_json: peopleJson, own_company: settings.sellerName || "the firm itself" },
      cachedContext: digest,
      schema: fitArray,
      maxTokens: 6000,
    });
    llmCalls += 1;

    const byId = new Map(out.map((o) => [o.id, o]));
    const verdicts: Verdict[] = [];
    for (const c of slice) {
      const o = byId.get(c.id);
      if (!o) {
        verdicts.push({ id: c.id, bucket: "off_icp", slug: null, conf: 0, why: "Classifier returned no verdict — review manually.", method: "llm" });
      } else {
        let bucket = o.bucket;
        let slug = o.service_slug;
        let why = o.why;
        if (!KNOWN_BUCKETS.has(bucket)) {
          if (services.some((s) => s.slug === bucket)) {
            slug = bucket;
            bucket = "pitchable";
          } else {
            why = `Classifier returned unknown bucket "${o.bucket}" — review. ${why}`;
            bucket = "off_icp";
            slug = null;
          }
        }
        if (bucket === "pitchable" && slug && !services.some((s) => s.slug === slug)) {
          why = `Unknown service slug "${slug}" — service cleared, review. ${why}`;
          slug = null;
        }
        verdicts.push({
          id: c.id, bucket,
          slug: bucket === "pitchable" ? slug : null,
          conf: o.confidence, why, method: "llm",
        });
      }
    }
    await bulkSetFit(verdicts);
    done += slice.length;
    if (onProgress) await onProgress(done, rows.length);
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      if (shouldStop && (await shouldStop())) return;
      const i = next; next += 1;
      if (i >= slices.length) return;
      try {
        await runSlice(slices[i]);
      } catch (e) {
        failures.push(e instanceof Error ? e.message.slice(0, 200) : "unknown error");
      }
    }
  }));

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} of ${slices.length} model calls failed (first: ${failures[0]}). Their rows stay unclassified — press Run matching to retry them.`,
    );
  }
  return { classified: done, ruleHits, llmCalls };
}

async function setFit(id: string, fit: {
  bucket: string; service_slug: string | null; confidence: number; why: string; method: "rule" | "llm";
}) {
  await db.update(connection).set({
    bucket: fit.bucket, serviceSlug: fit.service_slug,
    matchConfidence: fit.confidence, matchWhy: fit.why, matchMethod: fit.method,
  }).where(eq(connection.id, id));
}

interface Verdict { id: string; bucket: string; slug: string | null; conf: number; why: string; method: "rule" | "llm" }

/** v10: verdicts land in chunked bulk updates — one statement per 500 rows
 *  instead of one round-trip per person. */
async function bulkSetFit(items: Verdict[]) {
  const CHUNK = 500;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const values = sql.join(chunk.map((it) =>
      sql`(${it.id}::text, ${it.bucket}::text, ${it.slug}::text, ${it.conf}::int, ${it.why}::text, ${it.method}::text)`,
    ), sql`, `);
    await db.execute(sql`
      update connection as c
      set bucket = v.bucket, service_slug = v.service_slug,
          match_confidence = v.match_confidence, match_why = v.match_why, match_method = v.match_method
      from (values ${values}) as v(id, bucket, service_slug, match_confidence, match_why, match_method)
      where c.id = v.id
    `);
  }
}

export async function bucketCounts(batchId: string): Promise<Record<string, number>> {
  const rows = await db.select({ bucket: connection.bucket }).from(connection)
    .where(eq(connection.batchId, batchId));
  const out: Record<string, number> = { pitchable: 0, off_icp: 0, peer_competitor: 0, excluded: 0, unclassified: 0 };
  for (const r of rows) out[r.bucket ?? "unclassified"] += 1;
  return out;
}

export async function markSelection(batchId: string, ids: string[], selected: boolean) {
  if (ids.length === 0) return;
  // Never reset finished or in-flight people: extending a selection queues only
  // the new/failed rows, so already-paid enrichment is preserved.
  await db.update(connection).set({
    selectedForEnrich: selected,
    enrichStatus: selected
      ? sql`case when ${connection.enrichStatus} in ('done','running') then ${connection.enrichStatus} else 'queued' end`
      : sql`case when ${connection.enrichStatus} in ('done','running') then ${connection.enrichStatus} else 'pending' end`,
  }).where(and(eq(connection.batchId, batchId), inArray(connection.id, ids)));
}
