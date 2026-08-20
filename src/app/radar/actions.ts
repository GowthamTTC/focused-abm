"use server";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, connection } from "@/db";
import { requireUser } from "@/auth/session";
import { enqueue } from "@/jobs/runner";
import { metroBySlug } from "@/modules/geo/metros";

function qs(metro: string, days: number, extra: Record<string, string> = {}) {
  const p = new URLSearchParams({ metro, days: String(days), ...extra });
  return `/radar?${p.toString()}`;
}

export async function startEventScan(formData: FormData) {
  const user = await requireUser();
  const metro = String(formData.get("metro") ?? "sf-bay-area");
  const days = Number(formData.get("days") ?? 7) || 7;
  const eventName = String(formData.get("event") ?? "").trim();
  if (!metroBySlug(metro)) redirect(qs("sf-bay-area", 7, { err: "metro" }));
  await enqueue(user.orgId, "event_scan", {
    metro,
    days: Math.min(30, Math.max(1, days)),
    eventName: eventName || undefined,
  });
  redirect(qs(metro, days, { scanning: "1" }));
}

export async function markFloor(id: string, status: "met" | "skipped", metro: string, days: number) {
  const user = await requireUser();
  await db.update(connection).set({
    floorStatus: status,
    floorAt: new Date(),
  }).where(and(eq(connection.orgId, user.orgId), eq(connection.id, id)));
  redirect(qs(metro, days, { p: id }));
}

export async function clearFloor(id: string, metro: string, days: number) {
  const user = await requireUser();
  await db.update(connection).set({
    floorStatus: null,
    floorAt: null,
  }).where(and(eq(connection.orgId, user.orgId), eq(connection.id, id)));
  redirect(qs(metro, days, { p: id }));
}
