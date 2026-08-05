/**
 * Stage A — classify every connection in a batch.
 * Rule pass first (free); everything unresolved goes to the LLM in batches
 * of 25 with the services digest as CACHED context (one cache write, ~200
 * cheap reads across a 5k-connection batch).
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, connection, service } from "@/db";
import type { IcpJson } from "@/db/schema";
import { complete } from "@/llm/client";
import { companyPeerSignal, offIcpTitleSignal, rulePass } from "./rule-pass";
import { detectSeniority } from "./normalize";
import { getOrgSettings } from "@/modules/settings/org-settings";

const BATCH = 25;
const OWN_COMPANY = "toss the coin"; // TODO: move to org settings

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
): Promise<{ classified: number; ruleHits: number; llmCalls: number }> {
  const services = (await db.select().from(service)
    .where(and(eq(service.orgId, orgId), eq(service.status, "active"))))
    .map((s) => ({ slug: s.slug, name: s.name, icp: s.icpJson }));
  if (services.length === 0) throw new Error("No active services — seed or create services first.");

  // Default: touch ONLY unclassified rows, so repeated runs genuinely continue
  // from where the guardrail stopped (and never re-bill the same people).
  // reclassifyAll wipes that filter for a deliberate fresh pass after ICP/prompt edits.
  const conditions = [eq(connection.batchId, batchId), eq(connection.orgId, orgId)];
  if (!opts.reclassifyAll) conditions.push(isNull(connection.bucket));
  const rows = await db.select().from(connection).where(and(...conditions));

  let done = 0; let ruleHits = 0; let llmCalls = 0;
  const needLlm: typeof rows = [];

  // Pass 1 — rules (also hard-excludes blanks and own-company rows).
  for (const c of rows) {
    const title = c.positionRaw ?? c.headlineRaw ?? "";
    const company = (c.companyRaw ?? "").toLowerCase();
    if (!title.trim() && !company.trim()) {
      await setFit(c.id, { bucket: "excluded", service_slug: null, confidence: 100, why: "Blank row — no position and no company.", method: "rule" });
      done += 1; continue;
    }
    if (company.includes(OWN_COMPANY)) {
      await setFit(c.id, { bucket: "excluded", service_slug: null, confidence: 100, why: "Works at our own company.", method: "rule" });
      done += 1; continue;
    }
    // Junior gate first: interns/students/freshers are excluded by rule (free),
    // matching the ground truth's treatment — before any other signal can claim them.
    if (detectSeniority(title) === "junior") {
      await setFit(c.id, { bucket: "excluded", service_slug: null, confidence: 95, why: "Title signals student/intern/fresher — excluded.", method: "rule" });
      done += 1; continue;
    }
    // Company-based peer signal BEFORE title matching — a founder at an agency
    // is a peer, and title patterns alone would misroute them to Marketeroid.
    const peerSig = companyPeerSignal(c.companyRaw ?? "");
    if (peerSig) {
      await setFit(c.id, { bucket: "peer_competitor", service_slug: null, confidence: 85, why: `Company name signals an agency/studio ("${peerSig}") — peer, not buyer.`, method: "rule" });
      done += 1; continue;
    }
    const offSig = offIcpTitleSignal(title);
    if (offSig) {
      await setFit(c.id, { bucket: "off_icp", service_slug: null, confidence: 85, why: `Title signals coach/personal-brand ("${offSig}") — audience, not buyer.`, method: "rule" });
      done += 1; continue;
    }
    const rule = rulePass(title, services);
    if (rule.hit) {
      ruleHits += 1;
      await setFit(c.id, {
        bucket: "pitchable", service_slug: rule.hit.serviceSlug, confidence: 90,
        why: `Title matched pattern "${rule.hit.pattern}" for ${rule.hit.serviceSlug} · seniority ${rule.hit.seniority}.`, method: "rule",
      });
      done += 1; continue;
    }
    needLlm.push(c);
  }
  if (onProgress) await onProgress(done, rows.length);

  // Pass 2 — LLM in batches of 25, capped by the matching guardrail.
  const { classifyLlmPeopleCap } = await getOrgSettings(orgId);
  let llmPeople = 0;
  const digest = servicesDigest(services);
  for (let i = 0; i < needLlm.length; i += BATCH) {
    const slice = needLlm.slice(i, i + BATCH);
    if (classifyLlmPeopleCap !== "all" && llmPeople + slice.length > classifyLlmPeopleCap) {
      break; // guardrail hit — remaining rows stay unclassified; next run continues
    }
    llmPeople += slice.length;
    const peopleJson = JSON.stringify(slice.map((c) => ({
      id: c.id,
      name: `${c.firstName} ${c.lastName}`.trim(),
      company: c.companyRaw ?? "",
      position: c.positionRaw ?? c.headlineRaw ?? "",
    })), null, 0);

    const out = await complete({
      stage: "classify",
      prompt: "service-fit",
      version: "v2",
      vars: { people_json: peopleJson, own_company: OWN_COMPANY },
      cachedContext: digest,
      schema: fitArray,
      maxTokens: 6000,
    });
    llmCalls += 1;

    const byId = new Map(out.map((o) => [o.id, o]));
    for (const c of slice) {
      const o = byId.get(c.id);
      if (!o) {
        await setFit(c.id, { bucket: "off_icp", service_slug: null, confidence: 0, why: "Classifier returned no verdict — review manually.", method: "llm" });
      } else {
        // Safety net: the model occasionally writes a service slug into the
        // bucket field. Auto-correct instead of failing the whole run.
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
        await setFit(c.id, {
          bucket,
          service_slug: bucket === "pitchable" ? slug : null,
          confidence: o.confidence, why, method: "llm",
        });
      }
      done += 1;
    }
    if (onProgress) await onProgress(done, rows.length);
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

export async function bucketCounts(batchId: string): Promise<Record<string, number>> {
  const rows = await db.select({ bucket: connection.bucket }).from(connection)
    .where(eq(connection.batchId, batchId));
  const out: Record<string, number> = { pitchable: 0, off_icp: 0, peer_competitor: 0, excluded: 0, unclassified: 0 };
  for (const r of rows) out[r.bucket ?? "unclassified"] += 1;
  return out;
}

export async function markSelection(batchId: string, ids: string[], selected: boolean) {
  if (ids.length === 0) return;
  await db.update(connection).set({ selectedForEnrich: selected, enrichStatus: selected ? "queued" : "pending" })
    .where(and(eq(connection.batchId, batchId), inArray(connection.id, ids)));
}
