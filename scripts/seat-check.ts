/**
 * Is this LinkedIn seat live, and can it actually read a profile?
 *
 *   SEAT=<unipile id> IDENTIFIER=<linkedin slug> npx tsx --env-file=.env scripts/seat-check.ts
 *
 * Status alone is not an answer: a seat can report "operational" and still come
 * back with nothing for a 3rd-degree profile, which is the difference between
 * research and a headline restated. So this asks for both.
 */
import { getChannelProvider } from "../src/providers/channel";

async function main() {
  const accountId = (process.env.SEAT ?? "").trim();
  if (!accountId) throw new Error("needs SEAT");
  const provider = getChannelProvider();

  const status = await provider.getAccountStatus(accountId).catch((e) => ({ error: String(e) }));
  const out: Record<string, unknown> = { provider: provider.name, accountId, status };

  const identifier = (process.env.IDENTIFIER ?? "").trim();
  if (identifier) {
    try {
      const p = await provider.fetchProfile({ accountId, identifier });
      out.profile = p
        ? { headline: p.headline, company: p.company, location: p.location, aboutChars: (p.about ?? "").length }
        : null;
    } catch (e) { out.profile = { error: String(e instanceof Error ? e.message : e) }; }
    try {
      const posts = await provider.fetchRecentPosts({ accountId, identifier, limit: 3 });
      out.posts = posts.map((x) => ({ postedAt: x.postedAt, chars: x.text.length }));
    } catch (e) { out.posts = { error: String(e instanceof Error ? e.message : e) }; }
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
