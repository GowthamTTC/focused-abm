# Acceptance — service-fit prompt versions vs. TTC Batch-1 ground truth

Run 2026-09-02 against `TTC-LinkedIn-ABM-Batch1-completed.xlsx`.
Reproduce with:

```bash
npx tsx scripts/eval-prompt-versions.ts v2 v3 v4  # LLM calls (~$0.25 per version)
npx tsx scripts/eval-foreign-catalog.ts v3 v4     # routing on a client's own catalog
npx tsx scripts/eval-rule-coverage.ts             # free
npx tsx scripts/eval-signal-precision.ts          # free
```

## The dataset

Sheet membership is the human bucket. There is no "excluded" sheet — those rows
never made the deliverable — so a prediction of `excluded` is scored as a
disagreement.

| Human bucket | People | Share |
|---|---|---|
| pitchable (Target Pool) | 4,502 | 95.8% |
| peer_competitor (Peers & Competitors) | 114 | 2.4% |
| off_icp (Review — off-ICP) | 85 | 1.8% |

Evaluated on 499 people: **all** 85 off-ICP, **all** 114 peers, and a
deterministic sample of 300 pitchable (seed 20260902). Model
`anthropic/claude-haiku-4.5`, reference catalog = TTC's live services.

Every person went **straight to the model** — the free rule pass was bypassed
so this measures the prompt, not the pipeline. Rule-pass coverage is measured
separately below and folded into the pipeline estimate.

## Bucket accuracy

Per class, on the evaluated sample:

| Human bucket | n | v2 | v3 |
|---|---|---|---|
| pitchable | 300 | 64.7% | **79.7%** |
| off_icp | 85 | **78.8%** | 58.8% |
| peer_competitor | 114 | 84.2% | 84.2% |
| *raw sample average* | 499 | 71.5% | 77.2% |

The raw average understates v3, because the sample deliberately
over-represents the two tiny classes where v3 is weaker. Weighted by the real
population shares above:

| | v2 | v3 |
|---|---|---|
| **Prompt only, population-weighted** | **65.4%** | **79.4%** |
| **Full pipeline (rules, then prompt)** | **64.1%** | **77.9%** |
| Service agreement | 80.9% | 81.2% |
| Slugs outside the catalog | 0 | 0 |

Against the Day 9 bars: service agreement passes for both (≥75%). Bucket
accuracy fails for both (≥85%) — but v3 is **14 points closer**.

### Where each one loses

v2's dominant failure is throwing away business: of 300 genuine prospects it
sent **75 to off-ICP** and 23 to peers — a quarter of the target pool
discarded. That is the single largest accuracy loss anywhere in the system.

v3's failure is the mirror and much cheaper: it leaks 23 of 85 off-ICP people
into the pitchable pool. A coach who reaches the target pool is a wasted
enrichment and an awkward draft. A CFO wrongly filed off-ICP is revenue that
never gets contacted.

Both agree on peers to the person — 96/114, identically.

## What the free rule pass already does

Run before the model, so it decides how much a prompt's weakness costs:

| Human bucket | caught by company signal | caught by title signal | falls through to model |
|---|---|---|---|
| pitchable (4,502) | 120 **wrong** | 10 **wrong** | 4,372 |
| off_icp (85) | 4 | **51 (60%)** | 30 |
| peers (114) | **76 (67%)** | 0 | 38 |

The rules resolve 60% of off-ICP for free, which is exactly v3's weak class —
so v3's leak matters less in production than the prompt-only number suggests.

They also **wrongly divert 130 genuine prospects (2.9%)**, 120 of them by the
competitor-company list. This is what fix 03 made configurable.

## Per-signal precision (the fix-03 tuning table)

"Correct" = fired on someone the human put in that bucket. "Wrongly dropped" =
fired on someone the human **kept** in the target pool.

### Competitor company signals — 39% precision overall

| Signal | Fires | Correct | Wrongly dropped | Precision |
|---|---|---|---|---|
| `design` | 33 | 0 | **33** | 0% |
| `media` | 49 | 19 | **30** | 39% |
| `studio` | 34 | 19 | 15 | 56% |
| `creative` | 20 | 6 | **14** | 30% |
| `marketing` | 25 | 13 | 12 | 52% |
| `agency` | 19 | 8 | **11** | 42% |
| `productions` | 4 | 0 | **4** | 0% |
| `digital marketing` | 6 | 5 | 1 | 83% |
| `advertis` | 4 | 4 | 0 | 100% |
| `branding` | 2 | 2 | 0 | 100% |
| **Total** | **196** | **76** | **120** | **39%** |

