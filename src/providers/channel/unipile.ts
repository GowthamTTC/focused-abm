/**
 * Unipile adapter. Endpoint paths follow Unipile's REST docs; verify the
 * exact response field names against your dashboard's live docs on Day 4 —
 * the zod schemas below use .passthrough() and defensive mapping so minor
 * naming drift degrades gracefully instead of crashing.
 */
import { z } from "zod";
import { env } from "@/lib/env";
import type { ChannelProvider, FetchedPost, FetchedProfile, Relation, SearchHit } from "./types";

function base(): string {
  const dsn = env.UNIPILE_DSN!;
  return dsn.startsWith("http") ? dsn : `https://${dsn}`;
}

async function uni<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base()}/api/v1${path}`, {
    ...init,
    headers: {
      "X-API-KEY": env.UNIPILE_API_KEY!,
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 429) throw new Error("UNIPILE_RATE_LIMITED");
  if (!res.ok) throw new Error(`Unipile ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

const relationItem = z.object({
  location: z.string().nullish(),
  public_identifier: z.string().nullish(),
  member_id: z.string().nullish(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  headline: z.string().nullish(),
  public_profile_url: z.string().nullish(),
  created_at: z.union([z.string(), z.number()]).nullish(),
}).passthrough();

const relationsPage = z.object({
  items: z.array(relationItem).default([]),
  cursor: z.string().nullish(),
}).passthrough();

const profileShape = z.object({
  provider_id: z.string().nullish(),
  headline: z.string().nullish(),
  summary: z.string().nullish(),
  location: z.string().nullish(),
  work_experience: z.array(z.object({ company: z.string().nullish() }).passthrough()).nullish(),
}).passthrough();

const postItem = z.object({
  id: z.string().nullish(),
  social_id: z.string().nullish(),
  text: z.string().nullish(),
  parsed_datetime: z.string().nullish(),
  date: z.string().nullish(),
  share_url: z.string().nullish(),
}).passthrough();

const postsPage = z.object({ items: z.array(postItem).default([]) }).passthrough();

const searchItem = z.object({
  id: z.string().nullish(),
  name: z.string().nullish(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  headline: z.string().nullish(),
  location: z.string().nullish(),
  public_identifier: z.string().nullish(),
  profile_url: z.string().nullish(),
  public_profile_url: z.string().nullish(),
  network_distance: z.union([z.string(), z.number()]).nullish(),
  member_urn: z.string().nullish(),
}).passthrough();

const searchPage = z.object({
  items: z.array(searchItem).default([]),
  cursor: z.string().nullish(),
}).passthrough();

function splitName(name: string | null | undefined): { first: string; last: string } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "(unknown)", last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function distanceOf(raw: string | number | null | undefined): "1" | "2" | "3" | null {
  const s = String(raw ?? "").toUpperCase();
  if (s === "1" || s.includes("DISTANCE_1") || s.includes("FIRST")) return "1";
  if (s === "2" || s.includes("DISTANCE_2") || s.includes("SECOND")) return "2";
  if (s === "3" || s.includes("DISTANCE_3") || s.includes("THIRD")) return "3";
  return null;
}

export class UnipileChannelProvider implements ChannelProvider {
  readonly name = "unipile";

  async createHostedAuthLink(input: {
    userRef: string; successRedirectUrl: string; failureRedirectUrl: string; notifyUrl: string;
  }): Promise<{ url: string }> {
    const out = await uni<{ url: string }>("/hosted/accounts/link", {
      method: "POST",
      body: JSON.stringify({
        type: "create",
        providers: ["LINKEDIN"],
        api_url: base(),
        expiresOn: new Date(Date.now() + 3600_000).toISOString(),
        name: input.userRef,
        success_redirect_url: input.successRedirectUrl,
        failure_redirect_url: input.failureRedirectUrl,
        notify_url: input.notifyUrl,
      }),
    });
    return { url: out.url };
  }

  async getAccountStatus(accountId: string) {
    const acc = await uni<{
      name?: string;
      sources?: { status?: string }[];
      connection_params?: { im?: { username?: string } };
    }>(`/accounts/${accountId}`);
    const raw = acc.sources?.[0]?.status ?? "OK";
    const status = raw === "OK" ? "operational" as const
      : raw === "CREDENTIALS" ? "needs_reauth" as const
      : "disconnected" as const;
    return { status, displayName: acc.name ?? acc.connection_params?.im?.username ?? null };
  }

  async fetchRelations(input: { accountId: string; cursor: string | null; limit: number }) {
    const qs = new URLSearchParams({ account_id: input.accountId, limit: String(input.limit) });
    if (input.cursor) qs.set("cursor", input.cursor);
    const page = relationsPage.parse(await uni(`/users/relations?${qs}`));
    const items: Relation[] = page.items.map((r) => ({
      publicIdentifier: r.public_identifier ?? null,
      memberId: r.member_id ?? null,
      firstName: r.first_name ?? "",
      lastName: r.last_name ?? "",
      headline: r.headline ?? null,
      location: r.location ?? null,
      profileUrl: r.public_profile_url ??
        (r.public_identifier ? `https://www.linkedin.com/in/${r.public_identifier}` : null),
      connectedAt: r.created_at != null ? String(r.created_at) : null,
    }));
    return { items, cursor: page.cursor ?? null };
  }

  async fetchProfile(input: { accountId: string; identifier: string }): Promise<FetchedProfile | null> {
    const p = profileShape.parse(
      await uni(`/users/${encodeURIComponent(input.identifier)}?account_id=${input.accountId}`),
    );
    return {
      headline: p.headline ?? null,
      about: p.summary ?? null,
      company: p.work_experience?.[0]?.company ?? null,
      location: p.location ?? null,
      providerId: p.provider_id ?? null,
    };
  }

  async fetchRecentPosts(input: { accountId: string; identifier: string; limit: number }): Promise<FetchedPost[]> {
    const page = postsPage.parse(
      await uni(`/users/${encodeURIComponent(input.identifier)}/posts?account_id=${input.accountId}&limit=${input.limit}`),
    );
    return page.items.map((p, i) => ({
      id: p.id ?? p.social_id ?? `post-${i}`,
      text: p.text ?? "",
      postedAt: p.parsed_datetime ?? p.date ?? null,
      url: p.share_url ?? null,
    })).filter((p) => p.text.trim().length > 0);
  }

  async searchPeople(input: {
    accountId: string;
    keywords: string;
    networkDistance: Array<2 | 3>;
    locationIds?: number[];
    locationQuery?: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<{ items: SearchHit[]; cursor: string | null }> {
    const limit = Math.min(50, Math.max(10, input.limit ?? 50));
    const qs = new URLSearchParams({ account_id: input.accountId, limit: String(limit) });
    if (input.cursor) qs.set("cursor", input.cursor);

    const location = await this.resolveLocationIds(input.accountId, input.locationQuery);
    const attempts: Record<string, unknown>[] = [];
    if (location.length > 0) {
      attempts.push({
        api: "classic",
        category: "people",
        keywords: input.keywords,
        location,
      });
    }
    attempts.push({ api: "classic", category: "people", keywords: input.keywords });
    attempts.push({
      url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(input.keywords)}`,
    });

    let page = searchPage.parse({ items: [], cursor: null });
    let lastErr: unknown;
    for (const body of attempts) {
      try {
        page = searchPage.parse(await uni(`/linkedin/search?${qs}`, {
          method: "POST",
          body: JSON.stringify(body),
        }));
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) return { items: [], cursor: null };

    const want = new Set(input.networkDistance.map(String));
    const items: SearchHit[] = [];
    for (const r of page.items) {
      const dist = distanceOf(r.network_distance);
      if (dist === "1") continue;
      if (dist && !want.has(dist)) continue;
      const degree: "2" | "3" = dist === "3" ? "3" : "2";
      const fromParts = r.first_name || r.last_name
        ? { first: r.first_name || "(unknown)", last: r.last_name || "" }
        : splitName(r.name);
      const publicId = r.public_identifier
        ?? r.profile_url?.split("/in/")[1]?.split(/[/?#]/)[0]
        ?? r.public_profile_url?.split("/in/")[1]?.split(/[/?#]/)[0]
        ?? null;
      items.push({
        publicIdentifier: publicId,
        memberId: r.id ?? r.member_urn ?? null,
        firstName: fromParts.first,
        lastName: fromParts.last,
        headline: r.headline ?? null,
        location: r.location ?? null,
        profileUrl: r.profile_url ?? r.public_profile_url
          ?? (publicId ? `https://www.linkedin.com/in/${publicId}` : null),
        networkDistance: degree,
      });
    }
    return { items, cursor: page.cursor ?? null };
  }

  private async resolveLocationIds(accountId: string, query?: string): Promise<string[]> {
    if (!query) return [];
    const want = query.trim().toLowerCase();
    try {
      const qs = new URLSearchParams({
        account_id: accountId,
        type: "LOCATION",
        service: "CLASSIC",
        keywords: query,
        limit: "20",
      });
      const out = await uni<{ items?: { id?: string | number; title?: string }[] }>(
        `/linkedin/search/parameters?${qs}`,
      );
      const items = out.items ?? [];
      const scored = items
        .map((it) => {
          const title = (it.title ?? "").trim().toLowerCase();
          const id = it.id != null ? String(it.id) : "";
          if (!id || !title) return null;
          let rank = 99;
          if (title === want) rank = 0;
          else if (title.startsWith(want)) rank = 1;
          else if (title.includes(want)) rank = 2;
          else return null;
          return { id, rank };
        })
        .filter((x): x is { id: string; rank: number } => Boolean(x))
        .sort((a, b) => a.rank - b.rank);
      if (scored[0]) return [scored[0].id];
    } catch { /* keywords-only search is the fallback */ }
    return [];
  }
}
