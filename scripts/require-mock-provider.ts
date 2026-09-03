/**
 * Import this FIRST in any verification script that runs jobs.
 *
 * The companion to require-local-db, and it exists for the same reason with a
 * different blast radius: that one stops a script writing to the wrong
 * DATABASE, this one stops it talking to the real LINKEDIN.
 *
 *   import "./require-mock-provider";   // before any provider or db import
 *
 * getChannelProvider() picks the real Unipile adapter whenever UNIPILE_API_KEY
 * and UNIPILE_DSN are both set (src/providers/channel/index.ts), and a
 * developer machine has them set in .env because that is how the app runs. So
 * a harness that drives processNext() on a laptop reaches for a real seat and
 * fires live requests at LinkedIn using fixture identifiers — which is exactly
 * what happened the first time these checks were run outside the container:
 * a stream of 404s against a production seat before any assertion said a word.
 *
 * The suite already ASSERTS the provider is the mock, but an assertion is a
 * report, not a brake — by the time it fails the calls have gone out. This
 * refuses to let the process start.
 *
 * Blanking the two variables is enough to select the mock, and it must happen
 * in the ENVIRONMENT rather than in a module body:
 *
 *   UNIPILE_API_KEY= UNIPILE_DSN= npx tsx scripts/verify-hook-feed-checks.ts
 *
 * The invariant is READ AND THROW, NEVER ASSIGN. This file must not write
 * process.env: src/lib/env.ts parses and freezes its view at import time, so an
 * assignment here would be both too late and a lie to the next reader. Its
 * position in the import list is not what makes it safe — the fact that it only
 * reads is. Note also that its `key && dsn` predicate duplicates env.ts's
 * `unipileConfigured` rather than importing it (importing would parse env and
 * defeat the point), so a change to one must be mirrored in the other.
 *
 * Assigning process.env from inside a module cannot work here and has already
 * fooled someone once. ES imports are hoisted, so src/lib/env.ts has parsed
 * and frozen its view of the environment before any statement in the importing
 * module runs. Setting it beforehand is the only thing that lands — and dotenv
 * will not overwrite a variable that is already present, even an empty one,
 * which is why the empty assignment survives .env.
 */
import "dotenv/config";

const key = process.env.UNIPILE_API_KEY ?? "";
const dsn = process.env.UNIPILE_DSN ?? "";

if (key && dsn) {
  throw new Error(
    "Refusing to run: UNIPILE_API_KEY and UNIPILE_DSN are set, so getChannelProvider() " +
    "would return the REAL LinkedIn adapter and this script drives jobs that call it.\n" +
    "Re-run with the mock provider selected:\n" +
    "  UNIPILE_API_KEY= UNIPILE_DSN= npx tsx " + (process.argv[1] ?? "<script>") + "\n" +
    "Blank them in the environment, not in the script: env is parsed at import time.",
  );
}