Never fire on this dataset: `agencies`, `films`, `adtech`, `event management`.

**This list currently costs more than it saves** — 120 prospects discarded to
catch 76 peers. Dropping `design` and `productions` alone recovers 37 prospects
and loses nothing: neither has ever matched a real peer.

### Off-target title signals — 82% precision

| Signal | Fires | Correct | Wrongly dropped | Precision |
|---|---|---|---|---|
| `coach` | 39 | 39 | 0 | 100% |
| `mentor` | 10 | 10 | 0 | 100% |
| `facilitator` | 6 | 0 | **6** | 0% |
| `personal brand` | 3 | 0 | **3** | 0% |
| `yoga` | 2 | 0 | **2** | 0% |
| `brand therapist` | 1 | 1 | 0 | 100% |
| `therapist` | 1 | 1 | 0 | 100% |
| **Total** | **62** | **51** | **11** | **82%** |

Never fire: `motivational`, `astrolog`, `numerolog`, `tarot`, `spiritual`.

Well tuned. Dropping `facilitator`, `personal brand` and `yoga` recovers 11
prospects and loses zero detections.

## v4 — built, measured, shipped

v4 is v3 with three surgical edits: peer detection defined relative to the
digest instead of naming marketing agencies, the fallback service taken from a
`(CATCH-ALL)` mark in the digest instead of the literal `gtm-office`, and a
rule that bucket and service are decided independently.

An earlier v4 draft rewrote far more of the prompt and measured **worse on
every class** — v3's terse, concrete wording turned out to be doing real work.
Then, before the independence rule was added, v4 was still losing 16 pitchable
people to off-ICP: without a named default service the model treated "no
service fits" as evidence the person did not belong in the pool. One sentence
fixed it. Both regressions were caught by measurement, not review.

### Bucket accuracy holds

| | v3 | v4 |
|---|---|---|
| pitchable (300) | 80.0% | 79.3% |
| off_icp (85) | 55.3% | 58.8% |
| peer_competitor (114) | 84.2% | 85.1% |
| **Population-weighted** | **79.7%** | **79.1%** |

Inside run-to-run noise — v3 alone measured 79.4 / 79.7 / 79.7 across three
runs, with off-ICP swinging 55.3–60.0%. v4 is better on two classes of three.

### Routing on a foreign catalog — the test this workbook cannot run

Adam's workspace sells executive coaching and leadership development: six
slugs, none of which any prompt was written around. Of the people each version
called pitchable, how many got a service that actually exists in his catalog?

| | v3 | v4 |
|---|---|---|
| Service from his catalog | 46.8% | **100%** |
| Invented a slug | **53.2%** | **0%** |

v3's inventions were `gtm-office` (41), `marketeroid` (13), `sales-enablement`
(10) — TTC's vocabulary, offered to a leadership-development firm. v4 spread
its picks across all six of his services, with 48% landing on the catch-all.

### A caveat on service agreement

v4 scores 40.8% service agreement against this workbook versus v3's 77.5%, and
that number should not be read as a regression. The workbook's service labels
were produced by exactly the hardcoded routing v3 still carries, so v3 agrees
with them by construction. v4 reads the live ICP descriptions instead — and
those have been rewritten since: the slug `cmo-office` is now named "GMO
Office", `gtm-office` is "GTM for Manufacturing". v4 routes to the catalog that
exists today; v3 routes to the one that generated these labels in 2026-08.

## Verdicts

**v3 beat v2 by 14 points** population-weighted, at equal service agreement.
v2's habit of filing a quarter of genuine prospects as off-target is the more
expensive error and the harder one to see, because the people it loses never
appear anywhere for anyone to review. v3's mirror error — leaking off-ICP into
the pool — is cheaper, visible, and 60% pre-empted by the free rule pass.

**v4 ships, based on v3.** It holds v3's bucket accuracy (79.1% vs 79.7%,
inside noise, better on two classes of three) and takes routing on a foreign
catalog from 46.8% valid to 100%. That is the whole point of the change: TTC's
own numbers stay put, and every other workspace stops being handed TTC's
vocabulary.

