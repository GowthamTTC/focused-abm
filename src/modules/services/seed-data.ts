/**
 * The six TTC solutions as editable starting ICPs — v2, derived from the actual
 * TTC Batch-1 ground truth (4,502 classified rows) rather than assumptions.
 *
 * The ground truth's routing logic, faithfully encoded:
 *   CMO title            → cmo-office            (33 · 0.7%)
 *   other marketing/comms→ demand-gen-abm-content (497 · 11%)
 *   sales / BD / revenue → sales-enablement       (291 · 6.5%)
 *   founder / CEO / owner→ marketeroid            (1,003 · 22.3%)
 *   designers            → branding-rebranding    (150 · 3.3%)
 *   everyone else employed → gtm-office           (2,528 · 56.2% — the catch-all)
 *
 * Peer detection is COMPANY-driven and off-ICP is coach-TITLE-driven; both live
 * as pre-signals in matching/rule-pass.ts, not here.
 */
import type { IcpJson } from "@/db/schema";

export const SEED_SERVICES: { slug: string; name: string; icp: IcpJson }[] = [
  {
    slug: "demand-gen-abm-content",
    name: "Demand Gen + ABM + Content",
    icp: {
      summary: "Pipeline programs (demand gen, ABM, content) pitched to marketing-function people at B2B companies — from CMO-minus-one down to hands-on marketers who influence or feel the pipeline problem daily.",
      fit_signals: [
        "Any marketing-function title below CMO: VP/AVP/GM/DGM/Head/Director/Manager/Specialist/Executive of Marketing",
        "Growth, demand generation, digital marketing, performance marketing, SEO, social media roles",
        "Content and communications roles (content writer, content head, communications manager)",
        "Works at a B2B company (not an agency — agencies are peers)",
      ],
      pain_points: [
        "Pipeline attribution gaps",
        "Content volume vs. quality squeeze",
        "Marketing-to-sales handoff friction",
        "Proving marketing's pipeline contribution to leadership",
      ],
      personas: [
        {
          slug: "marketing-function",
          name: "Marketing-function professional (non-CMO)",
          title_include: [
            "marketing", "growth", "demand", "content", "communications",
            "digital marketing", "performance marketing", "seo", "social media",
            "brand manager",
          ],
          title_exclude: ["chief marketing officer", "intern", "student", "aspiring", "freelance"],
          seniority: ["vp", "head", "director", "manager", "ic"],
          function_tags: ["marketing", "demand", "growth", "content"],
        },
      ],
      disqualifiers: [
        "CMO title-holders (route to cmo-office)",
        "Works at a marketing/creative/digital agency (peer)",
        "Marketing coaches and personal-brand consultants (off-ICP)",
      ],
    },
  },
  {
    slug: "cmo-office",
    name: "CMO Office",
    icp: {
      summary: "Embedded senior marketing leadership support pitched specifically to sitting CMOs — the strategy capacity and sounding board a stretched CMO lacks.",
      fit_signals: [
        "Holds the Chief Marketing Officer title (or Group CMO)",
        "At a company where the CMO visibly stretches across strategy AND execution",
      ],
      pain_points: [
        "No time for strategy — everything is execution firefighting",
        "No senior marketing peer to pressure-test decisions with",
        "Board expectations rising faster than team capacity",
      ],
      personas: [
        {
          slug: "sitting-cmo",
          name: "Sitting CMO",
          title_include: ["chief marketing officer", "group chief marketing officer"],
          title_exclude: ["assistant to", "office of", "intern", "student"],
          seniority: ["cxo"],
          function_tags: ["marketing"],
        },
      ],
      disqualifiers: [
        "CMO of a marketing agency (peer)",
        "Fractional-CMO providers selling the same service (peer)",
      ],
    },
  },
  {
    slug: "gtm-office",
    name: "GTM Office",
    icp: {
      summary: "Go-to-market strategy and motion building — the default pitch for senior business professionals at B2B companies who lack a marketing/sales/founder signature: MDs, partners, product, operations, engineering, HR, analysts, consultants. Their company has a GTM problem even when their title doesn't say so.",
      fit_signals: [
        "Employed professionals at B2B companies without a marketing, sales, or founder title",
        "Managing Directors, Partners, Presidents (non-founder)",
        "Product, engineering, operations, project, data, analyst, HR, finance, account roles",
        "Consultants and general management",
      ],
      pain_points: [
        "Company's category has no shared language yet",
        "No repeatable GTM motion; growth depends on referrals and heroics",
        "Strategy exists on slides but not in weekly execution",
      ],
      personas: [
        {
          slug: "business-professional",
          name: "Senior business professional (catch-all)",
          title_include: [
            "managing director", "partner", "president", "general manager",
            "product", "engineer", "operations", "project", "analyst",
            "human resources", "software", "data", "account", "consultant",
            "management", "principal", "delivery",
          ],
          title_exclude: ["intern", "student", "fresher", "trainee", "aspiring"],
          seniority: ["cxo", "vp", "head", "director", "manager", "ic"],
          function_tags: ["gtm", "product", "operations", "general"],
        },
      ],
      disqualifiers: [
        "Anyone with a marketing, sales, founder/CEO, or designer signature (other services fit better)",
        "Students, interns, job-seekers",
        "GTM consultants selling GTM services themselves (peer)",
      ],
    },
  },
  {
    slug: "marketeroid",
    name: "Marketeroid",
    icp: {
      summary: "Senior marketing strategy + execution from day one, pitched to founders, CEOs, and owners of B2B companies with no senior in-house marketer.",
      fit_signals: [
        "Founder / Co-founder / CEO / Owner / Proprietor of a B2B company",
        "No evident senior marketing leadership at the company",
        "Founder is the de-facto marketer 'whenever there is time'",
      ],
      pain_points: [
        "Audience acquired but never converted into pipeline",
        "No consistent positioning or demand presence",
        "Marketing happens in bursts around events, then goes silent",
        "Knows marketing matters; cannot justify a senior full-time hire yet",
      ],
      personas: [
        {
          slug: "founder",
          name: "Founder / CEO / Owner",
          title_include: [
            "founder", "co founder", "cofounder", "founding partner",
            "chief executive officer", "owner", "proprietor",
          ],
          title_exclude: ["student", "aspiring", "intern"],
          seniority: ["founder", "cxo"],
          function_tags: [],
        },
      ],
      disqualifiers: [
        "Founder of a marketing/creative/digital agency (peer — company name is the tell)",
        "Company already has a CMO / VP Marketing",
        "Coaches and personal-brand businesses (off-ICP)",
        "Managing Directors of established firms (route to gtm-office per ground truth)",
      ],
    },
  },
  {
    slug: "branding-rebranding",
    name: "Branding / Rebranding",
    icp: {
      summary: "Brand strategy and repositioning — pitched to in-house design and brand-craft people (UX/UI/graphic designers, brand strategists) whose companies are visibly outgrowing their story.",
      fit_signals: [
        "In-house designer titles: UX designer, UI/UX, graphic designer, design lead",
        "Brand strategy roles at non-agency companies",
        "Company at an inflection: IPO/listing, fresh funding, category shift, legacy modernizing",
      ],
      pain_points: [
        "Market still tells the old story about the company",
        "Narrative inconsistent across analysts, media, buyers, and hiring",
        "Product and delivery outran the brand years ago",
      ],
      personas: [
        {
          slug: "design-brand-craft",
          name: "In-house design / brand-craft professional",
          title_include: [
            "designer", "graphic design", "ui ux", "ux design", "design lead",
            "brand strategy", "visual design",
          ],
          title_exclude: ["fashion designer", "jewellery designer", "interior designer", "intern", "student"],
          seniority: ["head", "manager", "ic"],
          function_tags: ["brand", "design"],
        },
      ],
      disqualifiers: [
        "Designers AT agencies/studios (peer — company name is the tell)",
        "Personal-branding coaches (off-ICP)",
        "Freelance designers selling design themselves (peer)",
      ],
    },
  },
  {
    slug: "sales-enablement",
    name: "Sales Enablement",
    icp: {
      summary: "Positioning, objection-handling, and account narratives — pitched to sales and business-development people at B2B companies, from CRO down to BD managers who improvise their own story daily.",
      fit_signals: [
        "Any sales-function title: VP/Head/Director/Manager/Executive of Sales",
        "Business development roles at every level",
        "Revenue leadership (CRO, Chief Business Officer, Business Head)",
        "Complex multi-stakeholder B2B deals",
      ],
      pain_points: [
        "Every AE improvises their own story",
        "Objection handling lives in one senior person's head",
        "Sales collateral lags the actual deal conversations",
        "Long cycles stalling at the business-case stage",
      ],
      personas: [
        {
          slug: "sales-function",
          name: "Sales / BD professional",
          title_include: [
            "sales", "business development", "revenue", "chief revenue officer",
            "chief business officer", "business head", "national sales",
          ],
          title_exclude: ["telesales", "intern", "student", "aspiring"],
          seniority: ["cxo", "vp", "head", "director", "manager", "ic"],
          function_tags: ["sales", "revenue"],
        },
      ],
      disqualifiers: [
        "Transactional / B2C / retail sales",
        "Sales trainers and coaches selling enablement themselves (off-ICP/peer)",
      ],
    },
  },
];
