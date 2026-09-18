/**
 * Creating `service` rows for a workspace that is defining its own catalog —
 * the setup wizard's step 2, whether the ICPs came from a website crawl or the
 * user chose to start from a blank one.
 */
import { eq } from "drizzle-orm";
import { db, service, type IcpJson } from "@/db";

export const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

export const BLANK_SERVICE_NAME = "My first offer";

/** Intentionally hollow: the setup gate only lets a workspace past the ICP step
 *  once a summary and buyer titles exist, so a blank row cannot be waved
 *  through by pressing Next. */
export function blankIcp(): IcpJson {
  return {
    summary: "",
    fit_signals: [],
    pain_points: [],
    disqualifiers: ["students", "interns", "recruiters", "job seekers"],
    personas: [{
      slug: "primary-buyer",
      name: "Primary buyer",
      title_include: [],
      title_exclude: [],
      seniority: ["founder", "cxo", "vp", "head", "director"],
      function_tags: [],
    }],
  };
}

async function takenSlugs(orgId: string): Promise<Set<string>> {
  const rows = await db.select({ slug: service.slug }).from(service)
    .where(eq(service.orgId, orgId));
  return new Set(rows.map((r) => r.slug));
}

function freeSlug(base: string, taken: Set<string>): string {
  const root = base || "service";
  if (!taken.has(root)) return root;
  for (let i = 2; i < 50; i++) {
    const candidate = `${root.slice(0, 44)}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root.slice(0, 40)}-${Date.now().toString(36).slice(-4)}`;
}

export async function insertServices(
  orgId: string,
  drafts: { slug: string; name: string; icp: IcpJson }[],
): Promise<string[]> {
  if (drafts.length === 0) return [];
  const taken = await takenSlugs(orgId);
  const rows = drafts.map((d) => {
    const slug = freeSlug(slugify(d.slug) || slugify(d.name), taken);
    taken.add(slug);
    return { orgId, slug, name: d.name, icpJson: d.icp };
  });
  await db.insert(service).values(rows);
  return rows.map((r) => r.slug);
}

export async function createBlankService(orgId: string): Promise<string> {
  const [slug] = await insertServices(orgId, [
    { slug: slugify(BLANK_SERVICE_NAME), name: BLANK_SERVICE_NAME, icp: blankIcp() },
  ]);
  return slug;
}