**Nothing here reaches the 85% bucket bar** — v4 included, at 79.1%. The
remaining gap is dominated by one error: roughly one pitchable person in five
is sent to off-ICP or peers. That is the next thing worth attacking, and it is
a prompt problem, not a catalog problem.

**Tighten the competitor list.** Per the table above — this is now a Settings
change, no code needed.

## Caveats

- Sampling error on 300 pitchable is roughly ±2.5 points at 95% confidence;
  the v2/v3 gap is far larger than that; the v3/v4 gap is INSIDE it, which is
  why the foreign-catalog test rather than this one decides between them.
- The pipeline estimate applies model accuracy measured on a full sample to the
  post-rules remainder. It is an estimate, not a measurement.
- "Provisional Service" in the workbook was itself metadata-matched, so service
  agreement measures consistency with the shipped deliverable, not an
  independent human judgment.
- Ground truth is one client's network, Indian B2B heavy. A workspace with a
  different shape may not behave like this.

---

# Run 2026-09-18 — rule lists tuned, v5→v9 measured, all four Day 9 bars scored

Reproduce with:

```bash
npx tsx scripts/eval-rule-coverage.ts                        # free
npx tsx scripts/eval-signal-precision.ts                     # free
MISSES=1 npx tsx scripts/eval-prompt-versions.ts v4 v8       # LLM calls (~$0.25 per version)
npx tsx scripts/eval-foreign-catalog.ts v4 v8                # routing on a client's own catalog
DRY=1 npx tsx scripts/eval-top30-overlap.ts                  # free rehearsal
CLASSIFY_PROMPT_VERSION=v8 npx tsx scripts/eval-top30-overlap.ts   # ~$2.30, the whole population
npx tsx scripts/eval-stage-b.ts                              # free, read-only
```

Two of these are new, because two of Day 9's four bars had never been measured:
`eval-top30-overlap.ts` (top-30 overlap, and bucket accuracy over the whole
population rather than a sample) and `eval-stage-b.ts` (the Stage B read).
`eval-prompt-versions.ts` gained `MISSES=1`, which prints the disagreements
themselves — every prompt below was written from that output rather than from
an opinion about the prompt.

## 1. The free win: five signals that had never once been right

The per-signal table in the 2026-09-02 run named five signals that fired on
real people and caught nobody. They are now out of the shipped defaults
(`src/modules/matching/rule-pass.ts`):

| dropped signal | fired | caught a real peer/off-ICP | prospects it discarded |
|---|---|---|---|
| `design` (company) | 33 | **0** | 33 |
| `productions` (company) | 4 | **0** | 4 |
| `facilitator` (title) | 6 | **0** | 6 |
| `personal brand` (title) | 3 | **0** | 3 |
| `yoga` (title) | 2 | **0** | 2 |

Measured before and after, on the same 4,701 people:

| | before | after |
|---|---|---|
| genuine prospects the rules wrongly divert | 130 / 4,502 (2.9%) | **83 / 4,502 (1.8%)** |
| …by the competitor-company list | 120 | 83 |
| …by the off-target-title list | 10 | **0** |
| competitor-list precision | 39% | **48%** |
| title-list precision | 82% | **100%** |
| off-ICP people the rules still catch free | 51 / 85 (60.0%) | 51 / 85 (60.0%) |
| peers the rules still catch free | 76 / 114 (66.7%) | 76 / 114 (66.7%) |

**47 prospects recovered, zero detections lost.** No model calls, no code beyond
two edited lists.

Three signals stay in place with their eyes open: `media` (39% precision),
`agency` (42%) and `creative` (30%). Dropping all three would recover 55 more
prospects and lose 33 real peer detections — that is a trade rather than a free
win, so it belongs to whoever owns the pipeline and stays a per-workspace
Settings edit, not a default.

> **This win does not reach the live TTC workspace on its own.** That workspace
> has SAVED signal lists (14 company, 12 title) in `settings_json`, and saved
> lists override the shipped defaults. Until someone opens Settings there and
> removes the five signals, that workspace keeps diverting the 47.

## 2. Bucket accuracy — five new prompt versions

Run-to-run noise on this sample is ±1–2 points per class — v4's pitchable
recall alone measured 76.3 / 77.3 / 76.7 / 76.3 across four runs — so every
DECISION below was made inside a single invocation, where the versions being
compared saw identical people and an identical digest. The table averages each
version across the runs it appeared in; each prompt file's header carries the
same-run pair it was judged on.

