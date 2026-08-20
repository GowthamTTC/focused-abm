import { NextResponse } from "next/server";
import pkg from "../../../../package.json";

/** One curl answers "is production running what I just built?".
 *  Plain JSON, no auth, no streaming — safe on a hostile network. */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    version: pkg.version,
    commit: (process.env.RAILWAY_GIT_COMMIT_SHA ?? "").slice(0, 7) || null,
    builtFor: process.env.RAILWAY_SERVICE_NAME ?? null,
    now: new Date().toISOString(),
  });
}
