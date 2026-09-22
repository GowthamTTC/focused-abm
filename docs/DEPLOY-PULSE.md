# Deploying Account Pulse — runbook

Written to be handed to an agent working in this repo. Follow it in order.
Steps 1–4 are yours. **Step 5 says stop, and it means it.** Steps 6–7 come back
to you afterwards.

Feature: `docs/ACCOUNT-PULSE.md`. Branch: `claude/focused-lamport-q7twr2`.

---

## The one rule that matters

**Never put the production connection string in `.env`, in the working tree, or
in a shell you will reuse.**

`scripts/require-local-db.ts` exists because that already happened once: `.env`
pointed `DATABASE_URL` at Railway, and scripts written to "test on a scratch
database" were creating and deleting rows in live customer data. Nothing was
lost and nothing stopped it either.

Run anything that touches production through `railway run` or the Railway shell,
so the string never lands on disk. If the Railway CLI is not available, stop and
say so rather than working around it.

---

## 1 · Confirm the branch is sound before deploying

```bash
git rev-parse --abbrev-ref HEAD        # expect claude/focused-lamport-q7twr2
git status --porcelain                 # expect empty
npm ci
npm run build                          # must pass
npx tsc --noEmit                       # must be clean
```

Then the database-free checks, which need no server and no key:

```bash
DATABASE_URL="postgresql://u:p@localhost:5432/x" \
SESSION_SECRET="0123456789012345678901234567890123" \
OPENROUTER_API_KEY="sk-or-placeholder" \
  npx tsx scripts/verify-pulse-pure.ts
```

Expect **32/32**. These cover the allowlist's look-alike-domain trap and the
null-is-not-zero rule; a failure here is a stop.

The fuller suite `scripts/verify-hook-feed-checks.ts` needs a local Postgres. If
you have one, run it (see README) and expect **219/222** — checks 163, 164 and
188 fail on the base branch too and are unrelated to this work. Any OTHER
failure is a stop.

## 2 · Deploy

Both services must land on the new build:

- **web** — build `npm run build`, start `npm run start`
- **worker** — start `npm run worker`

The worker handles a new job kind, `account_pulse`. If it stays on the old
build the refresh button enqueues a job nothing will ever claim, and the UI
shows a run that never finishes.

If Railway auto-deploys `main`, merge and push. If it tracks the feature branch,
confirm the push landed. **Pointing Railway at a different branch is a dashboard
action — you cannot do it from here.** Say so and let the human do it.

## 3 · Migrate

```bash
railway run npm run db:migrate
```

Adds `account_signal`, adds a nullable `post.sentiment`, adds two indexes.
Additive only: no drops, no column type changes, no table rewrites. Safe against
live data.

## 4 · Verify the migration, read-only

```bash
railway run psql "$DATABASE_URL" -c "\d account_signal"
railway run psql "$DATABASE_URL" -c "select column_name from information_schema.columns where table_name='post' and column_name='sentiment';"
```

Report both results. `account_signal` should exist with a unique index on
`(org_id, company_key, source_id)`, and `post.sentiment` should be there.

## 5 · STOP — the next four steps are a human's

Do not attempt these. They run in the browser, inside a **client's** workspace,
and they need that client's password. Getting a credential into an agent session
to save four clicks is a bad trade, and the activity log will record the client's
own email as the actor.

Tell the human this, verbatim:

> Deployed and migrated. Your turn:
> 1. Log in as `apingel@arielgroup.com`
> 2. Settings → **Account Pulse** → paste the news domains → Save
> 3. `/accounts` → type **Allergan Aesthetics** → **Track it**
> 4. **Refresh pulse**, wait for the run to finish, then tell me

Domains for that seat:

```
news.abbvie.com
fiercepharma.com
biospace.com
americanmedspa.org
investors.abbvie.com
```

## 6 · Diagnose the run, read-only

When the human says the run finished:

```sql
select
  payload_json->'result'->>'domains'   as domains_allowed,
  payload_json->'result'->>'collected' as news_stored,
  payload_json->'result'->>'judged'    as signals_judged,
  payload_json->'result'->>'calls'     as model_calls,
  payload_json->'result'->>'failed'    as failed_slices,
  jsonb_array_length(coalesce(payload_json->'result'->'triggers','[]'::jsonb)) as triggers,
  status, error, updated_at
from job
where kind = 'account_pulse'
order by updated_at desc
limit 1;
```

And the signals themselves:

```sql
select count(*) as rows,
       count(*) filter (where judged_at is not null) as judged,
       count(*) filter (where sentiment is not null) as scored
from account_signal
where company_key = 'allergan aesthetics';
```

**Write nothing.** These are reads.

## 7 · Read the result honestly

| What you see | What it means | What to do |
|---|---|---|
| `domains_allowed = 0` | the domains were never saved | back to step 5.2 |
| `news_stored = 0`, domains > 0 | **the RSS collector did not parse the real feeds** | the most likely failure; report it and stop |
| `news_stored > 0`, `judged = 0` | the judge failed — check `error` | report the error verbatim |
| `scored = 0` but `judged > 0` | model returned no quotable evidence, so every score is null by design | not a bug; report it |
| `triggers = 0` | may be correct — the prompt is told to return nothing rather than pad | report alongside the news count |
| triggers present | paste them out in full | the human judges whether they read as *this* account |

The Network band will be empty and will say nobody from the company is in the
network. That is the true answer for this account — there is exactly one
connection at Allergan Aesthetics across the whole estate, in a different
workspace, correctly filed off-ICP. Do not treat it as a fault and do not try to
fix it by scanning.

**Do not judge the triggers yourself.** The open question is whether they read as
*this company* or as any pharma company having a bad year, and that is the
human's call. Paste them and say nothing more.