Population weights used throughout: pitchable 95.8%, peers 2.4%, off-ICP 1.8%.

| version | pitchable | off-ICP | peers | population-weighted | what it changed |
|---|---|---|---|---|---|
| v4 (was shipped) | 76.7% | 58.5% | 85.5% | 76.5% | — |
| v5 | 78.5% | 58.9% | 82.1% | 78.2% | excluded is a closed list; "cannot tell what the company sells" ⇒ not a peer |
| v6 | 71.3% | **82.4%** | 79.8% | 71.7% | + the ground truth's own two off-ICP reasons |
| v7 | 80.8% | 50.6% | 84.7% | 80.4% | v5's wins + the title-only off-ICP test |
| **v8 (now shipped)** | **81.5%** | 51.2% | 82.5% | **81.0%** | + "a company name IS usable metadata" |
| v9 | 82.3% | 50.6% | 74.6% | 81.5% | + "you are not the safety net for peers" |

**v8 ships.** v9 measures marginally higher weighted, but it buys 1.6 points of
pitchable recall by giving up 8.7 points of peer recall, and the weighted
average understates what that costs: a peer in the pool is a wasted enrichment
and an awkward draft to a competitor. v8 takes the same pitchable ground
without paying for it.

The interesting failure is **v6**, which is the only version that ever moved
off-ICP recall — 58.5% → 82.4%, by reading the off-ICP sheet's own `why flagged`
column, whose values are just two: `personal-brand/coach` (59 people) and
`B2C/media (off-ICP)` (24). It lost the run anyway. Pitchable is 95.8% of the
population, so one point of pitchable recall is worth fifty-three points of
off-ICP recall, and v6's B2C half pulled 57 prospects out of the pool to win 21
off-ICP people. That is v2's mistake with better intentions.

What the misses actually showed, and what each edit was for:

- **Employed coaches.** "Team Coach @ Airbus", "Business Coach @ a builders
  firm", "Professional Global Mentor @ Microsoft Learning" — v4's rule named the
  words coach/mentor/trainer with no mention of who employs them. Airbus buys
  services. The fix is that the TITLE is the test and the employer decides
  nothing: a coach-titled founder of a real academy is off-ICP, and the CEO of a
  training company is not.
- **Company names read as businesses.** The humans kept 97 people whose company
  reads like coaching — The Learners Guild, Manah Wellness, TVS Training and
  Services, Skills Connect — because a company selling training at scale has a
  marketing budget. Company name is not evidence about the person.
- **Excluded by invented grounds.** "Software Engineer @ Accenture", "UI
  Developer", "IT Help Desk" were excluded for "no buying authority", a
  criterion that appears nowhere in the rule. Excluded is a closed list; job
  level is never grounds; and a company name is usable metadata even when the
  position field is a person's name.

### Routing on a foreign catalog still holds

The test that decided v3 → v4, re-run for v8 on Adam's leadership-development
catalog (150 people, none of these prompts written near his vocabulary):

| | v4 | v8 |
|---|---|---|
| service from HIS catalog | 118/118 (100%) | **127/127 (100%)** |
| invented a slug | 0 | **0** |
| people it kept pitchable | 118 of 150 | 127 of 150 |

v8 keeps nine more of his people in the pool and still never invents a slug.

## 3. Bar 1 — bucket accuracy, measured on everyone

The 2026-09-02 numbers are prompt-only, on a 300-person sample of the target
pool, with the rule pass deliberately bypassed. `eval-top30-overlap.ts` runs the
REAL pipeline over all 4,701 people instead — tuned rules first, v8 for the
remainder, then `rankBatch` — in a throwaway local workspace carrying TTC's live
catalog and settings.

| ground truth | n | correct | where the rest went |
|---|---|---|---|
| pitchable | 4,502 | **80.5%** | excluded 337 · peers 279 · off-ICP 263 |
| off-ICP | 85 | **70.6%** | pitchable 10 · excluded 9 · peers 6 |
| peers & competitors | 114 | **89.5%** | pitchable 9 · excluded 2 · off-ICP 1 |
| **population** | **4,701** | **80.5%** | no sampling error — everyone was classified |

