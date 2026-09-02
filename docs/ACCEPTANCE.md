# Acceptance — service-fit prompt versions vs. TTC Batch-1 ground truth

Run 2026-09-02 against `TTC-LinkedIn-ABM-Batch1-completed.xlsx`.
Reproduce with:

```bash
npx tsx scripts/eval-prompt-versions.ts v2 v3   # LLM calls (~$0.50 on Haiku)
npx tsx scripts/eval-rule-coverage.ts           # free
npx tsx scripts/eval-signal-precision.ts        # free
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

## Verdicts

**Base v4 on v3.** It is 14 points better population-weighted, its service
agreement is equal, and its one weakness is the class the free rule pass
already handles 60% of. v2's habit of filing a quarter of genuine prospects as
off-target is the more expensive error and the harder one to see, because the
people it loses never appear anywhere for anyone to review.

**Neither reaches the 85% bucket bar**, so v4 should not be a rename of v3. The
gap is worth closing while the file is open.

**Tighten the competitor list.** Per the table above — this is now a Settings
change, no code needed.

## Caveats

- Sampling error on 300 pitchable is roughly ±2.5 points at 95% confidence;
  the v2/v3 gap is far larger than that, the absolute values less certain.
- The pipeline estimate applies model accuracy measured on a full sample to the
  post-rules remainder. It is an estimate, not a measurement.
- "Provisional Service" in the workbook was itself metadata-matched, so service
  agreement measures consistency with the shipped deliverable, not an
  independent human judgment.
- Ground truth is one client's network, Indian B2B heavy. A workspace with a
  different shape may not behave like this.
