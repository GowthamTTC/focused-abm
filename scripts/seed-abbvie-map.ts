/**
 * Seed the AbbVie org map for one workspace.
 *
 *   CONFIRM_PRODUCTION=1 ORG_ID=... railway run npx tsx scripts/seed-abbvie-map.ts
 *
 * The nine starred units are the pockets Ariel says it has landed in. They are
 * ASSERTIONS, not evidence — there is not one AbbVie person in the seat's
 * LinkedIn network, so nothing here could have been derived. The page labels
 * them as asserted for exactly that reason.
 *
 * The other twenty-three are a starting list of AbbVie business units and
 * functions, assembled from public knowledge of the company. They are a first
 * draft for someone who knows the account to correct in the editor, NOT a
 * verified org chart, and no claim on this page should be made as though they
 * were.
 */
import { eq } from "drizzle-orm";
import { db, org } from "../src/db";
import { parseUnitLines, saveAccountMap } from "../src/modules/accounts/org-map";

const UNITS = `
# Ariel's landed pockets — asserted by the team, not evidenced by the network
* Medical Affairs & HEOR | HEOR, Health Economics, Medical Affairs
* Data & Statistical Sciences | Biostatistics, Statistical Sciences
* Clinical Data Strategy | Clinical Data
* Dermatology
* Customer Excellence
* IRA Strategy | Inflation Reduction Act
* Patient Services Leadership | Patient Services
* Operations Transformation
* Commercial Operations | Commercial Ops

# Therapeutic areas and business units
Immunology
Oncology
Neuroscience
Eye Care | Allergan Eye Care
Allergan Aesthetics | Allergan, Botox, Juvederm, DiamondGlow | allerganaesthetics.com
Established Brands
Virology

# US subsidiaries and acquired operating companies. Public knowledge, assembled
# rather than verified against filings, and current only to early 2026 — anything
# acquired since is missing. Correct it in the map editor.
# The third field is the unit's own public website. Entities that kept a
# separate site after acquisition are externally-visible operating companies;
# the ones without were folded into abbvie.com. Unverified — check before use.
Pharmacyclics | Imbruvica | pharmacyclics.com
Cerevel Therapeutics | Cerevel | cerevel.com
ImmunoGen | Elahere | immunogen.com
Landos Biopharma | Landos | landosbiopharma.com
Capstan Therapeutics | Capstan | capstantx.com
Aliada Therapeutics | Aliada | aliadatx.com
Zeltiq Aesthetics | Zeltiq, CoolSculpting | coolsculpting.com
SkinMedica || skinmedica.com
Allergan Medical Institute | AMI | allerganmedicalinstitute.com
Natrelle || natrelle.com
Stemcentrx
Soliton
Syndesi Therapeutics | Syndesi
DJS Antibodies
Allergan Eye Care | Refresh, Restasis

# Functions
Regulatory Affairs
Quality Assurance
Manufacturing & Supply Chain | Operations, Supply Chain
Market Access & Pricing | Market Access
Legal & Compliance | Legal, Compliance
Finance
Business Technology | Information Technology
Discovery Research | Discovery
Clinical Development
Pharmacovigilance | Patient Safety
Human Resources | People, Talent
Corporate Affairs | Communications
Business Development | BD&L
Procurement
Patient Advocacy
`;

async function main() {
  if (process.env.CONFIRM_PRODUCTION !== "1") {
    throw new Error("Refusing to run without CONFIRM_PRODUCTION=1.");
  }
  const orgId = (process.env.ORG_ID ?? "").trim();
  if (!orgId) throw new Error("ORG_ID is required.");
  const [workspace] = await db.select().from(org).where(eq(org.id, orgId));
  if (!workspace) throw new Error(`No workspace ${orgId}.`);

  const units = parseUnitLines(UNITS);
  await saveAccountMap(orgId, {
    companyKey: "abbvie",
    name: "AbbVie",
    aliases: ["Allergan Aesthetics", "Allergan", "AbbVie Pharmaceuticals"],
    units,
    // Public facts, editable, and none of them inferred by this tool.
    profile: {
      badge: "Largest Ariel account",
      description: "A global biopharmaceutical company with a diverse portfolio across immunology, oncology, neuroscience, eye care and aesthetics.",
      website: "abbvie.com",
      employees: "~50,000 employees",
      location: "Global",
    },
    source: "drafted",
  });

  console.log(JSON.stringify({
    workspace: workspace.name,
    units: units.length,
    engaged: units.filter((u) => u.engaged).length,
    whitespace: units.filter((u) => !u.engaged).length,
  }, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
