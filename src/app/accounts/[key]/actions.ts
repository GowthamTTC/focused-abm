"use server";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, connection } from "@/db";
import { requireUser } from "@/auth/session";
import { audit } from "@/lib/security/audit";
import {
  deleteAccountMap,
  parseUnitLines,
  remapByRules,
  saveAccountMap,
  setDivision,
} from "@/modules/accounts/org-map";

function back(key: string, extra: Record<string, string> = {}) {
  const qs = new URLSearchParams(extra).toString();
  return qs ? `/accounts/${encodeURIComponent(key)}?${qs}` : `/accounts/${encodeURIComponent(key)}`;
}

/** Save the org chart, then immediately run the free rule pass over it —
 *  an account map that shows no coverage until you press a second button
 *  reads as a broken feature rather than an unmapped account. */
export async function saveMap(formData: FormData) {
  const user = await requireUser();
  const key = String(formData.get("key") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!key || !name) redirect("/accounts");
  const aliases = String(formData.get("aliases") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const units = parseUnitLines(String(formData.get("units") ?? ""));

  await saveAccountMap(user.orgId, { companyKey: key, name, aliases, units });
  const result = await remapByRules(user.orgId, key);
  await audit(user.orgId, user.email, "accountmap.save", { key, units: units.length, ...result });
  redirect(back(key, { saved: "1", matched: String(result.matched) }));
}

/** Re-run the rule pass on its own — free, no model, no LinkedIn. */
export async function remapUnits(formData: FormData) {
  const user = await requireUser();
  const key = String(formData.get("key") ?? "").trim();
  const result = await remapByRules(user.orgId, key);
  await audit(user.orgId, user.email, "accountmap.remap", { key, ...result });
  redirect(back(key, { matched: String(result.matched) }));
}

/** A human's call on where someone sits. Stored as `manual` so no later rule
 *  pass overwrites it. Empty unit puts them back in the unmapped pile. */
export async function assignUnit(formData: FormData) {
  const user = await requireUser();
  const key = String(formData.get("key") ?? "").trim();
  const connId = String(formData.get("connId") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  if (!connId) redirect(back(key));
  await setDivision(user.orgId, [connId], unit || null, "manual", "Assigned by hand");
  await audit(user.orgId, user.email, "accountmap.assign", { key, connId, unit });
  redirect(back(key, { assigned: "1" }));
}

/** Drop every rule/model verdict on this account and start over. Manual
 *  assignments survive: they are the one thing here a machine did not decide. */
export async function clearUnits(formData: FormData) {
  const user = await requireUser();
  const key = String(formData.get("key") ?? "").trim();
  if (String(formData.get("confirm")) !== "on") redirect(back(key, { err: "confirm" }));
  const { mapKeys, loadAccountMap } = await import("@/modules/accounts/org-map");
  const { companyKey } = await import("@/modules/radar/score");
  const map = await loadAccountMap(user.orgId, key);
  if (!map) redirect("/accounts");
  const keys = mapKeys(map);

  const rows = await db.select({ id: connection.id, companyRaw: connection.companyRaw, method: connection.divisionMethod })
    .from(connection).where(and(eq(connection.orgId, user.orgId), eq(connection.bucket, "pitchable")));
  const ids = rows
    .filter((r) => keys.includes(companyKey(r.companyRaw)) && r.method !== "manual")
    .map((r) => r.id);
  await setDivision(user.orgId, ids, null, "rule", "");
  await audit(user.orgId, user.email, "accountmap.clear", { key, cleared: ids.length });
  redirect(back(key, { cleared: String(ids.length) }));
}

export async function removeMap(formData: FormData) {
  const user = await requireUser();
  const key = String(formData.get("key") ?? "").trim();
  if (String(formData.get("confirm")) !== "on") redirect(back(key, { err: "confirm" }));
  await deleteAccountMap(user.orgId, key);
  await audit(user.orgId, user.email, "accountmap.delete", { key });
  redirect("/accounts?mapdeleted=1");
}
