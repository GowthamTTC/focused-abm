/**
 * Pulse's one outbound fetch. Every news, filing or trade-press URL the
 * collector touches comes through here, so "what is this app allowed to talk
 * to" has a single answer in a single place.
 *
 * The allowlist is a parameter rather than a constant because it belongs to the
 * workspace, and it deliberately ships with no default. The trade press for
 * aesthetics is Fierce Pharma, BioSpace and Dermatology Times; the trade press
 * for IT services is none of those, and neither list is a starting point for
 * the other. A bundled default would be wrong for every seat but the one it was
 * written for, and wrong in the quiet way — the panel would fill with plausible
 * articles about somebody else's industry instead of sitting empty and asking
 * to be configured. So an empty list allows nothing, which is the honest
 * failure and the one a user can act on.
 */
import { env } from "@/lib/env";

/** The hostname, lowercased, or null when the string will not parse as a URL.
 *  This never throws: the caller is walking links harvested from feeds and
 *  pages it does not control, and one malformed href must cost that href
 *  rather than the run. */
export function hostOf(url: string): string | null {
  try {
    // A trailing root dot ("abbvie.com.") addresses the same host but matches
    // nothing by string comparison, so it is normalised here once instead of
    // being forgotten at each comparison below.
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
    return host || null;
  } catch {
    return null;
  }
}

/** True when the URL's host is an allowed domain or a subdomain of one, so
 *  that "abbvie.com" admits "news.abbvie.com".
 *
 *  The dot in the suffix test carries the whole guarantee and is not tidiness:
 *  "notabbvie.com".endsWith("abbvie.com") is true, so an allowlist written with
 *  endsWith alone extends a newsroom's trust to any look-alike domain somebody
 *  registers. Testing against "." + entry cannot do that, and the equality test
 *  beside it is what still admits the bare domain itself. */
export function isAllowed(url: string, domains: string[]): boolean {
  const host = hostOf(url);
  if (!host) return false;
  for (const raw of domains) {
    // Entries are typed by hand into org settings, so the shapes a person
    // reasonably writes — "*.abbvie.com", ".abbvie.com", "ABBVIE.com" — are
    // read as the domain they obviously mean rather than silently matching
    // nothing for the life of the workspace.
    const domain = raw.trim().toLowerCase().replace(/^\*?\./, "").replace(/\.$/, "");
    if (!domain) continue;
    if (host === domain || host.endsWith(`.${domain}`)) return true;
  }
  return false;
}

/** The body text, or null.
 *
 *  A disallowed URL is refused by returning null, not by throwing. The
 *  collector is walking dozens of URLs for one account, and one blocked or dead
 *  link must cost that link and nothing else; a throw here would only be
 *  wrapped in a per-URL try/catch at every call site, which is the same
 *  behaviour written twice. Refusals are therefore indistinguishable from
 *  failures to this function's caller by design — the decision about what is
 *  reachable was already made by the allowlist, above. */
export async function fetchAllowed(url: string, domains: string[]): Promise<string | null> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  // The only two schemes a news link can honestly have. file: and data: parse
  // perfectly well, and without this an allowlist miss on a crafted href would
  // become a local read rather than a refusal.
  if (target.protocol !== "http:" && target.protocol !== "https:") return null;
  if (!isAllowed(target.href, domains)) return null;

  // One retry, and only for failures that are plausibly transient. A 404 or a
  // 403 is an answer: asking again spends another timeout on a page that is not
  // coming, across every account in the run.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const abort = new AbortController();
    // The failure that actually bites a collector is a socket that accepts and
    // then says nothing, because no error is ever raised for it. Without this
    // the refresh stops rather than degrades.
    const timer = setTimeout(() => abort.abort(), env.PULSE_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(target.href, {
        signal: abort.signal,
        headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      });
      if (res.status >= 500) {
        if (attempt === 0) continue;
        return null;
      }
      if (!res.ok) return null;
      // Redirects are followed by default, and a newsroom link that lands on a
      // syndication partner has left the allowlist without anybody deciding it
      // should. Checking where the bytes came from, not only where we aimed,
      // is what keeps the list meaningful.
      if (res.url && !isAllowed(res.url, domains)) return null;
      return await res.text();
    } catch {
      // The timeout arrives here as an abort, alongside DNS and connection
      // errors. All of them are worth exactly one more attempt.
      if (attempt === 0) continue;
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