Nobody was left unclassified. Compare the documented pipeline estimates: v2 at
64.1% and v3 at 77.9%, both estimated by applying sampled model accuracy to the
post-rules remainder. **80.5% is measured, not estimated, and it is the highest
this system has scored.** It is still 4.5 points under the bar.

The two small classes do far better here than the prompt-only numbers suggest —
off-ICP 70.6% against v8's 51% prompt-only, peers 89.5% against 82% — because
the free rule pass resolves 60% of off-ICP and 67% of peers before the model is
asked anything. That is the whole reason the rule lists were worth tuning, and
the reason a prompt tuned to chase those two classes (v6) loses.

**Service agreement is 38.3%** (1,386 of 3,618 where both named a service) and
that number should not be read as a fail against the ≥75% bar. The workbook's
service labels were produced by exactly the hardcoded routing v3 carried, so v3
agrees with them by construction (77.5%) and every catalog-agnostic version
since scores near 40% — v4 measured 40.8% in the last run. The live catalog has
also been renamed and extended since 2026-08 (eight active services now, with
`cmo-office` named "GMO Office"). Against THIS workbook the metric no longer
measures routing quality; the foreign-catalog test above is what does.

## 4. Bar 2 — top-30 overlap: 6 of 30

| | |
|---|---|
| the tool's top 30 vs the human's 30 | **6 / 30 = 20.0%** |
| bar | ≥80% |

Not a classification failure — every one of the 24 people the tool missed is in
the pool, correctly pitchable. They are just ranked below the fold:

| human's pick | where the tool ranked them |
|---|---|
| #9 Head of Marketing, an IT-services firm | rank 49 |
| #11 VP & Head Corporate Comms | rank 83 |
| #6 VP Marketing, IT services | rank 90 |
| #19 VP Marketing | rank 107 |
| #1 AVP Marketing, GovTech | rank 316 |
| #5 GM Enterprise | rank 1,217 |

**The scorer never looks at the employer.** `scoreConnection` awards up to 40
points for a C-title, 12 for a marketing-ish word in the title, 30 for model
confidence — and exactly 5 for "this person has a company at all". Nothing in it
knows one company from another. So its top 30 is CMOs and Chief Growth Officers
wherever they work: a CMO at Colgate-Palmolive, at a construction firm, at an
architectural-products manufacturer. The human's 30 is almost entirely VP and
AVP-level marketing leaders at Indian IT-services and B2B software firms — the
title is mid-senior, the EMPLOYER is the qualification.

`RANK_ONLY=1` reproduces this exactly (6/30, 20.0%) with no model calls at all,
by handing the scorer the deliverable's own buckets and services: the ranking is
the entire gap, and it can now be iterated on for free.

**The repair is built, and shipped switched off.** The obvious version — a
company-term list rewarding "technologies / systems / solutions / labs" — would
be drawn from the same 30 rows it would then be scored against, which is how a
number gets flattering without the product getting better. So the component in
`rank.ts` uses the services' own `fit_signals` instead, tested against
everything already known about the employer. Which text carries the signal was
measured, not assumed, across 400 classified people:

| where the ICP's own language appears | share |
|---|---|
| the company name | 1.5% |
| the headline | 3.5% |
| **the classifier's own `why` sentence** | **54.8%** |

The model names the trade while explaining itself — "Chief Marketing Officer at
iPacket (B2B IT services)" — so the reasoning the pipeline already pays for is
where the employer lives.

`DEFAULT_ICP_FIT_BONUS` is **0**. The component is tested and inert: no
workspace's ranking moves until someone measures what moving it does. What is
missing is only the weight, and the recipe is one paid classify followed by a
free sweep:

```bash
KEEP=1 CLASSIFY_PROMPT_VERSION=v8 npx tsx scripts/eval-top30-overlap.ts   # ~$2.30, once
RERANK=1 ICP_FIT_BONUS=0  npx tsx scripts/eval-top30-overlap.ts           # baseline, free
RERANK=1 ICP_FIT_BONUS=14 npx tsx scripts/eval-top30-overlap.ts           # …and 10, 18, 25
```

Arithmetic bounds for whoever runs it: below 6 nothing changes, because a
C-title outscores a VP by exactly 6; past about 20, a manager at a fitting
employer starts outranking a CMO at one. A rule-pass hit writes a `why` about
the title rather than the employer, so those rows will not fire the test at all
— verified fit ranks above unverified, and that asymmetry is itself worth
measuring before the weight is set.

