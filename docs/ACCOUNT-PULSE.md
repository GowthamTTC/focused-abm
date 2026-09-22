# Account Pulse — design note (not built)

**Status:** design only. Nothing in `src/` implements this yet.
**Worked example:** the **Ariel Group** seat (leadership development, executive
coaching, presence & storytelling — buyers are HR/Talent/L&D) opening
**Allergan Aesthetics**, an AbbVie BU in restructuring. Scanned 22 Sep 2026.

One question, asked of one account: *what has changed at this company lately, what
are the people around it actually saying, and which of our offers does that make
openable this month.* Today the product answers that for a **person** (Today /
`/dashboard`: a post, a hook, a message). It cannot answer it for an **account**.

## 0. Scope — account level, and nothing below it

**Pulse outputs facts about a company. It never outputs a person, a rank or a
message.** That is the whole boundary, and it is deliberate rather than a first
increment to be grown out of.

Out of scope, explicitly: naming who to contact, ordering people within the
account, drafting an opener, anything touching `voiceProfile` or the
`outreach-message` prompt. The product already does person-level work well and
does it on `/dashboard`; a second surface guessing at the same thing in a
different way is how the two start disagreeing in front of a client.

Three things fall out of that boundary, all good:

- **The ranking hazard disappears.** §5b's trap — `DEFAULT_FUNCTION_TERMS` being
  marketing words on a seat whose buyer is the CLO — only bites something that
  ranks people. Pulse doesn't, so it cannot inherit the bug.
- **No prompt needs the voice profile or the person's posts**, so the trigger
  call is one `deepdive` per account rather than one per person.
- **The Network band becomes a number, not a feed.** It contributes account
  sentiment and coverage; it never lists individuals. Which also makes the
  Social gate in §5a a much smaller loss for the seat it applies to.

When a trigger lands and someone asks "so who do I call", the answer is the
account's existing people list on `/accounts/[key]`, unchanged. Pulse says the
account is open; the roll-up that already exists says who is in it.

---

## 1. What it is

A panel on the existing account page — `/accounts/[key]`, not a new route — with
five bands. Every one of them is a statement about the company:

| Band | Output | Source | Already exists? |
|---|---|---|---|
| **News** | dated events | newsroom, trade press, WARN filings, earnings | ❌ new |
| **Narrative** | one score + N | the news band, judged | ❌ new prompt |
| **Network** | one score + coverage | posts by connections who work there | ✅ `posts/*`, `radar/scan.ts` |
| **Competitors** | which peers are visible there | peer-name mentions | ⚠️ extension of `radar/mentions.ts` |
| **Triggers** | theme → which offer it opens | LLM join of the above against the org's offers | ❌ new prompt |

Only News, and the two prompts, are genuinely new infrastructure. Network and
Competitors are the existing post pipeline pointed at a company instead of a
metro.

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
  digest + `sellerContext` → ranked triggers, each being *a theme at this company*
  and *the offer it opens*. No person, no opener — see §0. **Must be allowed to
  return "no credible trigger"**, and on most accounts most months it should.

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

## 5a. Seat gating — decide this before writing code

`src/lib/feature-access.ts` switches **Nova and Social off for the Ariel seat**.
Social is the unfiltered 1st-degree post feed; Pulse's Network band is that same
data, rolled up by employer. So Pulse cannot ship without answering: does the
Network band inherit `socialHidden`?

The recommendation is **yes, and Pulse still ships for that seat** — News,
Competitor presence and Triggers stand on their own, and a seat that has decided
it does not want a post feed has not thereby decided it does not want to know its
target account is being restructured. Give the band the same honest empty state
the coverage line already uses, naming *why* it is empty. Do not silently drop
the band: a missing band reads as "nothing happening", which is the one thing it
must never mean.

Follow the file's existing convention — a separate exported predicate
(`pulseNetworkHidden`) delegating to `arielSeat`, not a shared `isHiddenSeat` at
the call site, so the three features can diverge with an edit rather than a
rewrite.

