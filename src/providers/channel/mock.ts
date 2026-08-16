/**
 * Deterministic mock — the whole app runs and demos with ZERO keys.
 * Personas are synthetic-safe: no real names, companies, or data.
 */
import type { ChannelProvider, FetchedPost, FetchedProfile, Relation } from "./types";

const FIRST = ["Asha", "Rahul", "Meera", "Vikram", "Priya", "Karthik", "Divya", "Arjun", "Sneha", "Manoj"];
const LAST = ["Iyer", "Sharma", "Nair", "Menon", "Reddy", "Das", "Kulkarni", "Pillai", "Bose", "Rao"];
const ROLES = [
  "VP Marketing", "Chief Marketing Officer", "Head of Demand Generation", "Founder & CEO",
  "VP Corporate Communications", "Director - Product Marketing", "AVP Sales & Marketing",
  "Brand Strategy Coach", "Creative Director", "Student at Business School",
];
const COS = [
  "Meridian SaaS Labs", "Cobalt Fintech", "Nimbus Cloudworks", "Vertex GovTech", "Aster Health AI",
  "Quill Media House", "Beacon Agency Collective", "Lumen Data Systems", "Orbit EdTech", "Trellis Logistics Tech",
];

function relationAt(i: number): Relation {
  const fn = FIRST[i % FIRST.length];
  const ln = LAST[(i * 3) % LAST.length];
  const role = ROLES[i % ROLES.length];
  const co = COS[(i * 7) % COS.length];
  const pid = `${fn}-${ln}-${i}`.toLowerCase();
  return {
    publicIdentifier: pid,
    memberId: `mock:${i}`,
    firstName: fn,
    lastName: ln,
    location: ["Chennai, Tamil Nadu, India", "Bengaluru, Karnataka, India", "Mumbai, Maharashtra, India", "Singapore", "Dubai, United Arab Emirates", "London, England, United Kingdom", "Austin, Texas, United States"][i % 7],
    headline: `${role} at ${co}`,
    profileUrl: `https://www.linkedin.com/in/${pid}`,
    connectedAt: new Date(Date.now() - i * 86400000).toISOString(),
  };
}

export class MockChannelProvider implements ChannelProvider {
  readonly name = "mock";
  private total = 120;

  async createHostedAuthLink(): Promise<{ url: string }> {
    return { url: "/api/mock/hosted-auth" };
  }

  async getAccountStatus(): Promise<{ status: "operational"; displayName: string }> {
    return { status: "operational", displayName: "Mock LinkedIn (demo)" };
  }

  async fetchRelations(input: { cursor: string | null; limit: number }) {
    const start = input.cursor ? Number(input.cursor) : 0;
    const end = Math.min(start + input.limit, this.total);
    const items = Array.from({ length: end - start }, (_, k) => relationAt(start + k));
    return { items, cursor: end < this.total ? String(end) : null };
  }

  async fetchProfile(input: { identifier: string }): Promise<FetchedProfile> {
    const i = Number(input.identifier.split("-").pop() ?? 0) || 0;
    const posts = i % 3 !== 0; // a third of mock people never post — mirrors reality
    return {
      headline: relationAt(i).headline,
      about: posts
        ? "15+ years in B2B marketing. Building pipeline programs and a small content team; writes about attribution, ABM, and doing more with less."
        : null,
      company: COS[(i * 7) % COS.length],
      location: "Chennai, India",
      providerId: `mock:${i}`,
    };
  }

  async fetchRecentPosts(input: { identifier: string; limit: number }): Promise<FetchedPost[]> {
    const i = Number(input.identifier.split("-").pop() ?? 0) || 0;
    if (i % 3 === 0) return []; // the no-posts reality
    return Array.from({ length: Math.min(3, input.limit) }, (_, k) => ({
      id: `mock-post-${i}-${k}`,
      text: [
        "Our attribution model still can't explain half the pipeline. Boards want certainty; buyers want fewer forms. Something has to give.",
        "Hot take: most ABM programs fail at the handoff, not the targeting. Sales rejects what marketing celebrates.",
        "We cut our content calendar in half and doubled engagement. Less, but sharper, wins in B2B.",
      ][k],
      postedAt: new Date(Date.now() - (k + 1) * 5 * 86400000).toISOString(),
      url: `https://www.linkedin.com/feed/update/mock-${i}-${k}`,
    }));
  }
}
