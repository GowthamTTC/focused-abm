CREATE TABLE "account_person" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"company_key" text NOT NULL,
	"company_name" text NOT NULL,
	"name" text NOT NULL,
	"headline" text,
	"location" text,
	"country" text,
	"profile_url" text,
	"public_identifier" text,
	"member_id" text,
	"network_distance" text,
	"captured_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_person" ADD CONSTRAINT "account_person_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_person_uq" ON "account_person" USING btree ("org_id","company_key","profile_url");--> statement-breakpoint
CREATE INDEX "account_person_org_key_idx" ON "account_person" USING btree ("org_id","company_key");