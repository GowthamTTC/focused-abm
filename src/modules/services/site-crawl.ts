/**
 * Reads a prospect-facing website well enough for the LLM to name what the
 * company sells. Deliberately dependency-free: the repo has no HTML parser and
 * one page of marketing copy does not justify adding one — tags are stripped,
 * not parsed into a tree.
 */

export type CrawlErrorCode =
  | "invalid-url" | "private-host" | "timeout" | "unreachable"
  | "blocked" | "notfound" | "not-html" | "empty";

export class CrawlError extends Error {
  constructor(readonly code: CrawlErrorCode, message: string) {
    super(message);
    this.name = "CrawlError";
  }
}

const FETCH_TIMEOUT_MS = 12_000;
const MAX_HTML_CHARS = 500_000;
const MAX_PAGE_TEXT = 12_000;
const MAX_TOTAL_TEXT = 26_000;
const EXTRA_PAGES = 3;

/** Anything that resolves inside the network the app itself runs in. A URL box
 *  that will be fetched server-side is an SSRF hole otherwise. */
const PRIVATE_HOST =
  /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?fd)/i;

export function normalizeUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) throw new CrawlError("invalid-url", "no url given");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new CrawlError("invalid-url", `not a url: ${trimmed}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new CrawlError("invalid-url", `unsupported scheme ${url.protocol}`);
  if (!url.hostname.includes(".") || PRIVATE_HOST.test(url.hostname))
    throw new CrawlError("private-host", `refusing to fetch ${url.hostname}`);
  url.hash = "";
  return url;
}

async function getHtml(url: URL): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; FocusedABM/1.0; +setup-crawler)",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en",
      },
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError")
      throw new CrawlError("timeout", `${url.hostname} did not answer in time`);
    throw new CrawlError("unreachable", `could not reach ${url.hostname}`);
  }

  if (res.status === 404 || res.status === 410)
    throw new CrawlError("notfound", `${url.pathname} does not exist`);
  if (res.status === 401 || res.status === 403 || res.status === 429 || res.status === 451)
    throw new CrawlError("blocked", `${url.hostname} refused an automated read (${res.status})`);
  if (!res.ok) throw new CrawlError("unreachable", `${url.hostname} returned ${res.status}`);

  const type = res.headers.get("content-type") ?? "";
  if (type && !/text\/html|application\/xhtml|text\/plain/i.test(type))
    throw new CrawlError("not-html", `${url.pathname} is ${type.split(";")[0]}, not a web page`);

  return (await res.text()).slice(0, MAX_HTML_CHARS);
}

const STRIPPED = /<(script|style|noscript|svg|template|iframe|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

const ENTITIES: [RegExp, string][] = [
  [/&nbsp;/gi, " "], [/&amp;/gi, "&"], [/&lt;/gi, "<"], [/&gt;/gi, ">"],
  [/&quot;/gi, '"'], [/&#0?39;|&apos;|&rsquo;|&lsquo;/gi, "'"],
  [/&ldquo;|&rdquo;/gi, '"'], [/&mdash;/gi, "—"], [/&ndash;/gi, "–"],
];

export function htmlToText(html: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, " ").replace(STRIPPED, " ");
  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|section|article|tr|td|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  for (const [re, sub] of ENTITIES) s = s.replace(re, sub);
  s = s.replace(/&#(\d+);/g, (_, d) => {
    const n = Number(d);
    return n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : " ";
  });
  return s
    .replace(/[ \t\u00a0\u200b]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function metaBits(html: string): string[] {
  const out: string[] = [];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) out.push(`TITLE: ${htmlToText(title[1])}`);
  const desc = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
  ) ?? html.match(
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
  );
  if (desc) out.push(`DESCRIPTION: ${htmlToText(desc[1])}`);
  return out;
}

const RELEVANT_PATH =
  /solution|service|product|offering|what-we-do|whatwedo|capabilit|expertise|practice|industr|use-case|usecase|platform/i;
const SKIP_PATH = /\.(pdf|jpe?g|png|gif|svg|webp|zip|mp4|css|js|xml|ico)(\?|$)|^mailto:|^tel:/i;

/** Same-site pages a services page is most likely to live behind. Ranked by
 *  how directly the link names an offering, so a 3-page budget spends itself
 *  on "/services" before "/industries". */
export function relevantLinks(html: string, base: URL, max = EXTRA_PAGES): URL[] {
  const scored = new Map<string, { url: URL; score: number }>();
  const anchors = html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
  for (const [, href, inner] of anchors) {
    if (SKIP_PATH.test(href)) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.hostname !== base.hostname) continue;
    if (url.protocol !== base.protocol) continue;
    url.hash = "";
    url.search = "";
    if (url.pathname === base.pathname || url.pathname === "/") continue;
    const text = htmlToText(inner).toLowerCase();
    const pathHit = RELEVANT_PATH.test(url.pathname);
    const textHit = RELEVANT_PATH.test(text);
    if (!pathHit && !textHit) continue;
    const depth = url.pathname.split("/").filter(Boolean).length;
    const score = (pathHit ? 2 : 0) + (textHit ? 1 : 0) - depth * 0.1;
    const seen = scored.get(url.pathname);
    if (!seen || seen.score < score) scored.set(url.pathname, { url, score });
  }
  return [...scored.values()].sort((a, b) => b.score - a.score).slice(0, max).map((x) => x.url);
}

export interface SiteRead {
  /** URLs actually read, first one being the URL the user gave. */
  pages: string[];
  text: string;
}

/** Fetch the given page, then a couple of obviously-relevant same-site pages.
 *  Only the first fetch can fail the whole read — a broken "/services" link is
 *  not a reason to send the user back to the URL box. */
export async function readSite(rawUrl: string): Promise<SiteRead> {
  const root = normalizeUrl(rawUrl);
  const html = await getHtml(root);

  const blocks: string[] = [];
  const push = (url: URL, pageHtml: string) => {
    const body = htmlToText(pageHtml).slice(0, MAX_PAGE_TEXT);
    if (body.length < 40) return false;
    blocks.push([`--- PAGE: ${url.toString()}`, ...metaBits(pageHtml), body].join("\n"));
    return true;
  };

  const pages: string[] = [];
  if (push(root, html)) pages.push(root.toString());
  else throw new CrawlError("empty", `${root.hostname} served a page with no readable text`);

  for (const link of relevantLinks(html, root)) {
    if (blocks.join("\n").length >= MAX_TOTAL_TEXT) break;
    try {
      const extra = await getHtml(link);
      if (push(link, extra)) pages.push(link.toString());
    } catch {
      // A secondary page that 403s or times out is noise, not a failure.
    }
  }

  return { pages, text: blocks.join("\n\n").slice(0, MAX_TOTAL_TEXT) };
}
