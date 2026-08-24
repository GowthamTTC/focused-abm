CREATE TABLE IF NOT EXISTS "account_shortlist" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL REFERENCES "org"("id"),
  "company_key" text NOT NULL,
  "company_name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "account_shortlist_org_idx" ON "account_shortlist" ("org_id");
CREATE INDEX IF NOT EXISTS "account_shortlist_org_key_idx" ON "account_shortlist" ("org_id", "company_key");
