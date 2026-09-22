CREATE TABLE "account_signal" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"company_key" text NOT NULL,
	"company_name" text NOT NULL,
	"kind" text NOT NULL,
	"source_id" text NOT NULL,
	"source" text,
	"title" text,
	"url" text,
	"body" text,
	"published_at" timestamp with time zone,
	"sentiment" integer,
	"theme" text,
	"evidence" text,
	"judged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "post" ADD COLUMN "sentiment" integer;--> statement-breakpoint
ALTER TABLE "account_signal" ADD CONSTRAINT "account_signal_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_signal_src_uq" ON "account_signal" USING btree ("org_id","company_key","source_id");--> statement-breakpoint
CREATE INDEX "account_signal_org_key_idx" ON "account_signal" USING btree ("org_id","company_key","published_at");