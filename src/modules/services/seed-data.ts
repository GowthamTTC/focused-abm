/**
 * The TTC catalog as editable starting ICPs — v3, encoding the LIVE site
 * (tossthe.co.in, Aug 2026): GMO Office, GMO for PE, GTM for Manufacturing,
 * Hire a Marketeroid, Demand Gen + ABM, Branding + Before the Bell, and
 * Leadership Branding (etch). Senior decision-makers only — every persona is
 * gated to founder/cxo/vp/head/director; no manager/ic bands.
 *
 * Existing workspaces keep their own copies (isolation by design); Admin →
 * "Sync catalog to all workspaces" pushes the admin org's current catalog out.
 */
import type { IcpJson } from "@/db/schema";

export const SEED_SERVICES: { slug: string; name: string; icp: IcpJson }[] = [
  {
    slug: "gmo-office",
    name: "GMO Office",
    icp: {
      summary: "B2B companies (IT services, SaaS, consulting; ~50-1000 headcount) whose CEO/founder runs revenue without a true marketing leader, or whose lone marketing head needs a full office behind them. Decision-maker: the person who owns growth.",
      fit_signals: ["b2b", "it services", "saas", "technology services", "consulting", "sales-led", "no cmo in seat", "founder-led growth"],
      pain_points: ["no marketing leadership", "marketing is ad-hoc", "pipeline depends on referrals", "sales without marketing support", "cannot justify full-time cmo cost"],
      disqualifiers: ["students", "interns", "recruiters", "professors", "career coaches"],
      personas: [
        { slug: "ceo-founder-no-cmo", name: "CEO / Founder owning growth",
          title_include: ["chief executive", "ceo", "founder", "co-founder", "managing director", "managing partner"],
          title_exclude: ["assistant", "associate", "office of the"],
          seniority: ["founder", "cxo"], function_tags: ["general management", "growth"] },
        { slug: "revenue-leader", name: "CRO / Revenue head needing a marketing office",
          title_include: ["chief revenue", "cro", "chief growth", "chief business officer", "president", "head of business"],
          title_exclude: ["vice president", "assistant"],
          seniority: ["cxo", "head"], function_tags: ["revenue", "sales"] },
        { slug: "lone-marketing-head", name: "Marketing head who needs an office behind them",
          title_include: ["chief marketing", "cmo", "vp marketing", "head of marketing", "marketing director"],
          title_exclude: ["assistant", "associate", "executive - marketing"],
          seniority: ["cxo", "vp", "head", "director"], function_tags: ["marketing"] },
      ],
    },
  },
  {
    slug: "gmo-for-pe",
    name: "GMO for PE",
    icp: {
      summary: "PE/VC operating teams and leadership of PE-backed IT services & B2B portfolio companies looking to cut marketing SG&A ~65% via an offshore pod without losing pipeline. Buyers: Operating Partners, CEOs, CFOs.",
      fit_signals: ["private equity", "pe-backed", "portfolio company", "it services", "growth equity", "operating partner", "value creation", "ebitda focus"],
      pain_points: ["bloated us execution costs", "high agency dependence with unclear roi", "activities instead of pipeline contribution", "sg&a pressure", "fragmented marketing across portfolio"],
      disqualifiers: ["students", "interns", "recruiters", "professors", "early-stage angel-only investors"],
      personas: [
        { slug: "pe-operating-partner", name: "Operating Partner / Value-creation lead at a PE firm",
          title_include: ["operating partner", "operations partner", "value creation", "portfolio operations", "principal", "managing director"],
          title_exclude: ["assistant", "analyst", "associate"],
          seniority: ["cxo", "head", "director", "vp"], function_tags: ["private equity", "operations"] },
        { slug: "portfolio-cfo-ceo", name: "CFO / CEO of a PE-backed company",
          title_include: ["chief financial", "cfo", "chief executive", "ceo", "president"],
          title_exclude: ["vice president", "assistant", "deputy"],
          seniority: ["cxo", "founder"], function_tags: ["finance", "general management"] },
      ],
    },
  },
  {
    slug: "gtm-manufacturing",
    name: "GTM for Manufacturing",
    icp: {
      summary: "Owners and senior leadership of manufacturing, industrial, engineering and hardware B2B companies modernizing go-to-market — moving beyond dealer networks and trade shows into digital demand.",
      fit_signals: ["manufacturing", "industrial", "engineering", "factory", "oem", "b2b hardware", "exports", "machinery", "auto components", "chemicals"],
      pain_points: ["dependent on dealer network", "no digital pipeline", "trade-show-only marketing", "undifferentiated positioning", "export markets untapped"],
      disqualifiers: ["students", "interns", "recruiters", "professors", "shop-floor operators"],
      personas: [
        { slug: "mfg-owner-md", name: "Promoter / MD / CEO of a manufacturing firm",
          title_include: ["managing director", "chief executive", "ceo", "founder", "promoter", "chairman", "president", "business head", "plant head", "general manager"],
          title_exclude: ["vice president", "deputy general manager", "assistant", "dgm"],
          seniority: ["founder", "cxo", "head", "director"], function_tags: ["general management", "manufacturing"] },
        { slug: "mfg-commercial-head", name: "Sales / Commercial head in industrial B2B",
          title_include: ["director sales", "vp sales", "head of sales", "sales head", "commercial director", "chief commercial", "head of exports", "business development head"],
          title_exclude: ["assistant", "executive", "representative"],
          seniority: ["cxo", "vp", "head", "director"], function_tags: ["sales", "business development"] },
      ],
    },
  },
  {
    slug: "marketeroid",
    name: "Hire a Marketeroid",
    icp: {
      summary: "B2B founders and growth leaders who need a whole marketing team in one unit — too small for an agency retainer or in-house build, too serious for tools alone. Sweet spot: funded startups and mid-size B2B firms with pipeline pressure this quarter.",
      fit_signals: ["b2b saas", "startup", "series a", "series b", "funded", "growth stage", "lean team", "pipeline pressure"],
      pain_points: ["agency costs too much", "in-house takes too long", "ai tools lack judgment", "marketing bandwidth", "inconsistent content output"],
      disqualifiers: ["students", "interns", "recruiters", "professors", "b2c only"],
      personas: [
        { slug: "startup-founder", name: "Founder / CEO of a growth-stage B2B company",
          title_include: ["founder", "co-founder", "chief executive", "ceo"],
          title_exclude: ["assistant", "office of"],
          seniority: ["founder", "cxo"], function_tags: ["general management"] },
        { slug: "growth-leader", name: "Growth / Demand leader needing execution muscle",
          title_include: ["chief growth", "vp growth", "head of growth", "vp demand", "head of demand", "growth director", "vp marketing", "head of marketing"],
          title_exclude: ["assistant", "associate", "manager"],
          seniority: ["cxo", "vp", "head", "director"], function_tags: ["growth", "demand generation", "marketing"] },
      ],
    },
  },
  {
    slug: "demand-gen-abm",
    name: "Demand Gen + ABM",
    icp: {
      summary: "Senior marketing and revenue leaders at B2B companies (SaaS, IT services, 50-2000 headcount) who own a pipeline number and need demand generation, ABM programs and content that converts.",
      fit_signals: ["b2b saas", "it services", "enterprise software", "pipeline target", "abm", "demand generation", "sales-led with marketing"],
      pain_points: ["pipeline stalls", "no attribution", "content without conversion", "abm on spreadsheets", "mql quality"],
      disqualifiers: ["students", "interns", "recruiters", "professors", "b2c retail"],
      personas: [
        { slug: "demand-owner", name: "Demand / Growth leader with a number",
          title_include: ["vp demand", "head of demand", "demand generation director", "vp growth", "head of growth", "chief marketing", "cmo", "vp marketing", "head of marketing", "marketing director"],
          title_exclude: ["assistant", "associate", "executive", "manager"],
          seniority: ["cxo", "vp", "head", "director"], function_tags: ["demand generation", "marketing", "growth"] },
        { slug: "revenue-owner-dg", name: "CRO / Sales head buying pipeline support",
          title_include: ["chief revenue", "cro", "vp sales", "head of sales", "sales director"],
          title_exclude: ["vice president sales operations", "assistant"],
          seniority: ["cxo", "vp", "head", "director"], function_tags: ["sales", "revenue"] },
      ],
    },
  },
  {
    slug: "branding-before-the-bell",
    name: "Branding + Before the Bell",
    icp: {
      summary: "Leadership of B2B companies at inflection points — rebrand, repositioning, category creation, or the pre-IPO window ('Branding before the Bell') where the company story must be investor-ready.",
      fit_signals: ["rebrand", "repositioning", "pre-ipo", "ipo bound", "drhp", "merger", "acquisition", "category creation", "b2b"],
      pain_points: ["brand does not match ambition", "undifferentiated in category", "investor story unclear", "post-merger identity", "outdated identity"],
      disqualifiers: ["students", "interns", "recruiters", "professors"],
      personas: [
        { slug: "brand-decision-ceo", name: "CEO / Founder driving a rebrand",
          title_include: ["chief executive", "ceo", "founder", "co-founder", "managing director", "chairman"],
          title_exclude: ["assistant", "deputy"],
          seniority: ["founder", "cxo"], function_tags: ["general management"] },
        { slug: "pre-ipo-officer", name: "CFO / IR leader in the IPO window",
          title_include: ["chief financial", "cfo", "investor relations", "head of ir", "company secretary"],
          title_exclude: ["assistant", "analyst"],
          seniority: ["cxo", "head", "director"], function_tags: ["finance", "investor relations"] },
        { slug: "brand-cmo", name: "CMO owning the brand mandate",
          title_include: ["chief marketing", "cmo", "chief brand", "brand director", "head of brand"],
          title_exclude: ["assistant", "manager"],
          seniority: ["cxo", "head", "director"], function_tags: ["marketing", "brand"] },
      ],
    },
  },
  {
    slug: "leadership-branding-etch",
    name: "Leadership Branding (etch)",
    icp: {
      summary: "Senior leaders building their personal brand on LinkedIn - founders, CXOs, and established independent experts whose visibility drives their business. The buyer is the individual, not their company.",
      fit_signals: ["thought leadership", "personal brand", "linkedin presence", "keynote speaker", "author", "fractional leader", "independent consultant with a practice"],
      pain_points: ["expertise invisible online", "inconsistent posting", "ghostwritten content sounds generic", "profile does not match seniority", "no content system"],
      disqualifiers: ["students", "interns", "recruiters", "professors", "career coaches for individuals", "life coaches"],
      personas: [
        { slug: "leader-personal-brand", name: "Founder / CXO investing in their own brand",
          title_include: ["founder", "co-founder", "chief executive", "ceo", "chief", "managing director", "managing partner", "president"],
          title_exclude: ["vice president", "assistant"],
          seniority: ["founder", "cxo"], function_tags: ["leadership"] },
        { slug: "independent-expert", name: "Established independent expert / fractional leader",
          title_include: ["fractional cmo", "fractional cfo", "independent director", "advisor", "board member", "author", "keynote"],
          title_exclude: ["career coach", "life coach", "student"],
          seniority: ["founder", "cxo", "head"], function_tags: ["advisory"] },
      ],
    },
  },
];
