# Focused ABM — Implementation Guide (Day 1 → Day 9)

Standalone product: LinkedIn 1st-degree connections → service-fit classification →
ranked target pool → Top-N deep enrichment → five-tab workbook (the TTC Batch-1 format).
Built merge-ready: `org_id` everywhere, logic in `src/modules/`, prompts versioned in
`/prompts`, Unipile behind a `ChannelProvider` interface with a mock.

**Golden rule for the whole build:** the mock provider means every feature is built and
demoed with ZERO external keys. Real keys are pasted in exactly twice (Day 1: OpenRouter,
Day 4: Unipile) and nothing else changes.

---

## Day 1 — Signups, repo, deploy pipeline

Goal: "hello world" running on Railway with Postgres attached, before any feature exists.

1. **Signups (15 min):**
   - GitHub — create empty private repo `focused-abm`.
   - Railway (railway.app) — sign in with GitHub.
   - You already have the OpenRouter key. **Do NOT start the Unipile trial yet** (Day 4 —
     the 7 free days should cover integration + your first real run).
2. **Local bootstrap:**
   ```bash
   node -v                 # must be 22.x (nvm install 22)
   cd focused-abm
   npm install
   cp .env.example .env    # fill: SESSION_SECRET (openssl rand -base64 32),
                           # ADMIN_EMAIL, ADMIN_PASSWORD, OPENROUTER_API_KEY
   ```
3. **Local Postgres** (either): `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=focused_abm postgres:16`
   → `DATABASE_URL=postgresql://postgres:dev@localhost:5432/focused_abm`
4. **First run:**
   ```bash
   npm run db:generate     # emits SQL into /drizzle from src/db/schema.ts
   npm run db:migrate
   npm run seed            # org + admin user + six TTC services
   npm run dev             # http://localhost:3000 → login with ADMIN_EMAIL
   ```
5. **Railway:** New Project → Deploy from GitHub repo → add **Postgres** plugin.
   - Service 1 (web): build `npm run build`, start `npm run start`.
   - Service 2 (worker): same repo, start `npm run worker`.
   - Set env vars on BOTH services (`DATABASE_URL` comes from the plugin reference).
   - Run `npm run db:migrate && npm run seed` once via Railway shell.
6. ✅ **Accept:** you can log in on the Railway URL.

## Day 2 — Schema walkthrough + Services screen

Goal: know the data model cold; ICPs editable.

1. Read `src/db/schema.ts` top to bottom — `connection` is the spine
   (raw fields → Stage A fields → Stage B amber fields).
2. Open **Services**: the six TTC solutions from `src/modules/services/seed-data.ts`
   (v2 — derived from the Batch-1 ground truth: GTM Office is the deliberate
   catch-all at ~56%). Peer detection is company-name-driven and off-ICP is
   coach-title-driven; both run as pre-signals in `src/modules/matching/rule-pass.ts`
   (`PEER_COMPANY_SIGNALS`, `OFF_ICP_TITLE_SIGNALS`) BEFORE title matching.
   Edit one ICP in the JSON editor, save, confirm it persists. These
   `title_include` patterns are what make the free rule-pass strong — invest here:
   every pattern you add removes people from the paid LLM pass.
3. Open **Settings → Enrichment guardrail** and pick your per-run cap
   (5 / 10 / 15 / 25 / 50 / Full list — ships at 10). This is the spend brake:
   it clamps both "Select top N" and the enrichment job server-side. Keep it at
   10 until Day 7's first supervised run; "Full list" is for the endgame only.
4. Optional polish: replace the JSON textarea with a form UI (see the Claude Design
   prompt, Screen 3) — functionality is already complete without it.
4. ✅ **Accept:** ICP edits persist; seed is idempotent (`npm run seed` twice = no dupes).

## Day 3 — Import paths (mock sync + real CSV)

Goal: both entry paths produce identical `connection` rows.

1. **Settings → Connect LinkedIn** (mock mode): instantly creates the mock seat.
2. **Connections → Sync connections**: pulls 120 synthetic relations → batch page.
3. **Connections → Upload Connections.csv**: use the real export
   (LinkedIn → Settings → Data privacy → Get a copy of your data → Connections).
   The parser (`src/modules/connections/import-csv.ts`) skips the "Notes:" preamble
   and reports per-row errors. Verify the row count matches the file (~4,990).
4. Inspect: `select company_raw, position_raw from connection limit 20;`
5. ✅ **Accept:** a 4,990-row CSV imports in seconds; synced batch shows headline-split
   position/company.

## Day 4 — Unipile goes live

Goal: real LinkedIn connected; relations sync works on the real account.

1. Start the **Unipile 7-day trial** (no card) → dashboard → copy `UNIPILE_API_KEY`
   and your DSN (`api###.unipile.com:####`) into `.env` (and Railway).
2. **Verify endpoint shapes** against your dashboard's live API docs — the adapter
   (`src/providers/channel/unipile.ts`) uses defensive `.passthrough()` schemas, but
   confirm: hosted auth link body, `GET /users/relations`, `GET /users/{id}`,
   `GET /users/{id}/posts`. Adjust field mapping if their names drifted.
3. **Local webhook:** `ngrok http 3000` → set `APP_URL` to the ngrok URL (hosted-auth
   `notify_url` must be public). On Railway this is automatic.
4. Settings → Connect LinkedIn → complete Unipile's hosted flow → webhook fires →
   the seat appears "operational".
