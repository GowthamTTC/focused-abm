# Focused ABM (standalone)

LinkedIn 1st-degree connections → service-fit classification → ranked target pool →
Top-N deep enrichment → the five-tab TTC workbook.

- **Guide:** `IMPLEMENTATION.md` — the full Day 1 → Day 9 plan.
- **UI design:** `docs/CLAUDE-DESIGN-PROMPT.md` — paste into Claude Design.

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
