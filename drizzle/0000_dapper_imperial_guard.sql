CREATE TABLE "activity_log" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"detail_json" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "channel_account" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"provider" text DEFAULT 'linkedin' NOT NULL,
	"unipile_account_id" text NOT NULL,
	"display_name" text,
	"status" text DEFAULT 'operational' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_account_unipile_account_id_unique" UNIQUE("unipile_account_id")
);
--> statement-breakpoint
CREATE TABLE "connection" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"company_raw" text,
	"position_raw" text,
	"headline_raw" text,
	"linkedin_url" text,
	"public_identifier" text,
	"connected_on" text,
	"bucket" text,
	"service_slug" text,
	"match_confidence" integer,
	"match_why" text,
	"match_method" text,
	"score" integer,
	"score_breakdown_json" jsonb,
	"tier" integer,
	"rank" integer,
	"selected_for_enrich" boolean DEFAULT false NOT NULL,
	"enrich_status" text DEFAULT 'pending' NOT NULL,
	"about_summary" text,
	"activity_url" text,
	"posts_summary" text,
	"pain_points" text,
	"pain_inferred" boolean,
	"service_confirmed" text,
	"correction_reason" text,
	"flag" text,
	"outreach_message" text,
	"enrich_error" text,
	"enriched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connection_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"source" text NOT NULL,
	"label" text NOT NULL,
	"stats_json" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"settings_json" jsonb DEFAULT '{"enrichLimit":10}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"icp_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_account" ADD CONSTRAINT "channel_account_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_batch_id_connection_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."connection_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_batch" ADD CONSTRAINT "connection_batch_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connection_batch_idx" ON "connection" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "connection_bucket_idx" ON "connection" USING btree ("batch_id","bucket");--> statement-breakpoint
CREATE UNIQUE INDEX "service_org_slug_uq" ON "service" USING btree ("org_id","slug");