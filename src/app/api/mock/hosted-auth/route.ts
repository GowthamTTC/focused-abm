/** Mock hosted auth: instantly "connects" a fake LinkedIn seat. */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, channelAccount } from "@/db";
import { env } from "@/lib/env";
import { currentUser } from "@/auth/session";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(`${env.APP_URL}/login`);
  const mockId = "mock-account-1";
  const existing = await db.select().from(channelAccount)
    .where(eq(channelAccount.unipileAccountId, mockId));
  if (existing.length === 0) {
    await db.insert(channelAccount).values({
      orgId: user.orgId, unipileAccountId: mockId,
      displayName: "Mock LinkedIn (demo)", status: "operational",
    });
  }
  return NextResponse.redirect(`${env.APP_URL}/settings?connected=1`);
}
