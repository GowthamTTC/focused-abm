"use server";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, connection } from "@/db";
import { requireUser } from "@/auth/session";
import { enqueue } from "@/jobs/runner";
import { isUsMetro, metroBySlug } from "@/modules/geo/metros";
import { countryBySlug } from "@/modules/geo/countries";

function qs(metro: string, days: number, extra: Record<string, string> = {}) {
  const p = new URLSearchParams({ metro, days: String(days), ...extra });
  return `/radar?${p.toString()}`;
}

export async function startEventScan(formData: FormData) {
  const user = await requireUser();
  const metro = String(formData.get("metro") ?? "sf-bay-area");
  const country = String(formData.get("country") ?? "united-states");
  const days = Number(formData.get("days") ?? 7) || 7;
  const eventName = String(formData.get("event") ?? "").trim();
  const pool = String(formData.get("pool") ?? "first") === "extended" ? "extended" : "first";
  if (pool === "first" && (!metroBySlug(metro) || !isUsMetro(metro))) {
    redirect(qs("sf-bay-area", 7, { err: "metro" }));
  }
  if (pool === "extended" && !countryBySlug(country)) {
    redirect(qs(metro, days, { pool, country: "united-states", err: "country" }));
  }
  if (pool === "extended" && !eventName) {
    redirect(qs(metro, days, { pool, country, err: "event" }));
  }
  if (pool === "extended") {
    await enqueue(user.orgId, "event_extended", {
      country,
      days: Math.min(30, Math.max(1, days)),
      eventName,
    });
  } else {
    await enqueue(user.orgId, "event_scan", {
      metro,
      days: Math.min(30, Math.max(1, days)),
      eventName: eventName || undefined,
    });
  }
  redirect(qs(metro, days, { pool, country, scanning: "1" }));
}

export async function markFloor(id: string, status: "met" | "skipped", metro: string, days: number, pool = "first", country = "united-states") {
  const user = await requireUser();
  await db.update(connection).set({
    floorStatus: status,
    floorAt: new Date(),
  }).where(and(eq(connection.orgId, user.orgId), eq(connection.id, id)));
  redirect(qs(metro, days, { pool, country, p: id }));
}

export async function clearFloor(id: string, metro: string, days: number, pool = "first", country = "united-states") {
  const user = await requireUser();
  await db.update(connection).set({
    floorStatus: null,
    floorAt: null,
  }).where(and(eq(connection.orgId, user.orgId), eq(connection.id, id)));
  redirect(qs(metro, days, { pool, country, p: id }));
}
