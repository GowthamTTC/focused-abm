# Account Pulse — design note (not built)

**Status:** design only. Nothing in `src/` implements this yet.
**Worked example:** Allergan Aesthetics (an AbbVie BU), scanned 22 Sep 2026.

One question, asked of one account: *what has changed at this company lately, what
are the people around it actually saying, and which of our offers does that make
openable this month.* Today the product answers that for a **person** (Today /
`/dashboard`: a post, a hook, a message). It cannot answer it for an **account**.

---

## 1. What it is

A per-account panel — `/accounts/[key]/pulse` — with four bands:

| Band | Source | Already exists? |
|---|---|---|
| **News** | public web: newsroom, trade press, WARN filings, earnings | ❌ new |
| **Network voice** | posts by connections who work there | ✅ `posts/*`, `radar/scan.ts` |
| **Mentions** | posts by anyone in the network that *name* the account | ⚠️ extension of `radar/mentions.ts` |
| **Triggers** | LLM join of the three above against the org's offers | ❌ new prompt |

Only the first and last are genuinely new infrastructure. The middle two are the
existing post pipeline pointed at a company instead of a metro.

## 2. Two sentiment numbers, never one

Press releases are positive by construction. Averaging them with what employees
say produces a number that moves when the PR team is busy, which is worthless.
So the panel carries **two** scores and never a blended one:

- **Narrative** (−100…+100) — how the company is being written about.
- **Network** (−100…+100) — tone of posts by people who work there or name them.

Each is a mean over judged items with the same 30-day decay as `HOOK_SCORE_SQL`,
and each is printed with its denominator or not printed at all.

### The coverage line is not decoration

`/social` already refuses to show a feed without saying how much of the network
was actually checked. Pulse inherits that rule, harder:

> *12 people at this account are in your network · 4 checked in the last 30 days ·
> 9 posts read · Network score from 9 posts by 4 people.*

Below a floor (suggest: **6 judged posts from 3 distinct people**) the Network
score is suppressed entirely and the band reads "not enough read yet", with the
button that fixes it. A single bitter post from one laid-off director is not a
sentiment reading, and a number would make it look like one.

### Silence is a signal but it is not negative

At a restructuring account, volume collapses: people go quiet, or post job-search
content that is *about* them, not about the company. So Pulse reports **volume vs.
that account's own trailing baseline** as its own line, separate from tone. A
quiet account and a hostile account are different sales situations and must not
collapse into the same number.

## 3. Data model

One table. Everything else is derivable.

```ts
export const accountSignal = pgTable("account_signal", {
  id, orgId,
  companyKey: text().notNull(),          // shares companyKey() with radar/score.ts
  kind: text().notNull(),                // news | filing | post | mention
  sourceId: text().notNull(),            // URL or post.provider_id — dedupe key
  title, url, body, publishedAt,
  // judged pass
  sentiment: integer(),                  // -100..100, null until judged
  theme: text(),                         // restructuring | leadership | product | ...
  evidence: text(),                      // the quoted span the score rests on
  judgedAt,
}, uniqueIndex on (orgId, companyKey, sourceId));
```

Posts are *referenced*, not copied — `kind: "post"` rows carry the `post.id` in
`sourceId` so the existing judge verdict and hook stay the one source of truth.

## 4. New prompts (versioned, per the daily invariant)

- `prompts/account-signal/v1.md` — batch of items → `{sentiment, theme, evidence}`.
  Refuses to score an item that does not name the account; returns `null` instead
  of guessing. Same batch-of-25 + `cache_control` digest shape as `post-relevance`.
- `prompts/account-triggers/v1.md` — the whole signal set + the org's services
  digest + `sellerContext` + `voiceProfile` → ranked triggers, each with the
  offer it opens, the person to open with, and the line to open with.
  **Must be allowed to return "no credible trigger".**

## 5. Where news comes from

The repo has no outbound web fetch today, which is the one real build cost here.
Cheapest honest version, in order:

1. **Newsroom + PR feeds** — `news.abbvie.com`, PR Newswire tags. Free, RSS,
   high-precision, but 100% company-voice. Good for *events*, useless for *tone*.
2. **Trade press** — for this BU: Fierce Pharma, BioSpace, Dermatology Times,
   AmSpa, Aesthetics Biomedical. Where the tone actually lives.
3. **Filings** — earnings press releases and WARN notices. The restructuring
   ground truth, and the only source that is legally obliged to be specific.

A per-org allowlist of domains, stored as org settings, beats a general crawler:
the trade press for aesthetics is not the trade press for IT services.

## 6. What it cannot do

Stated here so it is not promised in a demo:

- **It is not LinkedIn-wide sentiment.** The seat sees 1st-degree connections
  (plus 2nd/3rd through event search). "LinkedIn sentiment for Allergan
  Aesthetics" means *the posts of the people you happen to know there*. Sales
  forgets this; the UI must not let them.
- **Company-page posts are not reachable** through the relations/posts endpoints
  the adapter uses. Brand-account voice is a news-band concern, not a post-band one.
- **Comments are not read.** Under a layoff post the comments carry the sentiment
  and the post carries none. This is the largest known blind spot.
- **Ex-employees drift.** `company_raw` is frozen at import. Someone laid off in
  July still reads as an employee, and their post is the most negative in the set.
  The existing `flag` / "appears to have left the company" machinery has to gate
  the network band or it will systematically over-report negativity at exactly
  the accounts this module is for.

## 7. Cost

Reuses the metered paths. News: ~10–30 items/account/month, one batched judge
call. Posts: already collected under the shared 100-people/day scan cap; the
sentiment pass is one extra field on a call the judge already makes. Triggers:
one `deepdive` call per account per refresh. **Budget: single-digit cents per
account per refresh** — the constraint is the LinkedIn scan cap, as always, not
tokens.

## 8. Acceptance

Same shape as `docs/ACCEPTANCE.md` — pick 3 accounts with a known story, run
Pulse blind, and score:

1. Did the news band surface the event a human would have led with?
2. Does the Network score's sign match a human read of the same posts?
3. Are the triggers **specific to this account**, or would they read the same for
   any company in the sector? (This is the one that fails.)
4. Does it say "not enough read yet" when it has not read enough?