## 5b. Competitor presence is a band, not a footnote

For a leadership-development seat, "who else is already selling into this
account" is first-class intelligence, not colour. `scripts/propose-signals.ts`
already carries the peer list — Korn Ferry, CCL, FranklinCovey, DDI, Dale
Carnegie, Blanchard, Crucial Learning, BetterUp, RHR, Heidrick — and
`PEER_COMPANY_SIGNALS` runs before title matching in the rule pass.

A mention-scan for *peer name + account name in the same post* is the same query
shape as the account mention-scan, over a list the workspace already maintains.
It answers "are we walking into an incumbent" before the first call, which no
other screen in the product can.

### Hazard avoided, recorded so it is not reintroduced

An earlier draft had the Triggers band name *who to open with*, which means it
ranks — and `rank.ts` line 21 documents the trap on this exact workspace:
`DEFAULT_FUNCTION_TERMS` are Toss the Coin's marketing words, and **only 8 of the
top 50 held an HR/Talent/L&D title while 180 such people sat in the pool**.

§0 removes the exposure by keeping Pulse above the person level. If anyone later
proposes naming a contact here, that override is the precondition, not a detail.

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

## 7. Cost — yes, it spends on OpenRouter

Everything goes through `complete()` in `src/llm/client.ts`, so every judged item
is billable. At account-level scope it is **two calls per account per refresh**:

| Call | Stage | Model (`.env.example`) | Rate in/out per MTok |
|---|---|---|---|
| `account-signal` | `classify` | `anthropic/claude-haiku-4.5` | $1 / $5 |
| `account-triggers` | `deepdive` | `anthropic/claude-sonnet-4.6` | $3 / $15 |

Worked, for an account with ~30 signals in the window:

- Signal judge — ~10K in, ~1.5K out on Haiku → **~$0.02**
- Triggers — ~12K in, ~1.5K out on Sonnet → **~$0.06**

**≈ $0.08 per account per refresh.** Twenty shortlisted accounts refreshed weekly
is **under $7/month**. (Anthropic list rates; OpenRouter passes these through with
a margin on credit, so treat the figures as a floor.)

Two things keep it there, and both are worth protecting:

- **The services digest is `cache_control`-cached** on the signal call, exactly as
  `judgePosts` already caches it. Cache reads bill at roughly a tenth of input, so
  the digest is near-free after the first call of a run — *provided* nothing
  volatile is prepended to it. A timestamp in that prefix silently multiplies the
  bill and nothing in the UI would show it. Verify with
  `usage.cache_read_input_tokens`.
- **The Network band adds no calls at all.** Sentiment becomes one more field on
  `post-relevance`, which already runs over these posts. Posts are still collected
  under the shared 100-people/day scan cap; that cap, not tokens, remains the
  binding constraint.

**The one real bill is the migration, not the steady state.** Adding a field to
`post-relevance` means a new prompt version, and a version bump means
`clearVerdicts()` re-judges *every stored post in the workspace* at 25 posts per
Haiku call. That is a one-off proportional to the post table, not to accounts, and
it should be a deliberate decision rather than a side effect of shipping Pulse.

News *fetching* costs nothing here — it is HTTP. It only acquires a bill if the
allowlist is ever swapped for a paid search API.

## 8. Acceptance

Same shape as `docs/ACCEPTANCE.md` — pick 3 accounts with a known story, run
Pulse blind, and score:

1. Did the news band surface the event a human would have led with?
2. Does the Network score's sign match a human read of the same posts?
3. Are the triggers **specific to this account**, or would they read the same for
   any company in the sector? (This is the one that fails.) For a
   leadership-development seat the failure mode is concrete: "they had layoffs,
   so they need change-communication training" is true of every restructuring
   company on earth and is not a trigger.
5. Did anything person-shaped leak into the output? A name, an ordering, a
   drafted line — any of them means §0 was breached and the surface has started
   duplicating `/dashboard`.
4. Does it say "not enough read yet" when it has not read enough?
