import { redirect } from "next/navigation";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db, connection } from "@/db";
import { Shell, requirePage } from "@/app/shell";

/** Deep links land on the batch card — single place for Enrich + research. */
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage();
  const { id } = await params;
  const [person] = await db.select({
    id: connection.id,
    batchId: connection.batchId,
    enrichStatus: connection.enrichStatus,
  }).from(connection).where(and(
    eq(connection.orgId, user.orgId),
    eq(connection.id, id),
  )).limit(1);

  if (person?.batchId) {
    const view = person.enrichStatus === "done" ? "enriched" : "pitchable";
    redirect(`/batches/${person.batchId}?view=${view}&p=${person.id}`);
  }

  return (
    <Shell user={user} active="people">
      <h1 className="text-xl font-semibold">Person not found</h1>
      <p className="mt-2 text-sm text-[#475467]">No batch linked for this contact.</p>
      <Link href="/people" className="mt-4 inline-block text-sm text-[#263BAA]">← Back to People</Link>
    </Shell>
  );
}
