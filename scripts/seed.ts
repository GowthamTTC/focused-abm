/**
 * Idempotent bootstrap: org → admin user (from env) → six TTC services.
 * Run once after db:migrate, and again any time to top up missing services.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { db, appUser, org, service } from "../src/db";
import { env } from "../src/lib/env";
import { SEED_SERVICES } from "../src/modules/services/seed-data";

async function main() {
  let [o] = await db.select().from(org);
  if (!o) {
    [o] = await db.insert(org).values({ name: "toss the coin" }).returning();
    console.log("org created:", o.name);
  }

  if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD) {
    const [u] = await db.select().from(appUser).where(eq(appUser.email, env.ADMIN_EMAIL.toLowerCase()));
    if (!u) {
      await db.insert(appUser).values({
        orgId: o.id,
        email: env.ADMIN_EMAIL.toLowerCase(),
        passwordHash: await bcrypt.hash(env.ADMIN_PASSWORD, 10),
        name: "Admin",
      });
      console.log("admin user created:", env.ADMIN_EMAIL);
    }
  } else {
    console.warn("ADMIN_EMAIL / ADMIN_PASSWORD not set — no user created.");
  }

  for (const s of SEED_SERVICES) {
    const [existing] = await db.select().from(service)
      .where(and(eq(service.orgId, o.id), eq(service.slug, s.slug)));
    if (!existing) {
      await db.insert(service).values({ orgId: o.id, slug: s.slug, name: s.name, icpJson: s.icp });
      console.log("service seeded:", s.slug);
    }
  }
  console.log("seed complete");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