One measurement was attempted and abandoned: the run was interrupted, and then
the kept batch was destroyed by the harness's own re-rank path, which ran its
cleanup on a workspace it had only read. That flaw is fixed — reuse now implies
keep — but the number was not recovered, and this file does not carry one.



## 5. Bar 4 — Stage B "reads at the same standard"

`scripts/eval-stage-b.ts`, read-only. The standard is the workbook's 30
human-written rows; the comparison is the 88 people the tool has fully enriched
in production.

| | human (30 rows) | tool (88 drafts) |
|---|---|---|
| About summary | avg 51 words (35–64) | comparable, one paragraph |
| Outreach message | avg 78 words (46–95) | avg **91 words** |
| leaked a template seam or placeholder | 0 | **0** |
| opens on something that person actually said | yes, in every row read | yes, in every row read |
| never names the employer | — | 22 / 88 |
| never names the person | most rows (the humans rarely open with a name) | 24 / 88 |

Read side by side, the tool's drafts open the way the human's do — on the
person's own words. The human's #1 row opens "Your post about CSM going from
'not an AI company' to ringing the bell at BSE…"; the tool's drafts open "your
read on Workforce Pell's year-one numbers stopped me", "that Natalie post
stopped me mid-scroll. Six years, one frame, one hashtag", "noticed you're
hiring a sports marketing PM at Athelo". Same move, same specificity.

**Verdict: passes.** The drafts read at the standard and run about 17% longer
than the human's. The 22 that never name the employer are the weakest of them —
worth a prompt line if this is revisited, not a blocker.

One thing this section does NOT do is compare the two on the same person: none
of the human Top 30 has ever been enriched in production, so a same-person read
needs fresh Stage B runs. `ENRICH=N npx tsx scripts/eval-stage-b.ts` does
exactly that — it fetches N of those people's profiles and posts through the
live seat, paced like the worker, and prints human against tool field by field.
It is opt-in because it spends real seat requests on real people.

## Verdicts, 2026-09-18

| Day 9 bar | target | measured | verdict |
|---|---|---|---|
| Bucket accuracy | ≥85% | **80.5%**, whole population | **fails** — by 4.5 points, from 77.9% estimated |
| Service agreement | ≥75% | 38.3% | **not measurable against this workbook** (§3) |
| Top-30 overlap | ≥80% | **20.0%** | **fails** — and it is the ranker, not the matching (§4) |
| Stage B standard | "reads the same" | 0 seams, same opening move, 17% longer | **passes** |

**Not a green light for the mothership merge.** Two bars fail. The matching is
the closest it has ever been and the drafts are good enough to send; the ranked
list is not the list a human would hand over, and that is the honest blocker.

## What still stands between this and 85%

1. **The remaining loss is spread, not a pattern.** v8 loses about 18% of the
   target pool: roughly 7% to off-ICP, 6% to peers, 5% to excluded, and reading
   those rows there is no single repeated mistake left of the kind v5–v8 each
   removed. The next honest gain is more likely to come from the free rule pass
   (which decides 10% of the population and costs nothing) than from a ninth
   prompt.
2. **The ground truth is not self-consistent about B2C.** 24 of its 85 off-ICP
   calls are consumer brands and media properties — Sony Pictures Networks' own
   VP Marketing among them — while dozens of comparable consumer-facing
   businesses sit in the target pool. Any rule that gets those 24 right will
   take real prospects with it, which is exactly what v6 measured. Part of the
   gap to 85% is label noise, and no prompt can close that part.
3. **It is one client's network**, Indian B2B heavy, labelled in 2026-08 against
   a catalog that has since been renamed. The caveats from the first run all
   still apply.

## Operator actions this run implies

- **Set `CLASSIFY_PROMPT_VERSION=v8` wherever the app is deployed.** The code
  default is now v8, but the deploy environment sets this variable explicitly
  (it is in `.env` here), and an explicit value wins. Until it is changed,
  production keeps classifying with v4.
- **Re-save the signal lists in the TTC workspace's Settings**, dropping
  `design`, `productions`, `facilitator`, `personal brand` and `yoga`. The
  shipped defaults are fixed; that workspace's saved lists are not.
- Consider dropping `media`, `agency` and `creative` there too — worth 55 more
  prospects at the cost of 33 peer detections. That one is a judgement call, not
  a correction.
