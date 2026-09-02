import { getOrgSettings } from "@/modules/settings/org-settings";
import { toCountry } from "@/modules/connections/country";
import { stampMetro } from "@/modules/geo/metros";
/**
 * Stage B — one connection at a time: fetch profile + posts through the
 * connected LinkedIn seat, run the deep-dive prompt, then draft the message.
 * Degrades gracefully: no channel account, or no LinkedIn identifier →
 * profile/posts are NONE and the prompt infers from role + company (marked).
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, channelAccount, connection, service } from "@/db";
import { complete } from "@/llm/client";
import { getChannelProvider } from "@/providers/channel";
import { servicesDigest } from "@/modules/matching/service-fit";

const SENDER_CONTEXT =
  "toss the coin — a B2B marketing services firm (demand gen + ABM + content, CMO office, GTM office, Marketeroid for founders, branding/rebranding, sales enablement). Warm, specific, senior voice.";

const deepDiveOut = z.object({
  about_summary: z.string(),
  posts_summary: z.string(),
  pain_points: z.string(),
  pain_inferred: z.boolean(),
  service_to_pitch: z.string(),
  correction_reason: z.string().nullable(),
  flag: z.string().nullable(),
});
const messageOut = z.object({ message: z.string().min(20) });

export async function deepEnrichOne(orgId: string, connectionId: string): Promise<void> {
  const [c] = await db.select().from(connection)
    .where(and(eq(connection.id, connectionId), eq(connection.orgId, orgId)));
  if (!c) throw new Error("Connection not found");
  await db.update(connection).set({ enrichStatus: "running", enrichError: null })
    .where(eq(connection.id, c.id));

  try {
    // 1 — fetch through the connected seat (both fetches optional).
    const [seat] = await db.select().from(channelAccount)
      .where(and(eq(channelAccount.orgId, orgId), eq(channelAccount.status, "operational")));
    const identifier = c.publicIdentifier ?? c.linkedinUrl;
    let headline = c.headlineRaw ?? "";
    let about = "";
    let postsBlock = "NONE";
    let lastPostAt: Date | null = null;
    let fetchedLocation: string | null = null;
    if (seat && identifier) {
      const provider = getChannelProvider();
      const profile = await provider.fetchProfile({ accountId: seat.unipileAccountId, identifier });
      if (profile) { headline = profile.headline ?? headline; about = profile.about ?? ""; fetchedLocation = profile.location ?? null; }
      // Unipile's posts endpoint requires the provider-internal id, not the
      // public identifier the profile endpoint accepts. Degrade to the
      // "no posts" reality on any posts hiccup — never kill the person for it.
      try {
        const postsId = profile?.providerId ?? identifier;
        const posts = await provider.fetchRecentPosts({ accountId: seat.unipileAccountId, identifier: postsId, limit: 5 });
        for (const post of posts) {
          const d = post.postedAt ? new Date(post.postedAt) : null;
          if (d && !Number.isNaN(d.getTime()) && (!lastPostAt || d > lastPostAt)) lastPostAt = d;
        }
        if (posts.length > 0) {
          postsBlock = posts.map((p, i) =>
            `[${i + 1}] (${p.postedAt ?? "undated"}) ${p.text.slice(0, 600)}`).join("\n\n");
        }
      } catch { /* postsBlock stays NONE — the prompt infers and marks it */ }
    }

    const activityUrl = c.linkedinUrl
      ? `${c.linkedinUrl.replace(/\/+$/, "")}/recent-activity/all/` : null;

    // 2 — deep-dive analysis.
    const services = (await db.select().from(service)
      .where(and(eq(service.orgId, orgId), eq(service.status, "active"))))
      .map((s) => ({ slug: s.slug, name: s.name, icp: s.icpJson }));
    const dive = await complete({
      stage: "deepdive",
      prompt: "connection-deep-dive",
      vars: {
        provisional_service: c.serviceSlug ?? "none",
        provisional_why: c.matchWhy ?? "",
        full_name: `${c.firstName} ${c.lastName}`.trim(),
        company: c.companyRaw ?? "unknown",
        position: c.positionRaw ?? c.headlineRaw ?? "unknown",
        linkedin_url: c.linkedinUrl ?? "unknown",
        headline: headline || "(not available)",
        about: about || "(not available)",
        posts_block: postsBlock,
      },
      cachedContext: servicesDigest(services),
      schema: deepDiveOut,
      maxTokens: 1600,
    });

    // 3 — outreach draft, in the seat owner's own voice when sampled.
    const voice = (await getOrgSettings(c.orgId)).voiceProfile;
    const msg = await complete({
      stage: "deepdive",
      prompt: "outreach-message",
      vars: {
        sender_context: SENDER_CONTEXT + (voice
          ? `\n\nWRITE IN THE SENDER'S OWN VOICE — follow this style profile exactly (it overrides generic tone rules, but never the hard rules):\n${voice}`
          : ""),
        target_block: [
          `${c.firstName} ${c.lastName} — ${c.positionRaw ?? headline} at ${c.companyRaw ?? "?"}`,
          `About: ${dive.about_summary}`,
          `Posts: ${dive.posts_summary}`,
        ].join("\n"),
        service_to_pitch: dive.service_to_pitch,
        pain_points: dive.pain_points,
        flag: dive.flag ?? "none",
      },
      schema: messageOut,
      maxTokens: 500,
    });

    await db.update(connection).set({
      enrichStatus: "done",
      // The profile fetch is the first time we ever learn where someone is —
      // the connections list does not carry it. Persist so filters work.
      location: fetchedLocation ?? c.location,
      country: toCountry(fetchedLocation) ?? c.country,
      ...stampMetro({
        location: fetchedLocation ?? c.location,
        headline: headline || c.headlineRaw || c.positionRaw,
        country: toCountry(fetchedLocation) ?? c.country,
      }),
      aboutSummary: dive.about_summary,
      activityUrl,
      postsSummary: dive.posts_summary,
      painPoints: dive.pain_points,
      painInferred: dive.pain_inferred,
      serviceConfirmed: dive.service_to_pitch,
      correctionReason: dive.correction_reason,
      flag: dive.flag,
      outreachMessage: msg.message,
      enrichedAt: new Date(),
      // Never erase a date we already know: the profile/posts fetch is allowed
      // to fail (no seat, no identifier, LinkedIn hiccup) and leave this null,
      // and the cheap activity scan may have paid for this value already.
      lastPostAt: lastPostAt ?? c.lastPostAt,
    }).where(eq(connection.id, c.id));
  } catch (e) {
    await db.update(connection).set({
      enrichStatus: "failed",
      enrichError: e instanceof Error ? e.message.slice(0, 500) : "unknown error",
    }).where(eq(connection.id, c.id));
    throw e;
  }
}
