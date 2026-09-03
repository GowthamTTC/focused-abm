"use server";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, connection } from "@/db";
import { requireUser } from "@/auth/session";
import { enqueue } from "@/jobs/runner";
import { countryBySlug } from "@/modules/geo/countries";

function qs(days: number, extra: Record<string, string> = {}) {
  const p = new URLSearchParams({ days: String(days), ...extra });
  return `/radar?${p.toString()}`;
}

export async function startEventScan(formData: FormData) {
  const user = await requireUser();
  const country = String(formData.get("country") ?? "united-states");
  const days = Number(formData.get("days") ?? 7) || 7;
  const eventName = String(formData.get("event") ?? "").trim();
  const pool = String(formData.get("pool") ?? "first") === "extended" ? "extended" : "first";
  // Normally the event's host: a Dreamforce search is mostly Salesforce staff,
  // and they are the least useful result because they are not attendees you can
  // sell to. Kept in the URL so the box still holds it after the redirect.
  const exclude = String(formData.get("exclude") ?? "").trim().slice(0, 200);
  if (!countryBySlug(country)) {
    redirect(qs(7, { pool, country: "united-states", err: "country" }));
  }
  if (!eventName) {
    redirect(qs(days, { pool, country, err: "event" }));
  }
  // The disabled button is the courtesy; this is the protection. A 1st-degree
  // run reads each person's posts, so it stops dead at the daily cap — and
  // queueing it anyway produced a job that reported "scanned 0" with the reason
  // recorded nowhere a user could see. The 2nd + 3rd search is a post SEARCH
  // and spends none of this budget, so it is never refused here.
  if (pool === "first") {
    const { getDailyScanUsage } = await import("@/modules/posts/usage");
    const { remaining } = await getDailyScanUsage(user.orgId);
    if (remaining === 0) redirect(qs(days, { pool, country, err: "cap" }));
  }
  await enqueue(user.orgId, "event_extended", {
    country,
    days: Math.min(30, Math.max(1, days)),
    eventName,
    degree: pool === "extended" ? "extended" : "first",
    excludeCompanies: exclude || undefined,
  });
  redirect(qs(days, { pool, country, scanning: "1", event: eventName, q: eventName,
    ...(exclude ? { exclude } : {}) }));
}

export async function markFloor(id: string, status: "met" | "skipped", metro: string, days: number, pool = "first", country = "united-states") {
  const user = await requireUser();
  await db.update(connection).set({
    floorStatus: status,
    floorAt: new Date(),
  }).where(and(eq(connection.orgId, user.orgId), eq(connection.id, id)));
  redirect(qs(days, { pool, country, metro, p: id }));
}

export async function clearFloor(id: string, metro: string, days: number, pool = "first", country = "united-states") {
  const user = await requireUser();
  await db.update(connection).set({
    floorStatus: null,
    floorAt: null,
  }).where(and(eq(connection.orgId, user.orgId), eq(connection.id, id)));
  redirect(qs(days, { pool, country, metro, p: id }));
}
