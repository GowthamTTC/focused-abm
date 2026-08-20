import { toCountry } from "./country";
import { stampMetro } from "@/modules/geo/metros";
import { db, connection, connectionBatch } from "@/db";
import type { ParsedConnectionRow } from "./import-csv";
import { splitHeadline } from "./import-csv";
import type { Relation } from "@/providers/channel";

const CHUNK = 500;

export async function createBatchFromCsv(orgId: string, label: string, rows: ParsedConnectionRow[]) {
  const [batch] = await db.insert(connectionBatch)
    .values({ orgId, source: "csv", label, statsJson: { imported: rows.length } })
    .returning();
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(connection).values(rows.slice(i, i + CHUNK).map((r) => ({
      orgId, batchId: batch.id,
      firstName: r.firstName, lastName: r.lastName,
      companyRaw: r.company, positionRaw: r.position,
      linkedinUrl: r.linkedinUrl,
      publicIdentifier: r.linkedinUrl?.split("/in/")[1]?.split(/[?#]/)[0]?.replace(/\/+$/, "") ?? null,
      connectedOn: r.connectedOn,
    })));
  }
  return batch;
}

export async function createBatchFromRelations(orgId: string, label: string, relations: Relation[]) {
  const [batch] = await db.insert(connectionBatch)
    .values({ orgId, source: "sync", label, statsJson: { imported: relations.length } })
    .returning();
  for (let i = 0; i < relations.length; i += CHUNK) {
    await db.insert(connection).values(relations.slice(i, i + CHUNK).map((r) => {
      const { position, company } = splitHeadline(r.headline);
      return {
        orgId, batchId: batch.id,
        firstName: r.firstName || "(unknown)", lastName: r.lastName,
        companyRaw: company, positionRaw: position, headlineRaw: r.headline,
        linkedinUrl: r.profileUrl,
        publicIdentifier: r.publicIdentifier ?? r.memberId,
        memberId: r.memberId ?? null,
        location: r.location ?? null,
        country: toCountry(r.location),
        ...stampMetro({ location: r.location, headline: r.headline, country: toCountry(r.location) }),
        connectedOn: r.connectedAt,
      };
    }));
  }
  return batch;
}
