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
  if (!countryBySlug(country)) {
    redirect(qs(7, { pool, country: "united-states", err: "country" }));
  }
  if (!eventName) {
    redirect(qs(days, { pool, country, err: "event" }));
  }
  await enqueue(user.orgId, "event_extended", {
    country,
    days: Math.min(30, Math.max(1, days)),
    eventName,
    degree: pool === "extended" ? "extended" : "first",
  });
  redirect(qs(days, { pool, country, scanning: "1", event: eventName, q: eventName }));
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
