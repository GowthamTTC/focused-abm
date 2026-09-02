# Focused ABM (standalone)

LinkedIn 1st-degree connections → service-fit classification → ranked target pool →
Top-N deep enrichment → the five-tab TTC workbook.

- **Guide:** `IMPLEMENTATION.md` — the full Day 1 → Day 9 plan.
- **UI design:** `docs/CLAUDE-DESIGN-PROMPT.md` — paste into Claude Design.
- **Event radar:** `/radar` — metro + last-7-days activity. Home city from profile/headline, travel from posts. Not live GPS. After migrate, `npm run db:migrate`.

## Local database

Tests and scripts write rows, so they run against a **local** Postgres — never
Railway. One-time setup:

```bash
brew install postgresql@16 && brew services start postgresql@16
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"   # add to your shell rc
createuser -s postgres && createdb -U postgres focused_abm
psql -U postgres -d postgres -c "ALTER USER postgres WITH PASSWORD 'dev';"
npm run db:migrate && npm run seed
```

`.env` keeps `DATABASE_URL` on localhost. The Railway string lives under
`DATABASE_URL_PRODUCTION` so it is not lost — **do not move it back**: scripts
read `DATABASE_URL`, so pointing it at production means every test writes to
live customer data.

Any script that writes rows must import the guard first, which refuses to run
against a non-local host:

```ts
import "./scripts/require-local-db";
```

## Quickstart

```bash
nvm use 22 && npm install
cp .env.example .env        # SESSION_SECRET, ADMIN_EMAIL/PASSWORD, OPENROUTER_API_KEY
npm run db:generate && npm run db:migrate && npm run seed
npm run dev                 # terminal 1 — web (localhost:3000)
npm run worker:dev          # terminal 2 — job worker
```

Runs fully in **mock mode** with zero LinkedIn keys (Settings → Connect LinkedIn
creates a fake seat; Sync pulls 120 synthetic relations). Paste `UNIPILE_API_KEY`
+ `UNIPILE_DSN` on Day 4 to go live — nothing else changes.

## Layout

```
prompts/                versioned LLM prompts (edit = new vN.md file)
src/db/schema.ts        the whole data model (connection is the spine)
src/llm/client.ts       the one LLM seam (OpenRouter → Claude, zod-validated)
src/providers/channel/  ChannelProvider: mock + unipile behind one interface
src/modules/            import-csv · matching · scoring · enrich · exporter
src/jobs/ + worker.ts   DB-backed job queue (no Redis)
src/app/                Next.js screens (minimal shells — see design prompt)
```