5. Sync connections on the real account. One paginated pass — low risk. Expect the
   synced batch to be headline-based; the CSV batch has cleaner Company/Position
   columns. **Use the CSV batch for the acceptance run; sync is the convenience path.**
6. ✅ **Accept:** real seat operational; real relations land in a batch.

## Day 5 — Stage A: classification

Goal: the full pool classified into four buckets with service + why.

1. On the CSV batch → **Run matching**. The worker picks it up:
   rule pass first (free — blanks, own-company, pattern hits), then Claude
   (`LLM_MODEL_CLASSIFY`, batches of 25, services digest cached via `cache_control`).
2. Watch progress on the batch page (auto-refreshes). ~5k rows ≈ 150–200 LLM calls
   ≈ a few dollars on Haiku.
3. Review each bucket tab. Miscategorized people = fix the SOURCE, not the row:
   - wrong bucket rules → edit `prompts/service-fit/v1.md` → save as **v2**, bump the
     version in `service-fit.ts`;
   - wrong service pick → sharpen that service's `fit_signals`/`title_include` in the
     Services screen; then press **Reclassify all** (Run matching only continues on unclassified rows; Reclassify all deliberately overwrites every verdict).
4. ✅ **Accept:** bucket distribution roughly resembles the TTC ground truth
   (~90% pitchable, small off-ICP and peers piles, ~5% excluded).

## Day 6 — Ranking + Top-N selection

Goal: a defensible ranked pool; a selected batch.

1. Ranking runs automatically after classification (`src/modules/scoring/rank.ts`):
   seniority + function fit + confidence + founder bonus + company-present →
   score → T1/T2/T3 → dense rank. The breakdown JSON is on each row (hover "Why").
2. Sanity-check the top 50 by eye against the TTC "Target Pool (ranked)" tab.
   Tune the weight table in `rank.ts` if seniority bands feel off — it's 20 lines.
3. **Select top N** (default 30) → rows highlight amber → they're queued.
4. ✅ **Accept:** top-30 overlap with the human Top 30 is meaningful (aim ≥ 60% now;
   ≥ 80% after Day 5/6 tuning loops).

## Day 7 — Stage B: deep enrichment

Goal: the amber columns filled for the batch, respectfully paced.

1. Raise the guardrail in Settings to 25 or 50 for the real batch (it shipped at
   10 for safety). Then **Deep enrich queued** → the worker processes one person at a time:
   profile + posts through the real seat → `connection-deep-dive` prompt →
   `outreach-message` prompt. Pacing: `DEEP_ENRICH_MIN_GAP_SECONDS` (25s + jitter)
   and `DEEP_ENRICH_DAILY_CAP` (80). 30 people ≈ 25–40 min. **Do not raise the caps
   on a fresh Unipile seat.**
2. Failures are per-row (`enrich_status=failed` + error) — the job continues. Re-queue
   failures by re-running Select top N + Deep enrich (done rows are skipped).
3. Read every enriched row against the TTC file's standards: inferred pains are
   MARKED, corrections carry reasons, FLAGs appear for peers/left-company/off-ICP,
   messages open with the person's reality. Fix at the prompt level (new versions).
4. ✅ **Accept:** ≥ 27/30 rows complete; the three realities visibly honored.

## Day 8 — Export + polish loop

Goal: the workbook, indistinguishable in structure from the TTC file.

1. **Export .xlsx** → five tabs: Instructions (generated stats), Top N (grey Stage A /
   amber Stage B columns), Target Pool (ranked), Review — off-ICP, Peers & Competitors.
   FLAGs are folded into the "Service to Pitch" cell ("… · FLAG — appears to have left
   the company") so they can't be missed. Ticking **Ops tab** on export adds a sixth
   internal-only diagnostics sheet (bucket, score breakdown, confidence, rule/model
   provenance, enrichment status/errors, flags) — leave it OFF for client-facing files.
2. Open next to `TTC-LinkedIn-ABM-Batch1-completed.xlsx` — same headers, same shape.
3. Spend the rest of the day on the biggest quality gap you saw on Day 7 — one prompt
   version bump beats ten code tweaks.
4. ✅ **Accept:** a stakeholder can use the exported workbook with zero explanation.

## Day 9 — Acceptance test vs. ground truth

Goal: an objective go/no-go for the merge.

The TTC workbook is a labeled dataset. Export **with the Ops tab ticked** — the
diagnostics sheet turns this whole comparison into a few VLOOKUPs instead of DB
queries. Score four things on the same input CSV:
1. **Bucket accuracy** — tool's off-ICP/Peers/excluded vs. the workbook's tabs.
2. **Service agreement** — provisional service vs. the workbook's Target Pool column.
3. **Top-30 overlap** — tool's rank ≤30 vs. the human Top 30.
4. **Stage B quality** — side-by-side read of the 30 enriched rows.

Suggested bar: ≥85% bucket accuracy, ≥75% service agreement, ≥80% top-30 overlap,
Stage B "reads at the same standard". Log the numbers in `docs/ACCEPTANCE.md`.
Passing = green light to plug into the mothership (copy `modules/` + `prompts/`,
swap auth for OrgContext, add events at the transitions).

---

## Daily invariants (pin this)

- Prompt change = **new version file**, never edit v1 in place.
- The worker is the only thing that talks to the LLM or LinkedIn in bulk.
- Stage A touches LinkedIn **zero** times; Stage B ≤ `DEEP_ENRICH_DAILY_CAP`/day.
- Every score/verdict stores its "why" — no black boxes in the UI or the export.
- `.env` never committed; seeds stay synthetic-safe.
