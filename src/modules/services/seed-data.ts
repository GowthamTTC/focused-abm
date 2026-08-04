/**
 * The six TTC solutions as editable starting ICPs, distilled from the
 * Batch-1 workbook's own matching logic. Everything here is editable in
 * the Services screen — treat as v1 hypotheses, not gospel.
 */
import type { IcpJson } from "@/db/schema";

export const SEED_SERVICES: { slug: string; name: string; icp: IcpJson }[] = [
  {
    slug: "demand-gen-abm-content",
    name: "Demand Gen + ABM + Content",
    icp: {
      summary: "Full-stack pipeline programs (demand gen, account-based marketing, content) for B2B tech/services companies whose marketing leader owns a pipeline number.",
      fit_signals: ["Senior marketing leader (CMO/VP/AVP/Head) at a B2B company", "Owns demand gen or pipeline", "Has a team but limited execution capacity", "Partner-led or ABM motion already visible"],
      pain_points: ["Pipeline attribution gaps", "Content volume vs. quality squeeze", "Marketing-to-sales handoff friction", "Proving marketing's pipeline contribution to the board"],
      personas: [
        { slug: "pipeline-owner", name: "Pipeline-owning marketing leader", title_include: ["chief marketing officer", "vice president marketing", "head of marketing", "head of demand", "vice president demand", "director demand generation", "assistant vice president marketing", "marketing head"], title_exclude: [], seniority: ["cxo", "vp", "head", "director"], function_tags: ["marketing", "demand", "growth"] },
      ],
      disqualifiers: ["Works at an agency/studio (peer)", "B2C-only company", "IC-level with no budget authority"],
    },
  },
  {
    slug: "cmo-office",
    name: "CMO Office",
    icp: {
      summary: "Embedded senior marketing leadership capacity for stretched title-holders — the strategy work that keeps getting skipped while they fight fires across functions.",
      fit_signals: ["Marketing title-holder at a small/mid company visibly covering multiple functions", "Brought into launches late", "No senior strategic sounding board"],
      pain_points: ["Marketing treated as a catch-all service desk", "No time for strategy", "Carrying ops/HR alongside marketing"],
      personas: [
        { slug: "stretched-leader", name: "Stretched marketing title-holder", title_include: [], title_exclude: [], seniority: ["cxo", "vp", "head"], function_tags: ["marketing"] },
      ],
      disqualifiers: ["Well-resourced global CMO with a full team (better: demand-gen-abm-content)"],
    },
  },
  {
    slug: "gtm-office",
    name: "GTM Office",
    icp: {
      summary: "Go-to-market motion building for launches, market entry, and new-category creation — positioning, analyst/buyer education, repeatable GTM cadence.",
      fit_signals: ["Product/GTM/category leader", "Early-stage company or new category", "Analyst-led motions, launch language in title"],
      pain_points: ["Category has no shared language yet", "No repeatable GTM motion", "Strategic thinking not translating to weekly execution"],
      personas: [
        { slug: "gtm-leader", name: "GTM / market-entry leader", title_include: ["go to market", "gtm lead", "gtm strategist", "product marketing lead"], title_exclude: [], seniority: ["cxo", "vp", "head", "director"], function_tags: ["gtm", "product"] },
      ],
      disqualifiers: ["Giant SI/consultancy with internal GTM infrastructure"],
    },
  },
  {
    slug: "marketeroid",
    name: "Marketeroid",
    icp: {
      summary: "Senior marketing strategy + execution from day one for founders/CEOs with no senior in-house marketer — no full hire, no agency overhead.",
      fit_signals: ["Founder/CEO/MD of a B2B company", "No evident marketing leadership", "Dormant audience or no content engine"],
      pain_points: ["Audience acquired but never converted", "No consistent positioning or demand presence", "Marketing stuck at 'whenever the founder has time'"],
      personas: [
        { slug: "founder", name: "Founder without a marketer", title_include: ["founder", "co founder", "chief executive officer", "managing director"], title_exclude: [], seniority: ["founder", "cxo"], function_tags: [] },
      ],
      disqualifiers: ["Founder of a marketing consultancy (peer)", "Company already has a CMO/VP Marketing"],
    },
  },
  {
    slug: "branding-rebranding",
    name: "Branding / Rebranding",
    icp: {
      summary: "Brand strategy and repositioning for companies at an inflection — IPO/listing, post-funding, category shift — where the story must change and stay consistent everywhere.",
      fit_signals: ["Corporate communications / brand leadership titles", "Repositioning moment visible (listing, Series funding, category relaunch)", "Brand craft is a stated personal focus"],
      pain_points: ["Market still tells the old story", "Narrative inconsistent across analysts/media/buyers", "Delivery outran the brand"],
      personas: [
        { slug: "brand-leader", name: "Brand / corp-comms leader", title_include: ["corporate communications", "brand", "communications head"], title_exclude: [], seniority: ["cxo", "vp", "head", "director"], function_tags: ["brand", "communications"] },
      ],
      disqualifiers: ["Personal-branding coaches (off-ICP, not buyers)"],
    },
  },
  {
    slug: "sales-enablement",
    name: "Sales Enablement",
    icp: {
      summary: "Positioning, objection-handling, and account narratives built once, properly — for sales leaders currently writing their own enablement material between client calls.",
      fit_signals: ["VP/Head of Sales or Enterprise Sales at a B2B company", "Publishes boardroom-oriented positioning content themselves", "Complex, multi-stakeholder deals"],
      pain_points: ["Every AE improvises their own story", "Objection handling lives in one person's head", "Sales collateral lags the deal conversations"],
      personas: [
        { slug: "sales-leader", name: "Enterprise sales leader", title_include: ["vice president sales", "head of sales", "vice president enterprise sales", "sales director", "chief revenue officer"], title_exclude: [], seniority: ["cxo", "vp", "head", "director"], function_tags: ["sales", "revenue"] },
      ],
      disqualifiers: ["Transactional/B2C sales"],
    },
  },
];
