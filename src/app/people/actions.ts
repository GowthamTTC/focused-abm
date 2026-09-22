"use server";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth/session";
import { outcomeQs, queueEnrich } from "@/modules/enrich/queue";

/** Return to exactly the filters + page the click came from. */
function backTo(back: string, extra: string) {
  const q = [back, extra].filter(Boolean).join("&");
  return `/people${q ? `?${q}` : ""}`;
}

/** Tick-and-run from the People table: research exactly who was checked. */
export async function enrichSelectedPeople(back: string, formData: FormData) {
  const user = await requireUser();
  const picked = formData.getAll("ids").map(String).filter(Boolean);
  if (picked.length === 0) redirect(backTo(back, "run=0"));
  redirect(backTo(back, outcomeQs(await queueEnrich(user.orgId, picked))));
}

/** One row, one decision — the per-person Enrich link in the table. */
export async function enrichPerson(connId: string, back: string) {
  const user = await requireUser();
  redirect(backTo(back, outcomeQs(await queueEnrich(user.orgId, [connId]))));
}
