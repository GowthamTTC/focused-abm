CREATE TABLE "account_map" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"company_key" text NOT NULL,
	"name" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"units" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "onboarding_step" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "division" text;--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "division_method" text;--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "division_why" text;--> statement-breakpoint
ALTER TABLE "account_map" ADD CONSTRAINT "account_map_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_map_org_key_uq" ON "account_map" USING btree ("org_id","company_key");--> statement-breakpoint
-- Everyone who already has an account has, by definition, already been set up.
-- shell.tsx sends any user with a null onboarding_completed_at to /onboarding,
-- so without this every existing seat across every workspace — clients
-- included — would open the app into an eight-step setup wizard whose fourth
-- step is "Connect LinkedIn". Backfilled here rather than in a follow-up script
-- so there is no window in which it is true.
-- Signups created AFTER this migration still arrive null, and still get the
-- wizard, which is the whole point of the feature.
UPDATE "app_user" SET "onboarding_completed_at" = now() WHERE "onboarding_completed_at" IS NULL;
