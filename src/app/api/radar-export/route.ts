/**
 * Download the Radar list as CSV.
 *
 * Takes the same filters the screen is showing, so the file matches the list it
 * was downloaded from. Logged like the workbook export, because a CSV of named
 * people leaving the building is the same kind of event.
 */
import { NextResponse } from "next/server";
import { currentUser } from "@/auth/session";
import { db, exportLog } from "@/db";
import { audit } from "@/lib/security/audit";
import { buildRadarCsv } from "@/modules/radar/export";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const pool = sp.get("pool") === "extended" ? "extended" : "first";
  const tab = sp.get("tab") === "met" ? "met" : "mentioned";
  const daysRaw = Number(sp.get("days") ?? 7);
  const days = [3, 7, 14].includes(daysRaw) ? daysRaw : 7;
  const country = sp.get("country") || "united-states";
  const metro = sp.get("metro") || "sf-bay-area";
  const query = sp.get("query")?.trim() || undefined;

  const { csv, rows } = await buildRadarCsv(user.orgId, { metro, days, pool, country, query, tab });

  try {
    await db.insert(exportLog).values({
      orgId: user.orgId, batchId: null,
      label: `Radar CSV — ${pool === "extended" ? "2nd + 3rd" : "1st degree"}${query ? ` · ${query}` : ""}`,
      rows,
    });
    await audit(user.orgId, user.email, "data.export", { kind: "radar-csv", pool, country, days, query, rows });
  } catch { /* logging must never block the download */ }

  const stamp = new Date().toISOString().slice(0, 10);
  // "radar-dreamforce-2026-09-03.csv" when an event is named, plain
  // "radar-2026-09-03.csv" when it is not — never "radar-radar-".
  const slug = (query ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // The BOM is for Excel: without it a post containing an em dash, a curly
  // quote or an accented name opens as mojibake on Windows. Every post in this
  // file is someone's own prose, so that is the common case, not the edge one.
  return new NextResponse("\uFEFF" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="radar-${slug ? `${slug}-` : ""}${stamp}.csv"`,
    },
  });
}
