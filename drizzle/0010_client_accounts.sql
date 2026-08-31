CREATE TABLE IF NOT EXISTS "client_account" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "client_account_id" text REFERENCES "client_account"("id");
CREATE INDEX IF NOT EXISTS "app_user_client_account_idx" ON "app_user" ("client_account_id");
