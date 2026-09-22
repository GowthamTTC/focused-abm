/**
 * The Pulse logic that needs no database.
 *
 * verify-hook-feed-checks.ts builds a fixture and therefore needs Postgres,
 * which means the checks that matter most here — an allowlist that must not be
 * fooled by a look-alike domain, and the null-is-not-zero rule the whole
 * sentiment design rests on — could only be run on a machine with a database.
 * These are pure functions, so they are separated out and run anywhere:
 *
 *   DATABASE_URL=postgresql://u:p@localhost:5432/x \
 *   SESSION_SECRET=0123456789012345678901234567890123 \
 *   OPENROUTER_API_KEY=sk-or-xxxxxxxxxx \
 *     npx tsx scripts/verify-pulse-pure.ts
 *
 * The env vars are only there because env.ts validates at import time; nothing
 * here opens a connection or spends a token.
 */
import { readFileSync } from "node:fs";
import { hostOf, isAllowed } from "../src/modules/pulse/fetch";
import { meanSentiment, NETWORK_MIN_PEOPLE, NETWORK_MIN_POSTS } from "../src/modules/pulse/types";
import { coerce } from "../src/modules/posts/judge";

let n = 0, bad = 0;
function ok(label: string, cond: boolean, detail?: string) {
  n += 1;
  if (cond) console.log(`ok   ${String(n).padStart(2)} · ${label}`);
  else { bad += 1; console.log(`FAIL ${String(n).padStart(2)} · ${label}${detail ? ` — ${detail}` : ""}`); }
}

// ── The allowlist. This is the security-shaped one: everything Pulse fetches
//    passes through it, and the endsWith trap below is a real way to hand a
//    newsroom's trust to whoever registers the look-alike. ──
const D = ["abbvie.com", "fiercepharma.com"];
ok("a subdomain of an allowed domain is allowed", isAllowed("https://news.abbvie.com/x", D));
ok("the bare allowed domain is allowed", isAllowed("https://abbvie.com/x", D));
ok("a look-alike domain is REFUSED", !isAllowed("https://notabbvie.com/x", D));
ok("a suffix-attack domain is REFUSED", !isAllowed("https://abbvie.com.evil.co/x", D));
ok("an empty allowlist allows nothing", !isAllowed("https://abbvie.com", []));
ok("an unparseable url is not allowed", !isAllowed("not a url", D));
ok("a non-http scheme is not allowed", !isAllowed("file:///etc/passwd", D));
ok("hostOf lowercases", hostOf("https://NEWS.AbbVie.com/x") === "news.abbvie.com");
ok("hostOf returns null on junk rather than throwing", hostOf("::::") === null);

// ── Null is not zero. §2 of docs/ACCOUNT-PULSE.md makes this a correctness
//    rule: a panel that has read nothing must not show a confident zero. ──
const none = meanSentiment([]);
ok("no items scores null, not 0", none.score === null && none.n === 0);
const allNull = meanSentiment([{ sentiment: null, at: null }, { sentiment: null, at: null }]);
ok("all-null scores null, not 0", allNull.score === null && allNull.n === 0);
const mixed = meanSentiment([
  { sentiment: -80, at: new Date() },
  { sentiment: null, at: new Date() },
]);
ok("a null is skipped, never averaged in as 0",
  mixed.score !== null && mixed.score < -50, `got ${mixed.score}`);
ok("n counts only the items that actually scored", mixed.n === 1, `n=${mixed.n}`);
const genuineZero = meanSentiment([{ sentiment: 0, at: new Date() }]);
ok("a genuine 0 IS counted", genuineZero.score === 0 && genuineZero.n === 1);

// Decay may weaken a score but must never invert it, and must never let a
// future-dated item outrank the scale — the bug HOOK_SCORE_SQL already had.
const fresh = meanSentiment([{ sentiment: 100, at: new Date() }]);
const old = meanSentiment([{ sentiment: 100, at: new Date(Date.now() - 29 * 86400000) }]);
ok("decay never flips the sign", fresh.score! > 0 && old.score! > 0);
ok("a fresh item cannot exceed the scale", fresh.score! <= 100);
const future = meanSentiment([{ sentiment: 100, at: new Date(Date.now() + 5 * 86400000) }]);
ok("a future-dated item cannot exceed the scale", future.score! <= 100, `got ${future.score}`);

// ── Sentiment must NOT inherit the relevance rules. Someone announcing they
//    were laid off is a "personal" post scoring 0 for this workspace, and is
//    the most informative thing the Network band will read all month. ──
const laidOff = coerce("personal", 0, null, -90);
ok("sentiment survives a category that scores 0 relevance",
  laidOff.relevance === 0 && laidOff.sentiment === -90);
ok("a missing sentiment is null, not 0", coerce("substantive", 70, "hook").sentiment === null);
ok("sentiment is clamped to the scale", coerce("substantive", 70, "h", -500).sentiment === -100);

// ── v2 must not have moved anything v1 decided. ──
ok("a non-substantive post still scores 0 relevance", coerce("congrats", 90, "x").relevance === 0);
ok("the hook floor is unchanged below the edge", coerce("substantive", 24, "x").hook === null);
ok("the hook floor admits its own edge", coerce("substantive", 25, "x").hook === "x");
ok("the network floors are real floors", NETWORK_MIN_POSTS > 1 && NETWORK_MIN_PEOPLE > 1);

// ── post-relevance v2 must not have moved anything v1 decided ──
//    v2 is what loads by default. RELEVANCE_BANDS quotes that prompt's wording
//    back to the user to explain a score, and HOOK_MIN_RELEVANCE is pinned to
//    the edges it states — so a well-meaning retune inside the prompt changes
//    what Today shows with nothing in the diff to say so. The two files are
//    compared rather than trusted.
{
  const read = (v: string) => readFileSync(`${process.cwd()}/prompts/post-relevance/${v}.md`, "utf8");
  const v1 = read("v1"), v2 = read("v2");
  // The RELEVANCE block only: from that heading to the next one. Everything
  // else is free to differ, which is how v2 adds a field at all.
  const bands = (t: string) => t.split(/^RELEVANCE/m)[1]?.split(/^HOOK/m)[0]?.trim() ?? "";
  ok("v1 has a relevance block to compare against", bands(v1).length > 0);
  ok("v2 keeps v1's relevance bands verbatim", bands(v1) === bands(v2),
    "the bands drifted between versions");
  ok("v2 asks for sentiment and v1 does not",
    /sentiment/i.test(v2) && !/sentiment/i.test(v1));
  for (const edge of ["80", "55", "25"]) {
    ok(`v2 still states the ${edge} band edge`, bands(v2).includes(edge));
  }
  ok("v2 tells the model sentiment is independent of relevance",
    /independent of relevance/i.test(v2));
  ok("v2 states the null-is-not-zero rule", /null, NOT 0|null, not 0/i.test(v2));
}

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad === 0 ? 0 : 1);
