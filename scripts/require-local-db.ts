/**
 * Import this FIRST in any throwaway or verification script that writes rows.
 *
 * The reason it exists: .env once pointed DATABASE_URL at Railway, so scripts
 * written to "test on a scratch database" were creating and deleting rows in
 * live customer data. Nothing was lost, but nothing stopped it either. This
 * does.
 *
 *   import "./scripts/require-local-db";   // before any db import
 *
 * Read-only production inspection is legitimate — point a throwaway Pool at
 * DATABASE_URL_PRODUCTION explicitly for that, so it is a visible choice in
 * the script rather than an accident of which .env line was uncommented.
 */
import "dotenv/config";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

const raw = process.env.DATABASE_URL ?? "";
let host = "";
try {
  host = new URL(raw).hostname;
} catch {
  throw new Error(`DATABASE_URL is missing or unparseable — refusing to run.`);
}

if (!LOCAL_HOSTS.has(host)) {
  throw new Error(
    `Refusing to run: DATABASE_URL points at "${host}", not a local database.\n` +
    `This script writes rows. Start the local database and point DATABASE_URL at it:\n` +
    `  brew services start postgresql@16\n` +
    `  DATABASE_URL=postgresql://postgres:dev@localhost:5432/focused_abm`,
  );
}
