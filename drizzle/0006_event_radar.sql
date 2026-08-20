ALTER TABLE "connection" ADD COLUMN "metro" text;
ALTER TABLE "connection" ADD COLUMN "metro_evidence" text;
ALTER TABLE "connection" ADD COLUMN "mention_metro" text;
ALTER TABLE "connection" ADD COLUMN "mention_at" timestamp with time zone;
ALTER TABLE "connection" ADD COLUMN "mention_snippet" text;
ALTER TABLE "connection" ADD COLUMN "mention_kind" text;
ALTER TABLE "connection" ADD COLUMN "floor_status" text;
ALTER TABLE "connection" ADD COLUMN "floor_at" timestamp with time zone;
CREATE INDEX "connection_metro_idx" ON "connection" USING btree ("org_id","metro");
