/**
 * Security / compliance audit trail — writes to activity_log.
 * Never throws to callers: logging must not break the primary action.
 */
import { db, activityLog } from "@/db";

export async function audit(
  orgId: string,
  actor: string,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.insert(activityLog).values({
      orgId,
      actor: actor.slice(0, 200),
      action: action.slice(0, 120),
      detailJson: {
        ...detail,
        at: new Date().toISOString(),
      },
    });
  } catch {
    /* swallow */
  }
}
