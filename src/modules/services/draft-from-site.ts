/**
 * Setup step 2: a URL in, draft `service` rows out. The crawl lives in
 * ./site-crawl; this file owns the LLM seam and the normalisation that keeps
 * the model's answer inside the IcpJson contract the rest of the product reads.
 */
import { z } from "zod";
import type { IcpJson, IcpPersona } from "@/db/schema";
import { complete } from "@/llm/client";
import type { Seniority } from "@/modules/matching/normalize";
import { CrawlError, type CrawlErrorCode, readSite } from "./site-crawl";
import { slugify } from "./create";

export const MAX_DRAFTS = 4;

const SENIORITY_BANDS: Seniority[] = [
  "founder", "cxo", "vp", "head", "director", "manager", "ic", "junior",
];

export type DraftErrorCode = CrawlErrorCode | "extract";

export interface ServiceDraft { slug: string; name: string; icp: IcpJson }

export type DraftOutcome =
  | { ok: true; pages: string[]; drafts: ServiceDraft[] }
  | { ok: false; code: DraftErrorCode };

/** Copy for every way this can fail, keyed by the code the URL carries back. */
export const DRAFT_ERROR_MESSAGE: Record<DraftErrorCode, string> = {
  "invalid-url": "That does not look like a website address. Try something like acme.com.",
  "private-host": "That address points inside a private network, so there is nothing public to read.",
  timeout: "The site took too long to answer. Try again, or add your services manually.",
  unreachable: "We could not reach that site. Check the address, or add your services manually.",
  blocked: "That site blocks automated readers. Add your services manually instead — it takes a minute.",
  notfound: "That page does not exist. Try the site's home page.",
  "not-html": "That link is a file, not a web page. Point us at the site's home page.",
  empty: "That page had no readable text — it is probably rendered entirely by JavaScript. Add your services manually instead.",
  extract: "We read the site but could not make sense of what you sell. Add your services manually and edit from there.",
};

/** Optional rather than defaulted on purpose: complete()'s `schema: ZodType<T>`
 *  collapses a schema's input and output types into one, so a `.default()`
 *  anywhere here makes the returned value untypeable. Fallbacks live in
 *  normalize() instead. */
const personaOut = z.object({
  slug: z.string().optional(),
  name: z.string(),
  title_include: z.array(z.string()).optional(),
  title_exclude: z.array(z.string()).optional(),
  seniority: z.array(z.string()).optional(),
  function_tags: z.array(z.string()).optional(),
});
const draftOut = z.object({
  services: z.array(z.object({
    slug: z.string(),
    name: z.string(),
    icp: z.object({
      summary: z.string(),
      fit_signals: z.array(z.string()).optional(),
      pain_points: z.array(z.string()).optional(),
      disqualifiers: z.array(z.string()).optional(),
      personas: z.array(personaOut).optional(),
    }),
  })).min(1),
});

const tags = (raw: string[] | undefined, max: number): string[] => {
  const out: string[] = [];
  for (const t of raw ?? []) {
    const v = t.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 90);
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
};

function normalizePersona(p: z.infer<typeof personaOut>, i: number): IcpPersona {
  const name = p.name.trim().slice(0, 80) || `Persona ${i + 1}`;
  const seniority = tags(p.seniority, 8)
    .filter((s): s is Seniority => (SENIORITY_BANDS as string[]).includes(s) && s !== "junior");
  return {
    slug: slugify(p.slug ?? name) || `persona-${i + 1}`,
    name,
    title_include: tags(p.title_include, 14),
    title_exclude: tags(p.title_exclude, 10),
    // An empty band list means "any seniority", which would let the rule pass
    // match interns; senior-only is the safer default for a drafted ICP.
    seniority: seniority.length > 0 ? seniority : ["founder", "cxo", "vp", "head", "director"],
    function_tags: tags(p.function_tags, 5),
  };
}

function normalize(raw: z.infer<typeof draftOut>): ServiceDraft[] {
  const out: ServiceDraft[] = [];
  for (const s of raw.services) {
    const name = s.name.trim().replace(/\s+/g, " ").slice(0, 120);
    const slug = slugify(s.slug || name);
    if (!name || !slug || out.some((d) => d.slug === slug)) continue;
    const personas = (s.icp.personas ?? []).slice(0, 3).map(normalizePersona)
      .filter((p) => p.title_include.length > 0);
    const summary = s.icp.summary.trim().slice(0, 1200);
    // A draft with no summary or no titled persona would land in the workspace
    // as an offer the ICP gate then refuses to pass — worse than not drafting it.
    if (!summary || personas.length === 0) continue;
    out.push({
      slug,
      name,
      icp: {
        summary,
        fit_signals: tags(s.icp.fit_signals, 12),
        pain_points: tags(s.icp.pain_points, 10),
        disqualifiers: tags(s.icp.disqualifiers, 8),
        personas,
      },
    });
    if (out.length >= MAX_DRAFTS) break;
  }
  return out;
}

export async function draftServicesFromUrl(rawUrl: string): Promise<DraftOutcome> {
  let site;
  try {
    site = await readSite(rawUrl);
  } catch (e) {
    if (e instanceof CrawlError) return { ok: false, code: e.code };
    throw e;
  }

  try {
    const answer = await complete({
      stage: "deepdive",
      prompt: "service-draft",
      vars: {
        site_url: site.pages[0],
        site_text: site.text,
        max_services: String(MAX_DRAFTS),
      },
      schema: draftOut,
      maxTokens: 4000,
    });
    const drafts = normalize(answer);
    if (drafts.length === 0) return { ok: false, code: "extract" };
    return { ok: true, pages: site.pages, drafts };
  } catch {
    return { ok: false, code: "extract" };
  }
}
